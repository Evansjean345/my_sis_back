/**
 * =========================================================================
 *  CODE LEGACY · TRACKER RÉGLAGES — réglages critiques du tracker
 * =========================================================================
 *
 * Commandes flespi `setting.*` capables de rompre le lien boîtier ↔ flespi
 * (nouveau serveur, mauvais réseau ou APN). Une erreur ici n'est PAS
 * rattrapable à distance : il faut intervenir physiquement ou par SMS.
 * Toute route qui les émet exige une confirmation explicite (`confirm=true`).
 */

export const REGLAGES_CRITIQUES_NAMES = [
  'setting.server.set',
  'setting.network.set',
  'setting.auto_apn.set',
] as const
export type ReglageCritique = (typeof REGLAGES_CRITIQUES_NAMES)[number]

export const REGLAGES_CRITIQUES: ReadonlySet<string> = new Set(REGLAGES_CRITIQUES_NAMES)

export function isReglageCritique(commandName: string): commandName is ReglageCritique {
  return REGLAGES_CRITIQUES.has(commandName)
}
