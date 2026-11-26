/**
 * POLITIQUES DE VITESSE — types en dur.
 *
 * Portée : globale (tous les véhicules du client), une zone, ou des véhicules.
 * La plus précise l'emporte (véhicule > zone > globale) à l'évaluation.
 */
export const SPEED_SCOPES = ['global', 'zone', 'vehicle'] as const
export type SpeedScope = (typeof SPEED_SCOPES)[number]

/** Limite autorisée (km/h). */
export const SPEED_LIMIT_MIN_KPH = 5
export const SPEED_LIMIT_MAX_KPH = 200

/** Politique à contrôler (`speedPolicyProblem`). */
export interface SpeedPolicyDraft {
  name: string
  scope: SpeedScope
  zoneId: string | null
  vehicleIds: readonly string[]
  limitKph: number
}
