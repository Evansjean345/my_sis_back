/**
 * =========================================================================
 *  CODE LEGACY · FLESPI COMMAND — noms des commandes métier SISBM
 * =========================================================================
 *
 * SOURCE UNIQUE des noms de commandes exposés par l'API SISBM et traduits
 * en commandes flespi. Le type, les routes (client et admin), le catalogue
 * et les gardes en dérivent : ajouter une commande = ajouter son nom ici,
 * puis sa définition dans `tracker_command.ts` (le compilateur l'exige).
 *
 *   import { type FlespiCommandName } from '#infrastructure/gateways/flespi/code_legacy/flespi_command'
 *
 * Statut de vérification sur boîtier réel : voir `verified` dans
 * `tracker_command.ts` (seul S20 est confirmé par la documentation flespi).
 */

export const FLESPI_COMMAND_NAMES = [
  // ---- contrôle moteur : contexte `security` uniquement (CM-07)
  'cut_engine',
  'restore_engine',
  // ---- alarme embarquée (non vérifiées)
  'arm',
  'disarm',
  // ---- sortie auxiliaire (non vérifiée)
  'set_output',
  // ---- configuration du boîtier (non vérifiées)
  'set_admin_number',
  'change_password',
  'reset_password',
  // ---- diagnostic (non vérifiées)
  'request_status',
  'reboot',
  // ---- rythme de reporting (non vérifiées)
  'start_tracking',
  'stop_tracking',
  // ---- géofences embarquées : à définir pour les systèmes d'alertes (Jalon 3)
  'add_geofence',
  'remove_geofence',
  // ---- APN : ne pas utiliser (APN erroné = boîtier injoignable à distance)
  'set_apn',
] as const
export type FlespiCommandName = (typeof FLESPI_COMMAND_NAMES)[number]

/** Commandes moteur : refusées partout sauf dans `/security/immobilizations`. */
export const ENGINE_COMMAND_NAMES = [
  'cut_engine',
  'restore_engine',
] as const satisfies readonly FlespiCommandName[]
export type EngineCommandName = (typeof ENGINE_COMMAND_NAMES)[number]

/** Commandes émises par les routes génériques `POST /devices/:id/commands/:command`. */
export type BusinessCommandName = Exclude<FlespiCommandName, EngineCommandName>
export const BUSINESS_COMMAND_NAMES = FLESPI_COMMAND_NAMES.filter(
  (n): n is BusinessCommandName => !(ENGINE_COMMAND_NAMES as readonly string[]).includes(n)
)

export function isFlespiCommandName(value: unknown): value is FlespiCommandName {
  return typeof value === 'string' && (FLESPI_COMMAND_NAMES as readonly string[]).includes(value)
}

export function isEngineCommandName(value: unknown): value is EngineCommandName {
  return typeof value === 'string' && (ENGINE_COMMAND_NAMES as readonly string[]).includes(value)
}

export function isBusinessCommandName(value: unknown): value is BusinessCommandName {
  return isFlespiCommandName(value) && !isEngineCommandName(value)
}

// ---------------------------------------------------------------------------
// Nom ↔ segment d'URL (les routes sont en kebab-case : `request-status`)
// ---------------------------------------------------------------------------

export function toCommandSlug(name: FlespiCommandName): string {
  return name.replace(/_/g, '-')
}

/** Segment d'URL → nom de commande, ou `null` si inconnu. */
export function fromCommandSlug(slug: unknown): FlespiCommandName | null {
  const nom = String(slug ?? '').replace(/-/g, '_')
  return isFlespiCommandName(nom) ? nom : null
}

/**
 * Matcher du paramètre `:command` des routes génériques : SEULES les
 * commandes métier passent. `cut-engine` / `restore-engine` sont exclues et
 * tombent sur leurs routes de refus explicite.
 */
export const BUSINESS_COMMAND_ROUTE_MATCHER = new RegExp(
  `^(${BUSINESS_COMMAND_NAMES.map(toCommandSlug).join('|')})$`
)
