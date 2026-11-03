import type { CommandType } from '#domain/security/code_legacy/code_base'
import {
  ENGINE_COMMAND_NAMES,
  type FlespiCommandName,
} from '#infrastructure/gateways/flespi/code_legacy/flespi_command'

/**
 * =========================================================================
 *  CODE LEGACY · TRACKER COMMAND — commandes flespi envoyées au tracker
 * =========================================================================
 *
 * Traduction d'un nom de commande SISBM (`flespi_command.ts`) en commande
 * constructeur Micodus MV730. flespi les expose via la commande générique
 * `custom`, de schéma `{ command_code, data }` — exemple officiel
 * (flespi.com/protocols/micodus) :
 *
 *     { "name": "custom", "properties": { "command_code": "S20", "data": "1,1" } }
 *     → coupure huile + alimentation
 *
 * Seul S20 est confirmé par la documentation flespi. Les autres codes
 * proviennent du support SISBM et sont marqués `verified: false` : à valider
 * sur boîtier réel (GET /api/v1/devices/:id/flespi/commands renvoie le
 * schéma exact que flespi accepte pour CE boîtier).
 *
 * Le type `Record<FlespiCommandName, …>` rend l'oubli impossible : un nom
 * ajouté dans `flespi_command.ts` sans définition ici ne compile pas.
 */

/** Nom flespi de la commande générique qui transporte les codes constructeur. */
export const FLESPI_CUSTOM_COMMAND = 'custom'

/** Commande au format flespi (`POST /gw/devices/{id}/commands[-queue]`). */
export interface FlespiCommand {
  name: string
  properties: Record<string, unknown>
}

export interface TrackerCommandDefinition {
  /** Code constructeur Micodus, transmis dans `properties.command_code`. */
  readonly code: string
  /** Charge utile fixe, ou `null` si elle dépend des paramètres. */
  readonly data: string | null
  /** Une commande sensible exige une habilitation dédiée et un motif tracé. */
  readonly sensitive: boolean
  /** Confirmé par la documentation flespi / un test sur boîtier réel. */
  readonly verified: boolean
  /** Type enregistré dans `device_commands.command_type`. */
  readonly commandType: CommandType
  readonly label: string
}

/**
 * Fabrique de définition : les valeurs par défaut (non sensible, non
 * vérifiée, type `custom`, charge variable) ne sont écrites qu'une fois —
 * chaque entrée du catalogue ne déclare que ce qui la distingue.
 */
function cmd(
  code: string,
  label: string,
  opts: Partial<Omit<TrackerCommandDefinition, 'code' | 'label'>> = {}
): TrackerCommandDefinition {
  return Object.freeze({
    code,
    label,
    data: opts.data === undefined ? null : opts.data,
    sensitive: opts.sensitive ?? false,
    verified: opts.verified ?? false,
    commandType: opts.commandType ?? 'custom',
  })
}

export const FLESPI_COMMANDS: Readonly<Record<FlespiCommandName, TrackerCommandDefinition>> =
  Object.freeze({
    // ---- contrôle moteur / carburant (exemple officiel flespi)
    cut_engine: cmd('S20', 'Couper huile et alimentation', {
      data: '1,1',
      sensitive: true,
      verified: true,
      commandType: 'engine_cut',
    }),
    restore_engine: cmd('S20', 'Rétablir huile et alimentation', {
      data: '0,0',
      sensitive: true,
      verified: true,
      commandType: 'engine_restore',
    }),

    // ---- alarme embarquée
    arm: cmd('S10', "Armer l'alarme", { data: '1' }),
    disarm: cmd('S10', "Désarmer l'alarme", { data: '0' }),

    // ---- sortie auxiliaire
    set_output: cmd('S11', 'Piloter une sortie', { sensitive: true }),

    // ---- configuration du boîtier
    set_admin_number: cmd('A1', 'Définir le numéro administrateur', { sensitive: true }),
    change_password: cmd('B1', 'Changer le mot de passe boîtier', { sensitive: true }),
    reset_password: cmd('B2', 'Réinitialiser le mot de passe', { sensitive: true }),
    set_apn: cmd('C1', "Configurer l'APN", { sensitive: true }),

    // ---- diagnostic
    request_status: cmd('R1', "Demander un rapport d'état", { data: '', commandType: 'locate' }),
    reboot: cmd('R2', 'Redémarrer le boîtier', { data: '', commandType: 'reboot' }),

    // ---- rythme de reporting
    start_tracking: cmd('T1', 'Activer le suivi renforcé', {
      data: '1',
      commandType: 'set_interval',
    }),
    stop_tracking: cmd('T1', 'Désactiver le suivi renforcé', {
      data: '0',
      commandType: 'set_interval',
    }),

    // ---- géofences embarquées (à définir pour le Jalon 3)
    add_geofence: cmd('G1', 'Ajouter une géofence embarquée'),
    remove_geofence: cmd('G2', 'Supprimer une géofence embarquée'),
  })

