import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { geofenceProblem } from '#domain/policy/rule_policy'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import {
  findGeofenceDto,
  geofenceNameTaken,
  type GeofenceInput,
  listGeofences,
  referencesOf,
  saveGeofence,
} from '#infrastructure/persistence/repositories/rule_engine_repository'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { geofenceValidator } from '#presentation/http/validators/policy/rule_engine_validators'
import { RuleEngineBase } from '#presentation/http/controllers/policy/rule_engine_base'

/**
 * =========================================================================
 *  ZONES GÉOGRAPHIQUES — `/api/v1[/admin]/geofences`
 * =========================================================================
 *
 * Cercle (centre + rayon ≥ 50 m) ou polygone (3 sommets minimum), zone
 * autorisée (alerte à la sortie) ou interdite (alerte à l'entrée), véhicules
 * surveillés (aucun = tous ceux du client). Les règles « entrée / sortie de
 * zone » ne visent qu'une zone active réglée pour cet événement.
 */
@inject()
export default class GeofenceController extends RuleEngineBase {
  protected readonly kind = 'geofence' as const
  protected readonly label = 'zone'
  protected readonly view = 'viewGeofences' as const
  protected readonly manage = 'manageGeofences' as const

  constructor(audit: LucidAuditLogger) {
    super(audit)
  }

  async index(ctx: HttpContext) {
    return this.lister(ctx, false)
  }
  async indexAll(ctx: HttpContext) {
    return this.lister(ctx, true)
  }
  async store(ctx: HttpContext) {
    return this.sauver(ctx, false)
  }
  async storeAll(ctx: HttpContext) {
    return this.sauver(ctx, true)
  }
  async update(ctx: HttpContext) {
    return this.sauver(ctx, false, ctx.params.id)
  }
  async updateAll(ctx: HttpContext) {
    return this.sauver(ctx, true, ctx.params.id)
  }
  async toggle(ctx: HttpContext) {
    return this.basculer(ctx, false)
  }
  async toggleAll(ctx: HttpContext) {
    return this.basculer(ctx, true)
  }

  // -------------------------------------------------------------------------

  private async lister(ctx: HttpContext, platform: boolean) {
    const organizationId = await this.listScope(ctx, platform)
    return ctx.response.ok({ data: await listGeofences(organizationId) })
  }

  private async sauver(ctx: HttpContext, platform: boolean, id?: string) {
    // Droits et périmètre AVANT la validation du corps (403 / 404 d'abord).
    const organizationId = id
      ? await this.ownedScope(ctx, platform)
      : await this.createScope(ctx, platform, ctx.request.input('organizationId'))
    if (!organizationId) return
    const champs = await ctx.request.validateUsing(geofenceValidator)

    const input: GeofenceInput = {
      organizationId,
      name: champs.name,
      description: champs.description ?? null,
      shape: champs.shape,
      center: champs.shape === 'circle' ? (champs.center ?? null) : null,
      radiusM: champs.shape === 'circle' ? (champs.radiusM ?? null) : null,
      points: champs.shape === 'polygon' ? (champs.points ?? []) : [],
      kind: champs.kind,
      alertOnEntry: champs.alertOnEntry,
      alertOnExit: champs.alertOnExit,
      vehicleIds: [...new Set(champs.vehicleIds ?? [])],
      color: champs.color ?? '#2563eb',
      active: champs.active ?? true,
    }
    const probleme = geofenceProblem(input)
    if (probleme) return this.regle(ctx, 'E_VALIDATION', probleme)
    if (await geofenceNameTaken(organizationId, input.name, id)) return this.nomPris(ctx)
    const refs = await referencesOf(organizationId)
    if (input.vehicleIds.some((v) => !refs.vehicles.has(v))) {
      return this.regle(ctx, 'E_VALIDATION', "Un véhicule choisi n'appartient pas à ce client.")
    }

    const avant = id ? await findGeofenceDto(id) : null
    const zoneId = await this.enregistrer(ctx, () =>
      saveGeofence(input, toExecutionContext(ctx).actorId, id)
    )
    if (!zoneId) return
    const zone = await findGeofenceDto(zoneId)
    await this.tracer(ctx, organizationId, zoneId, id ? 'updated' : 'created', {
      before: avant ? resume(avant) : undefined,
      after: zone ? resume(zone) : undefined,
    })
    return id ? ctx.response.ok({ data: zone }) : ctx.response.created({ data: zone })
  }
}

function resume(z: NonNullable<Awaited<ReturnType<typeof findGeofenceDto>>>) {
  return {
    name: z.name,
    shape: z.shape,
    kind: z.kind,
    alertOnEntry: z.alertOnEntry,
    alertOnExit: z.alertOnExit,
    vehicleIds: z.vehicleIds,
    active: z.active,
  }
}
