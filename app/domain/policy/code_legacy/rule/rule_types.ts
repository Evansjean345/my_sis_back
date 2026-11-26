import type { RuleActionType } from '#domain/policy/code_legacy/rule/rule_actions'
import type { EventType } from '#domain/policy/code_legacy/rule/rule_event_types'
import type { RuleField } from '#domain/policy/code_legacy/rule/rule_fields'
import type { RuleOperator } from '#domain/policy/code_legacy/rule/rule_operators'

/**
 * =========================================================================
 *  RÈGLES — interfaces (référentiel en dur)
 * =========================================================================
 */

/** Ciblage d'une condition : toute l'organisation, un véhicule ou une flotte. */
export type ConditionTarget =
  | { type: 'all' }
  | { type: 'vehicle'; id: string; label?: string }
  | { type: 'fleet'; id: string; label?: string }

/** Condition telle que saisie (avant vérification des références). */
export interface RuleConditionInput {
  field: RuleField
  operator: RuleOperator
  value: string
  /** Plusieurs zones (OU) : seulement pour une sortie de zone. */
  values?: string[]
  target?: ConditionTarget
}

/** Action telle que saisie. */
export interface RuleActionInput {
  type: RuleActionType
  value: string
  channels?: string[]
}

/** Règle à contrôler (`ruleProblem`). */
export interface RuleDraft {
  name: string
  trigger: EventType
  conditions: readonly RuleConditionInput[]
  actions: readonly RuleActionInput[]
}

/** Condition vérifiée, avec ses libellés : forme stockée et renvoyée par l'API. */
export interface ResolvedCondition {
  id: string
  field: RuleField
  operator: RuleOperator
  value: string
  values?: string[]
  valueLabel?: string
  valueLabels?: string[]
  target: ConditionTarget
}

/**
 * Références d'UNE organisation, chargées par l'infrastructure, contre
 * lesquelles on vérifie et on étiquette les conditions (`resolveConditions`).
 */
export interface RuleReferences {
  speedPolicies: ReadonlyMap<string, { name: string; active: boolean }>
  zones: ReadonlyMap<
    string,
    { name: string; active: boolean; alertOnEntry: boolean; alertOnExit: boolean }
  >
  schedules: ReadonlyMap<string, { name: string; active: boolean }>
  vehicles: ReadonlyMap<string, { registration: string; active: boolean }>
  fleets: ReadonlyMap<string, { name: string }>
}