// ---------------------------------------------------------------------------
// Traduction nom SISBM → commande flespi
// ---------------------------------------------------------------------------

/** Forme flespi d'un code constructeur — seul endroit qui écrit `{ command_code, data }`. */
export function toFlespiCustom(code: string, data: string): FlespiCommand {
  return { name: FLESPI_CUSTOM_COMMAND, properties: { command_code: code, data } }
}

/**
 * Traduit une commande métier en commande flespi.
 * Lève une erreur si une charge utile variable est absente : envoyer
 * `set_apn` avec une chaîne vide rendrait le boîtier injoignable.
 */
export function buildBusinessCommand(
  command: FlespiCommandName,
  data?: string | null
): FlespiCommand {
  const def = FLESPI_COMMANDS[command]
  if (!def) throw new Error(`Commande inconnue : ${command}`)
  const charge = def.data ?? data
  if (charge === undefined || charge === null || (def.data === null && charge.trim() === '')) {
    throw new Error(`La commande ${command} exige un paramètre « data »`)
  }
  return toFlespiCustom(def.code, charge)
}

/** Une commande dont la charge utile est fournie par l'appelant. */
export function requiresData(def: TrackerCommandDefinition): boolean {
  return def.data === null
}

// ---------------------------------------------------------------------------
// Garde CM-07 : coupure moteur déguisée en commande brute
// ---------------------------------------------------------------------------

/** Codes constructeur des commandes moteur, DÉRIVÉS du catalogue (S20 pour le MV730). */
export const ENGINE_COMMAND_CODES: ReadonlySet<string> = new Set(
  ENGINE_COMMAND_NAMES.map((n) => FLESPI_COMMANDS[n].code.toUpperCase())
)

/** Préfixe texte des commandes relais Concox (`RELAY,1#`). */
const CONCOX_RELAY_PREFIX = 'RELAY'
/** Message JT/T 808 « contrôle du véhicule » (coupure carburant). */
const JT808_VEHICLE_CONTROL_ID = '8105'

/**
 * Vrai si une commande flespi BRUTE (`/commands/send`) déclencherait une
 * coupure ou un rétablissement moteur : elle doit alors passer par
 * `/security/immobilizations` et son garde-fou de vitesse.
 */
export function isDisguisedEngineCommand(command: FlespiCommand): boolean {
  if (command.name !== FLESPI_CUSTOM_COMMAND) return false
  const p = command.properties
  const code = String(p.command_code ?? '').toUpperCase()
  const texte = String(p.payload ?? p.text ?? '').toUpperCase()
  return (
    ENGINE_COMMAND_CODES.has(code) ||
    texte.startsWith(CONCOX_RELAY_PREFIX) ||
    String(p.message_id ?? '') === JT808_VEHICLE_CONTROL_ID
  )
}

/**
 * Type `device_commands.command_type` d'une commande flespi BRUTE : une
 * commande brute n'a pas de définition SISBM, seul le redémarrage se
 * reconnaît à son nom (`reboot`, `device.reboot`…).
 */
export function commandTypeOfRawCommand(command: FlespiCommand): CommandType {
  return command.name.includes('reboot') ? 'reboot' : 'custom'
}
