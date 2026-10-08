import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { RequestImmobilization } from '#application/security/use_cases/request_immobilization'
import { ValidateImmobilization } from '#application/security/use_cases/validate_immobilization'
import { DispatchEngineCommand } from '#application/security/use_cases/dispatch_engine_command'
import { RequestEngineRestore } from '#application/security/use_cases/request_engine_restore'
import { FlespiCommandTracker } from '#infrastructure/gateways/flespi/flespi_command_tracker'
import {
  requestImmobilizationValidator,
  restoreEngineValidator,
  validateImmobilizationValidator,
} from '#presentation/http/validators/security/immobilization_validators'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { authorize } from '#presentation/http/support/authorize'
import {
  commandInScope,
  notFoundInScope,
  vehicleInScope,
} from '#presentation/http/support/tenant_resources'

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
    private readonly validateImmobilization: ValidateImmobilization,
    private readonly dispatchEngineCommand: DispatchEngineCommand,
    private readonly requestEngineRestore: RequestEngineRestore,
    private readonly tracker: FlespiCommandTracker
  ) {}

  /**
   Prmeière fonction distincte pour l'immobilsation controllée(demande)
   */
  /** POST /api/v1/security/immobilizations */
  /*
  async store(ctx: HttpContext) {
    await authorize(ctx, 'requestImmobilization')
    const payload = await ctx.request.validateUsing(requestImmobilizationValidator)

    const result = await this.requestImmobilization.execute({
      context: toExecutionContext(ctx),
      vehicleId: payload.vehicleId,
      reason: payload.reason,
      origin: 'manual',
      alertId: payload.alertId ?? null,
    })

    if (!result.ok) {
      return ctx.response.status(result.error.httpStatus).send({ error: result.error.toJSON() })
    }

    return ctx.response.status(200).send({ data: result.value })
  } */
  //Etape 1 et 3 immobilization et dispatch
  /*
  Fonction finale pour l'immobilisation controllée(demande) et l'envoi de la commande
  */
  /** POST /api/v1/security/immobilizations */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'requestImmobilization')
    const payload = await ctx.request.validateUsing(requestImmobilizationValidator)

    // Cloisonnement : le cas d'usage lit l'état du véhicule sans filtre
    // d'organisation. Un véhicule d'un autre client est introuvable.
    const vehicule = await vehicleInScope(ctx, payload.vehicleId)
    if (!vehicule) return notFoundInScope(ctx, 'Véhicule')
    // La commande appartient à l'organisation DU VÉHICULE (identique à celle
    // de l'acteur côté client ; différente pour l'exploitant plateforme).
    const contexte = { ...toExecutionContext(ctx), organizationId: vehicule.organizationId }

    //fonction felspi pour envoyer les commandes au tracker
    await this.tracker.syncVehicle(payload.vehicleId).catch(() => undefined) // libère CM-09

    //use_case pour demander l'immobilisation du véhicule
    const demande = await this.requestImmobilization.execute({
      context: contexte,
      vehicleId: payload.vehicleId,
      reason: payload.reason,
      origin: 'manual',
      alertId: payload.alertId ?? null,
    })
    if (!demande.ok) {
      return ctx.response.status(demande.error.httpStatus).send({ error: demande.error.toJSON() })
    }

    // Sans double validation, la commande est déjà `approved` : on émet dans la foulée.
    if (demande.value.requiresValidation) {
      return ctx.response.ok({ data: demande.value }) // comportement historique préservé
    }

    //use_case pour envoyer la commande d'immobilisation au tracker
    const envoi = await this.dispatchEngineCommand.execute({
      context: contexte,
      commandId: demande.value.commandId,
    })
    if (!envoi.ok) {
      return ctx.response.status(envoi.error.httpStatus).send({
        error: { ...envoi.error.toJSON(), details: { commandId: demande.value.commandId } },
      })
    }
    return ctx.response.accepted({ data: envoi.value })
  }

  /** POST /api/v1/security/immobilizations/:id/validation */
  //requete pour la validation de l'immobilisation --- à supprimer la double validation est inutile
  async validate(ctx: HttpContext) {
    await authorize(ctx, 'validateImmobilization')
    const payload = await ctx.request.validateUsing(validateImmobilizationValidator)
    const commande = await commandInScope(ctx, ctx.params.id)
    if (!commande) return notFoundInScope(ctx, 'Commande')

    const result = await this.validateImmobilization.execute({
      context: { ...toExecutionContext(ctx), organizationId: commande.organizationId },
      commandId: ctx.params.id,
      decision: payload.decision,
      rejectionReason: payload.rejectionReason,
    })

    if (!result.ok) {
      return ctx.response.status(result.error.httpStatus).send({ error: result.error.toJSON() })
    }

    return ctx.response.ok({ data: result.value })
  }

  /**
   * POST /api/v1/security/immobilizations/:id/dispatch
   *
   * ÉMISSION RÉELLE vers le boîtier — la seule route du système qui agit
   * physiquement sur un véhicule. Elle n'aboutit qu'après la demande (premier
   * contrôle de vitesse) et la validation par un second opérateur (deuxième
   * contrôle) ; le cas d'usage en effectue un troisième avant d'émettre.
   *
   * Étape volontairement SÉPARÉE de la validation : valider est une décision,
   * émettre est un acte. Les tracer séparément permet de savoir, en audit, si
   * une coupure validée a réellement été transmise.
   */
  //envoi d'une commande à felspi pour l'immobilisation du véhicule après la validation de l'immobilisation
  //à supprimer garder ou supprimer -- à definir après code review(point final à supprimer)
  async dispatch(ctx: HttpContext) {
    await authorize(ctx, 'validateImmobilization')
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
   * Rétablit le moteur, puis transmet immédiatement la commande : on ne fait
   * pas attendre un véhicule immobilisé qu'un second opérateur se connecte.
   *
   * La réconciliation préalable avec flespi libère le boîtier si la coupure
   * précédente est terminée sans que personne n'ait consulté son résultat
   * (contrainte CM-09 : une seule commande en vol par boîtier).
   */
  //retablissement du moteur d'un véhicule après l'immobilisation
  async restore(ctx: HttpContext) {
    await authorize(ctx, 'requestImmobilization')
    const payload = await ctx.request.validateUsing(restoreEngineValidator)
    const vehicule = await vehicleInScope(ctx, payload.vehicleId)
    if (!vehicule) return notFoundInScope(ctx, 'Véhicule')
    const contexte = { ...toExecutionContext(ctx), organizationId: vehicule.organizationId }

    await this.synchroniser(payload.vehicleId)

    //use_case pour demander le rétablissement du moteur du véhicule
    const demande = await this.requestEngineRestore.execute({
      context: contexte,
      vehicleId: payload.vehicleId,
      reason: payload.reason,
      origin: 'manual',
    })
    if (!demande.ok) {
      return ctx.response.status(demande.error.httpStatus).send({ error: demande.error.toJSON() })
    }

    //dispatch de la commande de rétablissement du moteur du véhicule après la demande de rétablissement
    const envoi = await this.dispatchEngineCommand.execute({
      context: contexte,
      commandId: demande.value.commandId,
    })
    if (!envoi.ok) {
      return ctx.response.status(envoi.error.httpStatus).send({
        error: { ...envoi.error.toJSON(), details: { commandId: demande.value.commandId } },
      })
    }

    return ctx.response.accepted({ data: envoi.value })
  }

  /** Fait avancer les commandes en vol du boîtier à partir des résultats flespi. */
  private async synchroniser(vehicleId: string): Promise<void> {
    // flespi injoignable : on continue, la contrainte CM-09 tranchera.
    await this.tracker.syncVehicle(vehicleId).catch(() => undefined)
  }
}
