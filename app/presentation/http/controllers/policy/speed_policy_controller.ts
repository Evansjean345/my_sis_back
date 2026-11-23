import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { speedPolicyProblem } from '#domain/policy/rule_policy'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import {
  findSpeedPolicyDto,
  listSpeedPolicies,
  referencesOf,
  saveSpeedPolicy,
  type SpeedPolicyInput,
  speedPolicyNameTaken,
} from '#infrastructure/persistence/repositories/rule_engine_repository'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { speedPolicyValidator } from '#presentation/http/validators/policy/rule_engine_validators'
import { RuleEngineBase } from '#presentation/http/controllers/policy/rule_engine_base'

/**
 * =========================================================================
 *  POLITIQUES DE VITESSE — `/api/v1[/admin]/speed-policies`
 * =========================================================================
 *
 * Portée globale, sur une zone du MÊME client, ou sur des véhicules (au
 * moins un). Limite 5 à 200 km/h, tolérance, durée minimale de dépassement,
 * gravité, bridage (boîtier compatible). La plus précise l'emporte
 * (véhicule > zone > globale) lors de l'évaluation.
 */
@inject()
export default class SpeedPolicyController extends RuleEngineBase {
  protected readonly kind = 'speed' as const
  protected readonly label = 'politique'
  protected readonly view = 'viewRules' as const
  protected readonly manage = 'manageRules' as const

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
    return ctx.response.ok({ data: await listSpeedPolicies(organizationId) })
  }

  private async sauver(ctx: HttpContext, platform: boolean, id?: string) {
    // Droits et périmètre AVANT la validation du corps (403 / 404 d'abord).
    const organizationId = id
      ? await this.ownedScope(ctx, platform)
      : await this.createScope(ctx, platform, ctx.request.input('organizationId'))
    if (!organizationId) return
    const champs = await ctx.request.validateUsing(speedPolicyValidator)

    const input: SpeedPolicyInput = {
      organizationId,
      name: champs.name,
      scope: champs.scope,
      zoneId: champs.scope === 'zone' ? (champs.zoneId ?? null) : null,
      vehicleIds: champs.scope === 'vehicle' ? [...new Set(champs.vehicleIds ?? [])] : [],
      limitKph: champs.limitKph,
      toleranceKph: champs.toleranceKph ?? 0,
      minDurationSeconds: champs.minDurationSeconds ?? 0,
      severity: champs.severity,
      limiterEnabled: champs.limiterEnabled ?? false,
      active: champs.active ?? true,
    }
    const probleme = speedPolicyProblem(input)
    if (probleme) return this.regle(ctx, 'E_VALIDATION', probleme)
    if (await speedPolicyNameTaken(organizationId, input.name, id)) return this.nomPris(ctx)
    const refs = await referencesOf(organizationId)
    if (input.zoneId && !refs.zones.has(input.zoneId)) {
      return this.regle(ctx, 'E_VALIDATION', 'Choisissez une zone de ce client.')
    }
    if (input.vehicleIds.some((v) => !refs.vehicles.has(v))) {
      return this.regle(ctx, 'E_VALIDATION', "Un véhicule choisi n'appartient pas à ce client.")
    }

    const avant = id ? await findSpeedPolicyDto(id) : null
    const policyId = await this.enregistrer(ctx, () =>
      saveSpeedPolicy(input, toExecutionContext(ctx).actorId, id)
    )
    if (!policyId) return
    const policy = await findSpeedPolicyDto(policyId)
    await this.tracer(ctx, organizationId, policyId, id ? 'updated' : 'created', {
      before: avant ? resume(avant) : undefined,
      after: policy ? resume(policy) : undefined,
    })
    return id ? ctx.response.ok({ data: policy }) : ctx.response.created({ data: policy })
  }
}

function resume(p: NonNullable<Awaited<ReturnType<typeof findSpeedPolicyDto>>>) {
  return {
    name: p.name,
    scope: p.scope,
    zoneId: p.zoneId,
    vehicleIds: p.vehicleIds,
    limitKph: p.limitKph,
    toleranceKph: p.toleranceKph,
    minDurationSeconds: p.minDurationSeconds,
    severity: p.severity,
    limiterEnabled: p.limiterEnabled,
    active: p.active,
  }
}
