import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import {
  type ConditionTarget,
  type EventType,
  notificationChannels,
  type RuleConditionInput,
  ruleProblem,
  zoneIdsOf,
} from '#domain/policy/rule_policy'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import {
  findRuleDto,
  listRules,
  referencesOf,
  type RuleConditionDto,
  ruleNameTaken,
  saveRule,
} from '#infrastructure/persistence/repositories/rule_engine_repository'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { ruleValidator } from '#presentation/http/validators/policy/rule_engine_validators'
import { RuleEngineBase } from '#presentation/http/controllers/policy/rule_engine_base'

type References = Awaited<ReturnType<typeof referencesOf>>

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
 * Les libellés (`valueLabel`, `target.label`) sont recalculés ici.
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
      target: cible(c.target),
    }))
    const actions = champs.actions.map((a) => ({
      type: a.type,
      value: a.value ?? '',
      ...(a.type === 'notify' ? { channels: notificationChannels(trigger, a.channels) } : {}),
    }))
    const probleme = ruleProblem({ name: champs.name, trigger, conditions, actions })
    if (probleme) return this.regle(ctx, 'E_VALIDATION', probleme)
    if (await ruleNameTaken(organizationId, champs.name, id)) return this.nomPris(ctx)

    const refs = await referencesOf(organizationId)
    const resolues = resoudre(trigger, conditions, refs)
    if (typeof resolues === 'string') return this.regle(ctx, 'E_VALIDATION', resolues)

    const avant = id ? await findRuleDto(id) : null
    const ruleId = await this.enregistrer(ctx, () =>
      saveRule(
        {
          organizationId,
          name: champs.name,
          description: champs.description ?? null,
          trigger,
          conditions: resolues,
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

function cible(t?: { type: 'all' | 'vehicle' | 'fleet'; id?: string }): ConditionTarget {
  if (!t || t.type === 'all') return { type: 'all' }
  return { type: t.type, id: t.id ?? '' }
}

/**
 * Vérifie les références des conditions dans l'organisation et calcule leurs
 * libellés. Renvoie le message d'erreur, ou les conditions prêtes à stocker.
 */
function resoudre(
  trigger: EventType,
  conditions: RuleConditionInput[],
  refs: References
): RuleConditionDto[] | string {
  const sortie: RuleConditionDto[] = []
  for (const [i, c] of conditions.entries()) {
    const out: RuleConditionDto = {
      id: `c${i + 1}`,
      field: c.field,
      operator: c.operator,
      value: c.value,
    }

    if (c.field === 'speed_policy') {
      const p = refs.speedPolicies.get(c.value)
      if (!p?.is_active) return 'Choisissez une politique de vitesse active de ce client.'
      out.valueLabel = p.name
    }
    if (c.field === 'zone') {
      const ids = zoneIdsOf(trigger, c)
      const zones = ids.map((z) => refs.zones.get(z))
      const reglee = (z: any) =>
        z?.is_active &&
        (trigger === 'geofence_exit'
          ? z.alert_on_exit
          : trigger === 'geofence_entry'
            ? z.alert_on_entry
            : true)
      if (zones.some((z) => !reglee(z))) {
        return "Chaque zone choisie doit être active et configurée pour l'événement."
      }
      out.value = ids[0]
      out.valueLabel = zones[0]!.name
      if (trigger === 'geofence_exit') {
        out.values = ids
        out.valueLabels = zones.map((z) => z!.name)
      }
    }
    if (c.field === 'schedule') {
      const s = refs.schedules.get(c.value)
      if (!s?.is_active) return 'Choisissez un calendrier actif de ce client.'
      out.valueLabel = s.name
    }

    const t = c.target ?? { type: 'all' as const }
    if (t.type === 'vehicle') {
      const v = refs.vehicles.get(t.id)
      if (!v || v.status !== 'active') {
        return "Le véhicule choisi n'est pas actif ou n'appartient pas à ce client."
      }
      out.target = { type: 'vehicle', id: t.id, label: v.registration }
    } else if (t.type === 'fleet') {
      const f = refs.fleets.get(t.id)
      if (!f) return "La flotte choisie n'appartient pas à ce client."
      out.target = { type: 'fleet', id: t.id, label: f.name }
    } else {
      out.target = { type: 'all' }
    }
    sortie.push(out)
  }
  return sortie
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
