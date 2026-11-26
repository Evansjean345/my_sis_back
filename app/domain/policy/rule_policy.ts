/*
actions lié à une règle
*/
import { ACTIONS_WITHOUT_VALUE } from '#domain/policy/code_legacy/rule/rule_actions'
/*
severité d'une règle
*/
import { SEVERITIES, type Severity } from '#domain/policy/code_legacy/rule/rule_event_severity'
/*
types d'évènements lié à une règle
*/
import {
  type EventType,
  PUSH_ONLY_EVENT_TYPES,
} from '#domain/policy/code_legacy/rule/rule_event_types'
/*
champs d'une règle
*/
import {
  EVENT_RULE_FIELDS,
  RULE_OPERATORS_BY_FIELD,
  type RuleField,
  TIME_RANGE_PATTERN,
} from '#domain/policy/code_legacy/rule/rule_fields'
/*
canal de notification
*/
import type { NotificationChannel } from '#domain/policy/code_legacy/rule/rule_notification_channels'
/*
types de règles
*/
import type {
  ConditionTarget,
  ResolvedCondition,
  RuleConditionInput,
  RuleDraft,
  RuleReferences,
} from '#domain/policy/code_legacy/rule/rule_types'
/*
type de geofence
*/
import {
  type GeofenceDraft,
  type GeofenceKind,
  MIN_CIRCLE_RADIUS_M,
  MIN_POLYGON_POINTS,
} from '#domain/policy/code_legacy/rule/geofence_types'
/*
types de règles pour une politique de vitesse
*/
import {
  SPEED_LIMIT_MAX_KPH,
  SPEED_LIMIT_MIN_KPH,
  type SpeedPolicyDraft,
} from '#domain/policy/code_legacy/rule/speed_policy_types'

/**
 * =========================================================================
 *  MOTEUR DE RÈGLES — fonctions pures, sans I/O
 * =========================================================================
 *
 * Les référentiels (événements, gravités, champs, opérateurs, actions,
 * canaux) et les interfaces sont dans `domain/code_legacy/rule/`. Ce fichier
 * ne contient que les règles de gestion qui les utilisent.
 *
 * Les données qui demandent la base (zones, politiques, véhicules… d'une
 * organisation) sont chargées par l'infrastructure et passées en paramètre
 * (`RuleReferences`).
 */

// ------------------------------------------------------------------ règles

/** Champs de condition acceptés pour un événement. */
export function ruleFieldsForEvent(event: EventType): readonly RuleField[] {
  return EVENT_RULE_FIELDS[event] ?? []
}

/** Canaux d'une notification : push toujours, plus SMS / e-mail si l'événement le permet. */
export function notificationChannels(
  event: EventType,
  channels: readonly string[] = []
): NotificationChannel[] {
  if (PUSH_ONLY_EVENT_TYPES.includes(event)) return ['push']
  return [
    ...new Set<NotificationChannel>([
      'push',
      ...channels.filter((c): c is NotificationChannel => c === 'sms' || c === 'email'),
    ]),
  ]
}

/**
 * Zones visées par une condition `zone` : pour une SORTIE, plusieurs zones
 * (OU), dédoublonnées ; sinon une seule.
 */
export function zoneIdsOf(trigger: EventType, condition: RuleConditionInput): string[] {
  if (trigger === 'geofence_exit') {
    const ids = condition.values?.length
      ? condition.values
      : condition.value
        ? [condition.value]
        : []
    return [...new Set(ids)]
  }
  return condition.value ? [condition.value] : []
}

/** Cible normalisée d'une condition : `all` par défaut, id vide si absent. */
export function conditionTarget(target?: {
  type: ConditionTarget['type']
  id?: string
}): ConditionTarget {
  if (!target || target.type === 'all') return { type: 'all' }
  return { type: target.type, id: target.id ?? '' }
}

/**
 * Cohérence d'une règle (forme seulement) : renvoie le premier problème, ou
 * `null`. Messages destinés à l'utilisateur.
 */
export function ruleProblem(input: RuleDraft): string | null {
  if (!input.name.trim()) return 'Nom de la règle obligatoire.'
  if (input.actions.length === 0) return 'Ajoutez au moins une action.'
  if (input.actions.some((a) => !ACTIONS_WITHOUT_VALUE.includes(a.type) && !a.value.trim())) {
    return 'Renseignez le paramètre de chaque action.'
  }
  if (input.actions.some((a) => a.type === 'alert' && !SEVERITIES.includes(a.value as Severity))) {
    return 'Choisissez une gravité valide pour chaque alerte.'
  }
  const allowed = ruleFieldsForEvent(input.trigger)
  for (const c of input.conditions) {
    if (!allowed.includes(c.field)) {
      return "Une condition ne correspond pas à l'événement sélectionné."
    }
    if (!RULE_OPERATORS_BY_FIELD[c.field].includes(c.operator)) {
      return 'Un opérateur ne correspond pas au type de condition.'
    }
    if (c.field === 'zone' ? zoneIdsOf(input.trigger, c).length === 0 : !c.value.trim()) {
      return 'Chaque condition doit avoir une valeur.'
    }
    if ((c.field === 'speed' || c.field === 'duration') && !(Number(c.value) >= 0)) {
      return 'La vitesse et la durée doivent être supérieures ou égales à zéro.'
    }
    if (c.field === 'time' && !TIME_RANGE_PATTERN.test(c.value)) {
      return 'Indiquez une plage horaire valide (HH:MM-HH:MM).'
    }
    if (c.target && c.target.type !== 'all' && !c.target.id) {
      return c.target.type === 'vehicle'
        ? 'Choisissez le véhicule de la condition.'
        : 'Choisissez la flotte de la condition.'
    }
  }
  return null
}

