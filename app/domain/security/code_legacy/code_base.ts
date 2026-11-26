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
 * Alignées sur les contraintes CHECK `ck_device_commands_type`, `_status`
 * (migration 16 : fin de la double validation) et `_origin` (migration 17 :
 * origine `schedule`). `security/value_objects` les réexporte.
 *
 * La double validation n'existe plus : une commande naît `approved` (demande
 * acceptée par le garde-fou de vitesse et le motif), puis elle est émise.
 * Plus de `pending_validation` ni de `rejected`.
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
 * (motif obligatoire, garde-fou de vitesse CM-07). Toute autre route doit
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
  'approved',
  'queued',
  'sent',
  'acknowledged',
  'failed',
  'cancelled',
  'expired',
] as const
export type CommandStatus = (typeof COMMAND_STATUSES)[number]

/**
 * `schedule` : émise par le moteur d'immobilisation automatique
 * (`node ace sisbm:schedules:enforce`). C'est elle qui autorise le moteur à
 * rétablir un véhicule : il ne libère jamais ce qu'un humain a coupé.
 */
export const COMMAND_ORIGINS = ['manual', 'policy', 'api', 'schedule'] as const
export type CommandOrigin = (typeof COMMAND_ORIGINS)[number]

/**
 * Machine à états. Déclarée une seule fois, en données, plutôt qu'éparpillée
 * dans des `if`. Toute transition non listée ici est refusée par l'agrégat.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<CommandStatus, readonly CommandStatus[]>> = {
  approved: ['queued', 'cancelled', 'expired'],
  queued: ['sent', 'failed', 'cancelled', 'expired'],
  sent: ['acknowledged', 'failed'],
  acknowledged: [],
  failed: [],
  cancelled: [],
  expired: [],
} as const

// ---------------------------------------------------------------------------
// Groupes de statuts — chaque `whereIn('status', [...])` du code en dérive
// ---------------------------------------------------------------------------
/** La commande occupe encore le tracker (contrainte CM-09, index `uq_device_commands_in_flight`). */
export const IN_FLIGHT_STATUSES = [
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
export const EXPIRABLE_STATUSES = ['approved', 'queued'] as const satisfies readonly CommandStatus[]

/** Terminée sans exécution : compte comme un échec dans les indicateurs. */
export const UNSUCCESSFUL_STATUSES = [
  'failed',
  'expired',
] as const satisfies readonly CommandStatus[]

/** Issues qu'un fournisseur peut rapporter lors d'une réconciliation. */
export type ProviderOutcomeStatus = Extract<CommandStatus, 'acknowledged' | 'failed' | 'expired'>
