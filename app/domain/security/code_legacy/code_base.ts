/**
 * =========================================================================
 *  CODE LEGACY · CODE BASE — commandes nommées du domaine SISBM
 * =========================================================================
 *
 * SOURCE UNIQUE des valeurs qui décrivent une commande boîtier côté SISBM,
 * indépendamment du fournisseur (flespi aujourd'hui, autre passerelle
 * demain). Aucune autre couche ne redéclare ces listes : elle les importe.
 *
 *   import { COMMAND_TYPES, type CommandType } from '#domain/security/code_legacy/code_base'
 *
 * Alignées sur les contraintes CHECK de la migration 9
 * (`ck_device_commands_type`, `_status`, `_origin`). Un test unitaire
 * (`tests/unit/command_catalog.spec.ts`) casse le build si la migration et
 * ce fichier divergent.
 *
 * Fichier du DOMAINE : aucun import de framework, aucune notion de flespi.
 */

// ---------------------------------------------------------------------------
// Types de commandes nommées envoyées au tracker
// ---------------------------------------------------------------------------

export const COMMAND_TYPES = [
  'engine_cut',
  'engine_restore',
  'locate',
  'reboot',
  'set_interval',
  'custom',
] as const
export type CommandType = (typeof COMMAND_TYPES)[number]

/**
 * Commandes moteur : elles ne passent QUE par le contexte `security`
 * (garde-fou de vitesse CM-07, double validation). Toute autre route doit
 * les refuser.
 */
export const ENGINE_COMMAND_TYPES = [
  'engine_cut',
  'engine_restore',
] as const satisfies readonly CommandType[]
export type EngineCommandType = (typeof ENGINE_COMMAND_TYPES)[number]

export function isCommandType(value: unknown): value is CommandType {
  return typeof value === 'string' && (COMMAND_TYPES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Statuts et origines
// ---------------------------------------------------------------------------
export const COMMAND_STATUSES = [
  'pending_validation',
  'approved',
  'rejected',
  'queued',
  'sent',
  'acknowledged',
  'failed',
  'cancelled',
  'expired',
] as const
export type CommandStatus = (typeof COMMAND_STATUSES)[number]

export const COMMAND_ORIGINS = ['manual', 'policy', 'api'] as const
export type CommandOrigin = (typeof COMMAND_ORIGINS)[number]

/**
 * Machine à états. Déclarée une seule fois, en données, plutôt qu'éparpillée
 * dans des `if`. Toute transition non listée ici est refusée par l'agrégat.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<CommandStatus, readonly CommandStatus[]>> = {
  pending_validation: ['approved', 'rejected', 'cancelled', 'expired'],
  approved: ['queued', 'cancelled', 'expired'],
  queued: ['sent', 'failed', 'cancelled', 'expired'],
  sent: ['acknowledged', 'failed'],
  acknowledged: [],
  rejected: [],
  failed: [],
  cancelled: [],
  expired: [],
} as const

// ---------------------------------------------------------------------------
// Groupes de statuts — chaque `whereIn('status', [...])` du code en dérive
// ---------------------------------------------------------------------------
/** La commande occupe encore le tracker (contrainte CM-09, index `uq_device_commands_in_flight`). */
export const IN_FLIGHT_STATUSES = [
  'pending_validation',
  'approved',
  'queued',
  'sent',
] as const satisfies readonly CommandStatus[]

/** Transmise au fournisseur : son résultat (acquittement, échec) est attendu de lui. */
export const AWAITING_PROVIDER_STATUSES = [
  'queued',
  'sent',
] as const satisfies readonly CommandStatus[]

/** Peut expirer côté SISBM (pas encore remise au boîtier). */
export const EXPIRABLE_STATUSES = [
  'pending_validation',
  'approved',
  'queued',
] as const satisfies readonly CommandStatus[]

/** Terminée sans exécution : compte comme un échec dans les indicateurs. */
export const UNSUCCESSFUL_STATUSES = [
  'failed',
  'expired',
] as const satisfies readonly CommandStatus[]

/** Issues qu'un fournisseur peut rapporter lors d'une réconciliation. */
export type ProviderOutcomeStatus = Extract<CommandStatus, 'acknowledged' | 'failed' | 'expired'>
