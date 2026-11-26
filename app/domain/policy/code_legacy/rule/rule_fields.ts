import type { EventType } from '#domain/policy/code_legacy/rule/rule_event_types'
import type { RuleOperator } from '#domain/policy/code_legacy/rule/rule_operators'

/**
 * =========================================================================
 *  RÈGLES — champs de condition (référentiel en dur)
 * =========================================================================
 *
 * Ce qu'une condition compare :
 *   speed         vitesse (km/h)
 *   speed_policy  politique de vitesse du client
 *   zone          zone géographique du client
 *   time          plage horaire « HH:MM-HH:MM »
 *   duration      durée (secondes)
 *   schedule      calendrier d'utilisation du client
 *   ignition      contact moteur
 *   vehicle       véhicule du client
 */
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

export const RULE_OPERATORS_BY_FIELD: Record<RuleField, readonly RuleOperator[]> = {
  speed: ['gt', 'lt', 'eq', 'neq'],
  speed_policy: ['eq', 'neq'],
  zone: ['eq'],
  time: ['in', 'outside'],
  duration: ['gt', 'lt', 'eq', 'neq'],
  schedule: ['eq'],
  ignition: ['eq', 'neq'],
  vehicle: ['eq', 'neq'],
}

/**
 * Champs acceptés par événement : ceux qui peuvent réellement le produire.
 * Un événement absent n'accepte aucune condition (la règle se déclenche à
 * chaque occurrence).
 */
export const EVENT_RULE_FIELDS: Partial<Record<EventType, readonly RuleField[]>> = {
  overspeed: ['speed_policy'],
  geofence_exit: ['zone'],
  geofence_entry: ['zone'],
  schedule_violation: ['schedule'],
}

/** Format d'une valeur `time` : « HH:MM-HH:MM » (24 h). */
export const TIME_RANGE_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/
