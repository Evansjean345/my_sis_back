/**
 * =========================================================================
 *  SOUSCRIPTIONS — règles pures, sans I/O
 * =========================================================================
 *
 * Une souscription lie une organisation à une offre pour UN groupe de
 * véhicules. Le montant n'est jamais stocké : tarif appliqué × véhicules du
 * groupe, calculé à la lecture.
 */

export const SUBSCRIPTION_STATUSES = ['draft', 'active', 'suspended', 'terminated'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/** Statuts possibles à la création. */
export const INITIAL_SUBSCRIPTION_STATUSES = ['draft', 'active'] as const

/**
 * Transitions autorisées. `terminated` est définitif : une flotte résiliée
 * repart sur une nouvelle souscription.
 */
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  draft: ['active', 'terminated'],
  active: ['suspended', 'terminated'],
  suspended: ['active', 'terminated'],
  terminated: [],
}

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_TRANSITIONS[from].includes(to)
}

/** Seules les souscriptions actives ouvrent les pages du tableau de bord du distributeur. */
export function grantsAccess(status: string): boolean {
  return status === 'active'
}

/** Référence saisie (même règle que `ck_subscriptions_reference`). */
export const SUBSCRIPTION_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_/.-]{1,39}$/

/**
 * Montant d'une période : tarif appliqué × nombre de véhicules, au centime,
 * calculé en entiers (pas d'erreur d'arrondi flottant). Rend « 45000.00 ».
 */
export function subscriptionAmount(unitPrice: string | number, vehicles: number): string {
  const [entier, decimales = ''] = String(unitPrice).split('.')
  const centimes = BigInt(entier || '0') * 100n + BigInt((decimales + '00').slice(0, 2))
  const total = centimes * BigInt(Math.max(0, Math.trunc(vehicles)))
  const texte = total.toString().padStart(3, '0')
  return `${texte.slice(0, -2)}.${texte.slice(-2)}`
}
