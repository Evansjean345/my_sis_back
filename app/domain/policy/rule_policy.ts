/**
 * =========================================================================
 *  MOTEUR DE RÈGLES — règles pures, sans I/O
 * =========================================================================
 *
 * Référentiel partagé avec le tableau de bord (spécifications §III.2 / §III.3) :
 * événements, gravités, champs et opérateurs de condition, types d'action,
 * canaux de notification. Les vérifications qui demandent la base
 * (appartenance d'une zone, d'un véhicule…) restent dans les contrôleurs.
 */

/** Événements GPS normalisés qui déclenchent une règle. */
export const EVENT_TYPES = [
  'overspeed',
  'geofence_exit',
  'geofence_entry',
  'schedule_violation',
  'power_cut',
  'disconnection',
  'sos',
  'jamming',
  'towing',
  'tamper',
  'harsh_driving',
  'engine_start',
  'engine_stop',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

export const NOTIFICATION_CHANNELS = ['sms', 'email', 'push'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const RULE_FIELDS = [
  'speed',
  'speed_policy',
  'zone',
  'time',
  'duration',
  'schedule',
  'ignition',
  'vehicle',
] as const
export type RuleField = (typeof RULE_FIELDS)[number]

export const RULE_OPERATORS = ['gt', 'lt', 'eq', 'neq', 'in', 'outside'] as const
export type RuleOperator = (typeof RULE_OPERATORS)[number]

export const RULE_OPERATORS_BY_FIELD: Record<RuleField, readonly RuleOperator[]> = {
  speed: ['gt', 'lt', 'eq', 'neq'],
  speed_policy: ['eq'],
  zone: ['eq'],
  time: ['in', 'outside'],
  duration: ['gt', 'lt', 'eq', 'neq'],
  schedule: ['eq'],
  ignition: ['eq', 'neq'],
  vehicle: ['eq', 'neq'],
}

/** Conditions acceptées par événement : celles qui peuvent réellement le produire. */
const EVENT_RULE_FIELDS: Partial<Record<EventType, readonly RuleField[]>> = {
  overspeed: ['speed_policy'],
  geofence_exit: ['zone'],
  geofence_entry: ['zone'],
  schedule_violation: ['schedule'],
}

export function ruleFieldsForEvent(event: EventType): readonly RuleField[] {
  return EVENT_RULE_FIELDS[event] ?? []
}

/** Événements toujours notifiés par push seul (masqués des formulaires de règle). */
export const PUSH_ONLY_EVENT_TYPES: readonly EventType[] = [
  'towing',
  'sos',
  'jamming',
  'engine_stop',
  'harsh_driving',
  'tamper',
  'disconnection',
]

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

export const RULE_ACTION_TYPES = ['alert', 'notify', 'incident', 'command'] as const
export type RuleActionType = (typeof RULE_ACTION_TYPES)[number]

export type ConditionTarget =
  | { type: 'all' }
  | { type: 'vehicle'; id: string; label?: string }
  | { type: 'fleet'; id: string; label?: string }

export interface RuleConditionInput {
  field: RuleField
  operator: RuleOperator
  value: string
  values?: string[]
  target?: ConditionTarget
}

export interface RuleActionInput {
  type: RuleActionType
  value: string
  channels?: string[]
}

const TIME_RANGE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/

/**
 * Zones visées par une condition `zone` : pour une SORTIE, plusieurs zones
 * (OU) ; sinon une seule.
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

/**
 * Cohérence d'une règle (forme seulement) : renvoie le premier problème, ou
 * `null`. Messages destinés à l'utilisateur.
 */
export function ruleProblem(input: {
  name: string
  trigger: EventType
  conditions: readonly RuleConditionInput[]
  actions: readonly RuleActionInput[]
}): string | null {
  if (!input.name.trim()) return 'Nom de la règle obligatoire.'
  if (input.actions.length === 0) return 'Ajoutez au moins une action.'
  if (input.actions.some((a) => a.type !== 'alert' && a.type !== 'notify' && !a.value.trim())) {
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
    if (c.field === 'time' && !TIME_RANGE.test(c.value)) {
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

// ---------------------------------------------------------------- zones

export interface LatLng {
  lat: number
  lng: number
}

/** Rayon minimal d'une zone circulaire (mètres). */
export const MIN_CIRCLE_RADIUS_M = 50

export function geofenceProblem(input: {
  name: string
  shape: 'circle' | 'polygon'
  center: LatLng | null
  radiusM: number | null
  points: readonly LatLng[]
  alertOnEntry: boolean
  alertOnExit: boolean
}): string | null {
  if (!input.name.trim()) return 'Nom de la zone obligatoire.'
  if (
    input.shape === 'circle' &&
    (!input.center || !input.radiusM || input.radiusM < MIN_CIRCLE_RADIUS_M)
  ) {
    return `Cercle : placez le centre sur la carte, rayon de ${MIN_CIRCLE_RADIUS_M} m minimum.`
  }
  if (input.shape === 'polygon' && input.points.length < 3) {
    return 'Polygone : cliquez au moins 3 sommets sur la carte.'
  }
  if (!input.alertOnEntry && !input.alertOnExit) {
    return 'Choisissez au moins une alerte (entrée ou sortie).'
  }
  return null
}

// ---------------------------------------------------- politiques de vitesse

export const SPEED_SCOPES = ['global', 'zone', 'vehicle'] as const
export type SpeedScope = (typeof SPEED_SCOPES)[number]

export function speedPolicyProblem(input: {
  name: string
  scope: SpeedScope
  zoneId: string | null
  vehicleIds: readonly string[]
  limitKph: number
}): string | null {
  if (!input.name.trim()) return 'Nom obligatoire.'
  if (input.limitKph < 5 || input.limitKph > 200) return 'Limite entre 5 et 200 km/h.'
  if (input.scope === 'zone' && !input.zoneId) return 'Choisissez une zone de ce client.'
  if (input.scope === 'vehicle' && input.vehicleIds.length === 0) {
    return 'Choisissez au moins un véhicule.'
  }
  return null
}
