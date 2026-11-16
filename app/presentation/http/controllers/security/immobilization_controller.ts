import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { RequestImmobilization } from '#application/security/use_cases/request_immobilization'
import { DispatchEngineCommand } from '#application/security/use_cases/dispatch_engine_command'
import { RequestEngineRestore } from '#application/security/use_cases/request_engine_restore'
import { FlespiCommandTracker } from '#infrastructure/gateways/flespi/flespi_command_tracker'
import {
  requestImmobilizationValidator,
  restoreEngineValidator,
} from '#presentation/http/validators/security/immobilization_validators'
import { groupEngineCommandValidator } from '#presentation/http/validators/scheduling/schedule_validators'
import type { ExecutionContext } from '#application/ports'
import VehicleGroupModel from '#infrastructure/persistence/models/vehicle_group_model'
import { LucidVehicleGroupMembership } from '#infrastructure/persistence/repositories/group_membership_repository'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { organizationScope } from '#presentation/http/support/organization_scope'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { authorize } from '#presentation/http/support/authorize'
import {
  commandInScope,
  notFoundInScope,
  vehicleInScope,
} from '#presentation/http/support/tenant_resources'

/**
 * Plafond d'une commande de groupe : au-delà, la requête HTTP durerait trop
 * (une émission flespi par véhicule). L'immobilisation de grandes flottes
 * passe par un calendrier, appliqué en tâche de fond.
 */
const MAX_GROUP_COMMANDS = 100

/**
 * Contrôleur HTTP — couche la plus fine du système.
 *
 * Sa seule responsabilité : traduire HTTP <-> cas d'usage. Il ne connaît ni
 * Lucid, ni la base, ni les règles de sécurité. Si on devait exposer
 * l'immobilisation en MQTT ou en CLI, on écrirait un autre adaptateur et
 * le métier resterait strictement identique.
 */
@inject()
export default class ImmobilizationController {
  constructor(
    private readonly requestImmobilization: RequestImmobilization,
    private readonly dispatchEngineCommand: DispatchEngineCommand,
    private readonly requestEngineRestore: RequestEngineRestore,
    private readonly tracker: FlespiCommandTracker,
    private readonly groupMembers: LucidVehicleGroupMembership,
    private readonly audit: LucidAuditLogger
  ) {}

