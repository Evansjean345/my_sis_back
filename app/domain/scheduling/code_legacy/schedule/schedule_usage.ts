/**
 * PLAGES HORAIRES — état d'usage attendu d'un véhicule.
 *
 * Un calendrier ne décrit que des plages AUTORISÉES : le véhicule ne roule que
 * pendant ces plages, il est immobilisé en dehors. Il n'y a plus de mode
 * « interdit » : une interdiction s'écrit comme le complément des plages.
 *
 * Aligné sur les CHECK de `vehicle_schedule_states` et `schedule_enforcement_events`.
 */
export const DESIRED_USAGES = ['free', 'immobilized'] as const
export type DesiredUsage = (typeof DESIRED_USAGES)[number]

/**
 *  no_schedule              aucun calendrier actif ne s'applique → libre
 *  inside_allowed_window    une plage autorisée est en cours     → libre
 *  outside_allowed_windows  aucune plage autorisée en cours      → immobilisé
 */
export const USAGE_CAUSES = [
  'no_schedule',
  'inside_allowed_window',
  'outside_allowed_windows',
] as const
export type UsageCause = (typeof USAGE_CAUSES)[number]
