import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { RuleConditionInput } from '#domain/policy/code_legacy/rule/rule_types'
import {
  conditionTarget,
  notificationChannels,
  resolveConditions,
  ruleProblem,
} from '#domain/policy/rule_policy'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import {
  findRuleDto,
  listRules,
  referencesOf,
  ruleNameTaken,
  saveRule,
} from '#infrastructure/persistence/repositories/rule_engine_repository'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { ruleValidator } from '#presentation/http/validators/policy/rule_engine_validators'
import { RuleEngineBase } from '#presentation/http/controllers/policy/rule_engine_base'

/**
 * =========================================================================
 *  RÈGLES — `/api/v1[/admin]/rules`
 * =========================================================================
 *
 * Une règle = un événement déclencheur + des conditions (ET ; les zones
 * d'une même SORTIE en OU) + des actions ordonnées (alerte, notification,
 * incident, commande) + une gravité. Une règle inactive n'est jamais évaluée.
 *
 * Vérifications (mêmes que la maquette) :
 *   - chaque condition correspond à l'événement et à son opérateur ;
 *   - politique de vitesse, zone, calendrier : ACTIFS et du même client ;
 *     une zone doit être réglée pour l'événement (entrée / sortie) ;
 *   - cible d'une condition : véhicule actif ou flotte du client ;
 *   - au moins une action ; notification : push toujours, SMS / e-mail
 *     seulement hors événements « push seul ».
 *
 * Forme : `ruleProblem` ; références et libellés (`valueLabel`,
 * `target.label`) : `resolveConditions` — deux fonctions pures du domaine.
 * Ce contrôleur ne fait que charger, orchestrer et répondre.
 */
@inject()
export default class RuleController extends RuleEngineBase {
  protected readonly kind = 'rule' as const
  protected readonly label = 'règle'
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
    return ctx.response.ok({ data: await listRules(organizationId) })
  }

  private async sauver(ctx: HttpContext, platform: boolean, id?: string) {
    // Droits et périmètre AVANT la validation du corps (403 / 404 d'abord).
    const organizationId = id
      ? await this.ownedScope(ctx, platform)
      : await this.createScope(ctx, platform, ctx.request.input('organizationId'))
    if (!organizationId) return
    const champs = await ctx.request.validateUsing(ruleValidator)

    const trigger = champs.trigger
    const conditions: RuleConditionInput[] = champs.conditions.map((c) => ({
      field: c.field,
      operator: c.operator,
      value: c.value ?? '',
      values: c.values,
      target: conditionTarget(c.target),
    }))
    const actions = champs.actions.map((a) => ({
      type: a.type,
      value: a.value ?? '',
      ...(a.type === 'notify' ? { channels: notificationChannels(trigger, a.channels) } : {}),
    }))
    const probleme = ruleProblem({ name: champs.name, trigger, conditions, actions })
    if (probleme) return this.regle(ctx, 'E_VALIDATION', probleme)
    if (await ruleNameTaken(organizationId, champs.name, id)) return this.nomPris(ctx)

    // Références du client (zones, politiques, véhicules…) vérifiées par le domaine.
    const resolution = resolveConditions(trigger, conditions, await referencesOf(organizationId))
    if ('problem' in resolution) return this.regle(ctx, 'E_VALIDATION', resolution.problem)

    const avant = id ? await findRuleDto(id) : null
    const ruleId = await this.enregistrer(ctx, () =>
      saveRule(
        {
          organizationId,
          name: champs.name,
          description: champs.description ?? null,
          trigger,
          conditions: resolution.conditions,
          actions,
          severity: champs.severity,
          active: champs.active ?? true,
        },
        toExecutionContext(ctx).actorId,
        id
      )
    )
    if (!ruleId) return
    const regle = await findRuleDto(ruleId)
    await this.tracer(ctx, organizationId, ruleId, id ? 'updated' : 'created', {
      before: avant ? resume(avant) : undefined,
      after: regle ? resume(regle) : undefined,
    })
    return id ? ctx.response.ok({ data: regle }) : ctx.response.created({ data: regle })
  }
}

function resume(r: NonNullable<Awaited<ReturnType<typeof findRuleDto>>>) {
  return {
    name: r.name,
    trigger: r.trigger,
    severity: r.severity,
    active: r.active,
    conditions: r.conditions,
    actions: r.actions.map((a) => ({ type: a.type, value: a.value, channels: a.channels })),
  }
}