  //Etape 1 et 3 immobilization et dispatch
  /*
  Fonction finale pour l'immobilisation controllée(demande) et l'envoi de la commande
  */
  /** POST /api/v1/security/immobilizations */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'immobilizeVehicles')
    const payload = await ctx.request.validateUsing(requestImmobilizationValidator)

    // Cloisonnement : le cas d'usage lit l'état du véhicule sans filtre
    // d'organisation. Un véhicule d'un autre client est introuvable.
    const vehicule = await vehicleInScope(ctx, payload.vehicleId)
    if (!vehicule) return notFoundInScope(ctx, 'Véhicule')
    // La commande appartient à l'organisation DU VÉHICULE (identique à celle
    // de l'acteur côté client ; différente pour l'exploitant plateforme).
    const contexte = { ...toExecutionContext(ctx), organizationId: vehicule.organizationId }

    const r = await this.executer(
      'cut',
      contexte,
      payload.vehicleId,
      payload.reason,
      payload.alertId
    )
    return r.ok
      ? ctx.response.accepted({ data: r.data })
      : ctx.response.status(r.httpStatus).send({ error: r.error })
  }

  /**
   * POST /api/v1/security/immobilizations/:id/dispatch
   *
   * RELANCE de l'émission d'une coupure restée `approved` : `store` émet
   * déjà dans la foulée, cette route ne sert que si l'émission n'a pas pu
   * démarrer (immobilisation désactivée, position absente au moment de
   * l'envoi…). Le cas d'usage refait le contrôle de vitesse avant d'émettre.
   */
  async dispatch(ctx: HttpContext) {
    await authorize(ctx, 'immobilizeVehicles')
    const commande = await commandInScope(ctx, ctx.params.id)
    if (!commande) return notFoundInScope(ctx, 'Commande')

    const result = await this.dispatchEngineCommand.execute({
      context: { ...toExecutionContext(ctx), organizationId: commande.organizationId },
      commandId: ctx.params.id,
    })

    if (!result.ok) {
      return ctx.response.status(result.error.httpStatus).send({ error: result.error.toJSON() })
    }
    return ctx.response.accepted({ data: result.value })
  }

  /**
   * POST /api/v1/security/restorations
   * body : { vehicleId, reason }
   *
   * Rétablit le moteur, puis transmet immédiatement la commande.
   *
   * La réconciliation préalable avec flespi libère le boîtier si la coupure
   * précédente est terminée sans que personne n'ait consulté son résultat
   * (contrainte CM-09 : une seule commande en vol par boîtier).
   */
  //retablissement du moteur d'un véhicule après l'immobilisation
  async restore(ctx: HttpContext) {
    await authorize(ctx, 'immobilizeVehicles')
    const payload = await ctx.request.validateUsing(restoreEngineValidator)
    const vehicule = await vehicleInScope(ctx, payload.vehicleId)
    if (!vehicule) return notFoundInScope(ctx, 'Véhicule')
    const contexte = { ...toExecutionContext(ctx), organizationId: vehicule.organizationId }

    const r = await this.executer('restore', contexte, payload.vehicleId, payload.reason)
    return r.ok
      ? ctx.response.accepted({ data: r.data })
      : ctx.response.status(r.httpStatus).send({ error: r.error })
  }

  // =========================================================================
  //  IMMOBILISATION CONTRÔLÉE D'UN GROUPE DE VÉHICULES
  // =========================================================================

  /**
   * POST /api/v1/security/vehicle-groups/:id/immobilizations — body : { reason }
   *
   * Coupe IMMÉDIATEMENT le moteur de chaque véhicule du groupe. Chaque
   * véhicule passe par le chemin unitaire, garde-fous compris : un véhicule
   * qui roule est REFUSÉ (CM-07) sans empêcher la coupure des autres. La
   * réponse détaille le sort de chaque véhicule.
   *
   * Pour une immobilisation RÉCURRENTE (hors heures de service), rattacher
   * un calendrier au groupe : POST /usage-schedules/:id/vehicle-groups.
   */
  async storeForGroup(ctx: HttpContext) {
    await authorize(ctx, 'immobilizeVehicles')
    return this.executerGroupe(ctx, 'cut')
  }

  /** POST /api/v1/security/vehicle-groups/:id/restorations — body : { reason } */
  async restoreForGroup(ctx: HttpContext) {
    await authorize(ctx, 'immobilizeVehicles')
    return this.executerGroupe(ctx, 'restore')
  }

  private async executerGroupe(ctx: HttpContext, action: 'cut' | 'restore') {
    const { reason } = await ctx.request.validateUsing(groupEngineCommandValidator)

    const scope = await organizationScope(ctx)
    const query = VehicleGroupModel.query().where('id', ctx.params.id).whereNull('deleted_at')
    if (!scope.isPlatform) query.where('organization_id', scope.organizationId)
    const groupe = await query.first()
    if (!groupe) return notFoundInScope(ctx, 'Groupe')

    const membres = await this.groupMembers.members(groupe.id)
    if (membres.length === 0) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_GROUP_EMPTY',
          message: 'Le groupe ne contient aucun véhicule',
          details: {},
        },
      })
    }
    if (membres.length > MAX_GROUP_COMMANDS) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_GROUP_TOO_LARGE',
          message:
            `Commande de groupe limitée à ${MAX_GROUP_COMMANDS} véhicules (${membres.length} dans ce groupe). ` +
            'Scinder le groupe, ou utiliser un calendrier appliqué par le moteur planifié.',
          details: { members: membres.length, max: MAX_GROUP_COMMANDS },
        },
      })
    }

    // Les commandes appartiennent à l'organisation DU GROUPE (cf. `store`).
    const contexte = { ...toExecutionContext(ctx), organizationId: groupe.organizationId }
    const resultats: Array<{
      vehicleId: string
      registration: string
      ok: boolean
      error?: Record<string, unknown>
      [champ: string]: unknown
    }> = []
    // Séquentiel, volontairement : CM-09 et l'isolation SERIALIZABLE sont
    // pensés pour un flux par boîtier, et flespi n'aime pas les rafales.
    for (const m of membres) {
      const r = await this.executer(action, contexte, m.id, reason)
      resultats.push(
        r.ok
          ? { vehicleId: m.id, registration: m.label, ok: true, ...r.data }
          : { vehicleId: m.id, registration: m.label, ok: false, error: r.error }
      )
    }
    const reussis = resultats.filter((r) => r.ok).length

    await this.audit.record({
      context: contexte,
      action: `security.vehicle_group.${action === 'cut' ? 'immobilization' : 'restoration'}.requested`,
      resourceType: 'vehicle_group',
      resourceId: groupe.id,
      after: { reason, total: resultats.length, succeeded: reussis },
      metadata: {
        refused: resultats
          .filter((r) => !r.ok)
          .map((r) => ({ vehicleId: r.vehicleId, code: r.error?.code ?? null })),
      },
    })

    return ctx.response.ok({
      data: {
        vehicleGroupId: groupe.id,
        action,
        total: resultats.length,
        succeeded: reussis,
        failed: resultats.length - reussis,
        results: resultats,
      },
    })
  }

  /**
   * Chemin UNITAIRE commun : réconciliation flespi (libère CM-09), demande,
   * puis émission dans la foulée. Utilisé par `store`, `restore` et les
   * commandes de groupe : un seul endroit, un seul comportement.
   */
  private async executer(
    action: 'cut' | 'restore',
    contexte: ExecutionContext,
    vehicleId: string,
    reason: string,
    alertId?: string
  ): Promise<
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; httpStatus: number; error: Record<string, unknown> }
  > {
    // flespi injoignable : on continue, la contrainte CM-09 tranchera.
    await this.tracker.syncVehicle(vehicleId).catch(() => undefined)

    const demande =
      action === 'cut'
        ? await this.requestImmobilization.execute({
            context: contexte,
            vehicleId,
            reason,
            origin: 'manual',
            alertId: alertId ?? null,
          })
        : await this.requestEngineRestore.execute({
            context: contexte,
            vehicleId,
            reason,
            origin: 'manual',
          })
    if (!demande.ok) {
      return { ok: false, httpStatus: demande.error.httpStatus, error: demande.error.toJSON() }
    }

    // La commande naît `approved` : on l'émet dans la foulée.
    const envoi = await this.dispatchEngineCommand.execute({
      context: contexte,
      commandId: demande.value.commandId,
    })
    if (!envoi.ok) {
      return {
        ok: false,
        httpStatus: envoi.error.httpStatus,
        error: { ...envoi.error.toJSON(), details: { commandId: demande.value.commandId } },
      }
    }
    return { ok: true, data: { ...envoi.value } }
  }
}
