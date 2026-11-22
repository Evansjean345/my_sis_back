/**
 * =========================================================================
 *  SOUSCRIPTIONS — règles pures, sans I/O
 * =========================================================================
 *
 * Une souscription lie une organisation à une offre pour UN groupe de
 * véhicules. Son tarif appliqué est FORFAITAIRE (il ne dépend ni des
 * véhicules ni du groupe) : prix de l'offre figé − remise en montant.
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

/** « 15000.5 » → 1500050 centimes (sans arrondi flottant). */
function toCents(value: string | number): bigint {
  const texte = typeof value === 'number' ? value.toFixed(2) : value.trim()
  const negatif = texte.startsWith('-')
  const [entier, decimales = ''] = texte.replace('-', '').split('.')
  const centimes = BigInt(entier || '0') * 100n + BigInt((decimales + '00').slice(0, 2))
  return negatif ? -centimes : centimes
}

function fromCents(centimes: bigint): string {
  const negatif = centimes < 0n
  const texte = (negatif ? -centimes : centimes).toString().padStart(3, '0')
  return `${negatif ? '-' : ''}${texte.slice(0, -2)}.${texte.slice(-2)}`
}

/**
 * Tarif appliqué : prix de l'offre − remise, au centime. Rend « 13000.00 ».
 * (Même calcul que la colonne générée `subscriptions.total_price`.)
 */
export function subscriptionTotal(
  offerPrice: string | number,
  discount: string | number = 0
): string {
  return fromCents(toCents(offerPrice) - toCents(discount))
}

/** La remise est-elle valable ? (même règle que `ck_subscriptions_discount`) */
export function discountProblem(
  offerPrice: string | number,
  discount: string | number
): string | null {
  if (toCents(discount) < 0n) return 'La remise ne peut pas être négative'
  if (toCents(discount) > toCents(offerPrice)) {
    return "La remise ne peut pas dépasser le prix de l'offre"
  }
  return null
}