/** Une zone est-elle réglée pour cet événement (entrée ou sortie) ? */
function zoneWatches(
  zone: { active: boolean; alertOnEntry: boolean; alertOnExit: boolean } | undefined,
  trigger: EventType
): boolean {
  if (!zone?.active) return false
  if (trigger === 'geofence_exit') return zone.alertOnExit
  if (trigger === 'geofence_entry') return zone.alertOnEntry
  return true
}

/**
 * Vérifie les références des conditions dans l'organisation et calcule leurs
 * libellés (à appeler après `ruleProblem`) :
 *   - politique de vitesse, zone, calendrier : ACTIFS et du même client ;
 *   - une zone doit être réglée pour l'événement (entrée / sortie) ;
 *   - cible : véhicule actif ou flotte du client.
 * Renvoie le premier problème, ou les conditions prêtes à stocker.
 */
export function resolveConditions(
  trigger: EventType,
  conditions: readonly RuleConditionInput[],
  refs: RuleReferences
): { problem: string } | { conditions: ResolvedCondition[] } {
  const resolved: ResolvedCondition[] = []
  for (const [i, c] of conditions.entries()) {
    const out: ResolvedCondition = {
      id: `c${i + 1}`,
      field: c.field,
      operator: c.operator,
      value: c.value,
      target: { type: 'all' },
    }

    if (c.field === 'speed_policy') {
      const policy = refs.speedPolicies.get(c.value)
      if (!policy?.active)
        return { problem: 'Choisissez une politique de vitesse active de ce client.' }
      out.valueLabel = policy.name
    }
    if (c.field === 'zone') {
      const ids = zoneIdsOf(trigger, c)
      const zones = ids.map((id) => refs.zones.get(id))
      if (zones.some((z) => !zoneWatches(z, trigger))) {
        return { problem: "Chaque zone choisie doit être active et configurée pour l'événement." }
      }
      out.value = ids[0]
      out.valueLabel = zones[0]!.name
      if (trigger === 'geofence_exit') {
        out.values = ids
        out.valueLabels = zones.map((z) => z!.name)
      }
    }
    if (c.field === 'schedule') {
      const schedule = refs.schedules.get(c.value)
      if (!schedule?.active) return { problem: 'Choisissez un calendrier actif de ce client.' }
      out.valueLabel = schedule.name
    }

    const target = c.target ?? { type: 'all' as const }
    if (target.type === 'vehicle') {
      const vehicle = refs.vehicles.get(target.id)
      if (!vehicle?.active) {
        return { problem: "Le véhicule choisi n'est pas actif ou n'appartient pas à ce client." }
      }
      out.target = { type: 'vehicle', id: target.id, label: vehicle.registration }
    } else if (target.type === 'fleet') {
      const fleet = refs.fleets.get(target.id)
      if (!fleet) return { problem: "La flotte choisie n'appartient pas à ce client." }
      out.target = { type: 'fleet', id: target.id, label: fleet.name }
    }
    resolved.push(out)
  }
  return { conditions: resolved }
}

// ------------------------------------------------------------------- zones

/**
 * Événement surveillé par une zone, déduit de son TYPE :
 *   - zone interdite → les règles se déclenchent à l'ENTRÉE ;
 *   - zone autorisée → à la SORTIE.
 * Les actions (alerte, notification…) se configurent dans le moteur de règles.
 */
export function geofenceAlerts(kind: GeofenceKind): {
  alertOnEntry: boolean
  alertOnExit: boolean
} {
  return { alertOnEntry: kind === 'forbidden', alertOnExit: kind === 'authorized' }
}

/** Géométrie d'une zone : premier problème, ou `null`. */
export function geofenceProblem(input: GeofenceDraft): string | null {
  if (!input.name.trim()) return 'Nom de la zone obligatoire.'
  if (
    input.shape === 'circle' &&
    (!input.center || !input.radiusM || input.radiusM < MIN_CIRCLE_RADIUS_M)
  ) {
    return `Cercle : placez le centre sur la carte, rayon de ${MIN_CIRCLE_RADIUS_M} m minimum.`
  }
  if (input.shape === 'polygon' && input.points.length < MIN_POLYGON_POINTS) {
    return `Polygone : cliquez au moins ${MIN_POLYGON_POINTS} sommets sur la carte.`
  }
  return null
}

// --------------------------------------------------- politiques de vitesse

/** Politique de vitesse : premier problème, ou `null`. */
export function speedPolicyProblem(input: SpeedPolicyDraft): string | null {
  if (!input.name.trim()) return 'Nom obligatoire.'
  if (input.limitKph < SPEED_LIMIT_MIN_KPH || input.limitKph > SPEED_LIMIT_MAX_KPH) {
    return `Limite entre ${SPEED_LIMIT_MIN_KPH} et ${SPEED_LIMIT_MAX_KPH} km/h.`
  }
  if (input.scope === 'zone' && !input.zoneId) return 'Choisissez une zone de ce client.'
  if (input.scope === 'vehicle' && input.vehicleIds.length === 0) {
    return 'Choisissez au moins un véhicule.'
  }
  return null
}
