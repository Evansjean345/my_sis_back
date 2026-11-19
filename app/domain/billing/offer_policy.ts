/**
 * =========================================================================
 *  OFFRES COMMERCIALES — règles pures, sans I/O
 * =========================================================================
 *
 * Une offre est d'abord un élément du CATALOGUE : elle se crée, se modifie
 * et se commercialise seule. Elle peut ensuite être rattachée à UNE
 * organisation, dont l'administrateur (rôle `admin`) accède alors aux
 * fonctionnalités incluses.
 *
 * Les fonctionnalités sont stockées par CLÉ stable (`fleet`, `zones`…) et
 * non par URL : une page du tableau de bord peut changer d'adresse sans
 * migration. La correspondance clé → page est ici, en un seul endroit.
 */

/**
 * Fonctionnalités vendables, rangées par MODULE comme dans le menu du
 * tableau de bord. Chacune ouvre une page du tableau de bord Admin.
 *
 * Les clés historiques (`fleet`, `zones`, `drivers`, `incidents`, `support`,
 * `speed`, `alerts`) sont conservées : les offres existantes restent valides.
 * L'ordre du tableau est l'ordre d'affichage (modules puis fonctionnalités).
 * Toute clé ajoutée ici doit l'être aussi dans `ck_offers_features`.
 */
export const OFFER_FEATURES = [
  { key: 'fleet', label: 'Suivi en temps réel', module: 'Supervision', path: '/dashboard/fleet' },
  {
    key: 'alerts',
    label: 'Centre des alertes',
    module: 'Alertes & Notifications',
    path: '/dashboard/alerts',
  },
  {
    key: 'notifications',
    label: 'Configuration des notifications',
    module: 'Alertes & Notifications',
    path: '/dashboard/notifications',
  },
  {
    key: 'sms',
    label: 'Gestion des SMS',
    module: 'Alertes & Notifications',
    path: '/dashboard/sms',
  },
  {
    key: 'notification_templates',
    label: 'Modèles de notifications',
    module: 'Alertes & Notifications',
    path: '/dashboard/notification-templates',
  },
  {
    key: 'incidents',
    label: 'Gestion des incidents',
    module: 'Gestion des incidents',
    path: '/dashboard/incidents',
  },
  { key: 'schedules', label: 'Horaires', module: 'Rubriques client', path: '/dashboard/clock' },
  {
    key: 'zones',
    label: 'Zones géographiques',
    module: 'Rubriques client',
    path: '/dashboard/zones',
  },
  {
    key: 'speed',
    label: 'Contrôle de vitesse',
    module: 'Rubriques client',
    path: '/dashboard/speed',
  },
  { key: 'rules', label: 'Moteur de règles', module: 'Rubriques client', path: '/dashboard/rules' },
  { key: 'drivers', label: 'Conducteurs', module: 'Rubriques client', path: '/dashboard/driver' },
  {
    key: 'driver_groups',
    label: 'Équipes de conducteurs',
    module: 'Rubriques client',
    path: '/dashboard/group_driver',
  },
  {
    key: 'vehicle_groups',
    label: 'Groupes de véhicules',
    module: 'Rubriques client',
    path: '/dashboard/group_vehicle',
  },
  { key: 'support', label: 'Technicien dédié', module: 'Support', path: '/dashboard/support' },
] as const

export type OfferFeature = (typeof OFFER_FEATURES)[number]['key']
export const OFFER_FEATURE_KEYS = OFFER_FEATURES.map((f) => f.key) as OfferFeature[]

/** Périodicité de facturation. */
export const OFFER_PERIODICITIES = ['monthly', 'quarterly', 'semiannual', 'annual'] as const
export type OfferPeriodicity = (typeof OFFER_PERIODICITIES)[number]

/** Durée d'une période, en mois. */
export const PERIODICITY_MONTHS: Record<OfferPeriodicity, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

/** Une offre naît inactive : elle n'est proposée qu'une fois activée. */
export const OFFER_STATUSES = ['active', 'inactive'] as const
export type OfferStatus = (typeof OFFER_STATUSES)[number]

/** Code : lettres, chiffres, `-` et `_`, 2 à 40 caractères, stocké en MAJUSCULES. */
export const OFFER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/

export function normalizeOfferCode(code: string): string {
  return code.trim().toUpperCase()
}

/** Bornes de l'historique GPS consultable (jours). */
export const GPS_HISTORY_DAYS = { min: 1, max: 3650, default: 30 } as const

/** Fonctionnalités dédoublonnées, dans l'ordre du catalogue. */
export function normalizeFeatures(features: readonly string[]): OfferFeature[] {
  const voulues = new Set(features)
  return OFFER_FEATURE_KEYS.filter((k) => voulues.has(k))
}

/** Modules dans l'ordre du catalogue, avec leurs fonctionnalités. */
export function featuresByModule(): {
  module: string
  features: (typeof OFFER_FEATURES)[number][]
}[] {
  const modules = new Map<string, (typeof OFFER_FEATURES)[number][]>()
  for (const f of OFFER_FEATURES) modules.set(f.module, [...(modules.get(f.module) ?? []), f])
  return [...modules].map(([module, features]) => ({ module, features }))
}

/** Pages du tableau de bord Admin ouvertes par une liste de fonctionnalités. */
export function pathsOf(features: readonly string[]): string[] {
  const voulues = new Set(features)
  return OFFER_FEATURES.filter((f) => voulues.has(f.key)).map((f) => f.path)
}

/** La limite de véhicules est-elle atteinte ? `null` = illimité. */
export function vehicleQuotaReached(maxVehicles: number | null, currentVehicles: number): boolean {
  return maxVehicles !== null && currentVehicles >= maxVehicles
}

export interface OfferActivationInput {
  status: OfferStatus
  /** AAAA-MM-JJ, ou `null` si non renseignée. */
  launchedOn: string | null
}

/**
 * Une offre ACTIVE est commercialisée : sa date de commercialisation est
 * obligatoire. (Même règle en base : contrainte `ck_offers_active_launched`.)
 */
export function activationProblem(input: OfferActivationInput): string | null {
  if (input.status === 'active' && !input.launchedOn) {
    return 'Une offre active doit avoir une date de commercialisation'
  }
  return null
}
