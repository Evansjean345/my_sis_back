/**
 * =========================================================================
 *  OFFRES COMMERCIALES — règles pures, sans I/O
 * =========================================================================
 *
 * Une offre est un élément du CATALOGUE : elle se crée, se modifie et se
 * commercialise seule. Les organisations y accèdent par des SOUSCRIPTIONS
 * (une par groupe de véhicules, voir `subscription_policy.ts`).
 *
 * Les fonctionnalités vendables vivent en base (migration 026) :
 * `features` (un nom) → `sub_features` (clé, libellé, page), et
 * `offer_sub_features` pour les sous-fonctionnalités de chaque offre.
 */

/** Périodicité de facturation. */
/*
Périodicité d'une offre en mois / trimestrielle / semestrielle ou annuelle
*/
export const OFFER_PERIODICITIES = ['monthly', 'quarterly', 'semiannual', 'annual'] as const
export type OfferPeriodicity = (typeof OFFER_PERIODICITIES)[number]

/** Durée d'une période, en mois. */
/*
Durée d'une période en nombre
*/
export const PERIODICITY_MONTHS: Record<OfferPeriodicity, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

/** Une offre naît inactive : elle n'est proposée qu'une fois activée. */
/*
Statut d'une offre
*/
export const OFFER_STATUSES = ['active', 'inactive'] as const
export type OfferStatus = (typeof OFFER_STATUSES)[number]

/** Code : lettres, chiffres, `-` et `_`, 2 à 40 caractères, stocké en MAJUSCULES. */
export const OFFER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/

export function normalizeOfferCode(code: string): string {
  return code.trim().toUpperCase()
}

/** Clé d'une sous-fonctionnalité (même règle que `ck_sub_features_key`). */
export const SUB_FEATURE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,59}$/

/** Bornes de l'historique GPS consultable (jours). */
/*
Hostorique GPS retention soit 1 / 30 / 365 jours
*/
export const GPS_HISTORY_DAYS = { min: 1, max: 3650, default: 30 } as const

/** La limite de véhicules est-elle atteinte ? `null` = illimité. */
/*
Limite de véhicules en nombres
*/
export function vehicleQuotaReached(maxVehicles: number | null, currentVehicles: number): boolean {
  return maxVehicles !== null && currentVehicles >= maxVehicles
}

/*
Statut d'une offre active ou inactive
*/
export interface OfferActivationInput {
  status: OfferStatus
  /** AAAA-MM-JJ, ou `null` si non renseignée. */
  launchedOn: string | null
}

/**
 * Une offre ACTIVE est commercialisée : sa date de commercialisation est
 * obligatoire. (Même règle en base : contrainte `ck_offers_active_launched`.)
 */
/*
Une offre est active ou inactive (une offre active doit avoir une date de commercialisation)
*/
export function activationProblem(input: OfferActivationInput): string | null {
  if (input.status === 'active' && !input.launchedOn) {
    return 'Une offre active doit avoir une date de commercialisation'
  }
  return null
}
