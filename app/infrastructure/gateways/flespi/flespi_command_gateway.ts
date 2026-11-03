import logger from '@adonisjs/core/services/logger'
import type { FlespiClient } from '#infrastructure/gateways/flespi/flespi_client'
import type { DeviceCommandGateway } from '#application/security/ports'
import type {
  FlespiCommandDefinition,
  FlespiCommandResult,
  FlespiQueuedCommand,
} from '#infrastructure/gateways/flespi/flespi_types'
import { validateAgainstSchema } from '#infrastructure/gateways/flespi/flespi_schema_validator'
import type { FlespiCommandName } from '#infrastructure/gateways/flespi/code_legacy/flespi_command'
import {
  buildBusinessCommand,
  type FlespiCommand,
} from '#infrastructure/gateways/flespi/code_legacy/tracker_command'

/**
 * =========================================================================
 *  PASSERELLE DE COMMANDES FLESPI — Micodus MV730
 * =========================================================================
 *
 * ✗ AVANT : POST /gw/devices/{id}/commands   { command_code, data }
 *   → n'existe pas sous cette forme : flespi attend un TABLEAU de
 *     { name, properties }. Le code constructeur n'est pas le nom de commande.
 *
 * ✓ APRÈS — deux modes, deux endpoints flespi :
 *
 *   FILE D'ATTENTE (défaut)  POST /gw/devices/{id}/commands-queue
 *     [{ name, properties, ttl, max_attempts, priority }]
 *     → la commande attend que le boîtier soit connecté (jusqu'à `ttl`
 *       secondes, `max_attempts` essais). Adapté à un traceur qui coupe son
 *       GPRS à l'arrêt (mode veille / stop_mode du MV730).
 *     Résultat plus tard : GET /gw/devices/{id}/commands-result
 *
 *   INSTANTANÉ               POST /gw/devices/{id}/commands
 *     [{ name, properties, timeout }]
 *     → échoue immédiatement si le boîtier n'est pas connecté
 *       (« device not connected »). Réservé au diagnostic interactif.
 *
 * Les commandes elles-mêmes (noms, codes Micodus, statut de vérification)
 * ne sont PAS déclarées ici — source unique dans `./code_legacy/` :
 *   - `flespi_command.ts`   noms des commandes métier SISBM
 *   - `tracker_command.ts`  codes constructeur + traduction en `custom`
 *   - `tracker_reglages.ts` réglages `setting.*` à confirmer
 * Ce fichier ne garde que le TRANSPORT vers flespi.
 */

export interface QueueOptions {
  /** Durée de vie en file, 60 à 2 592 000 s. */
  ttl?: number
  /** Nombre d'essais de remise (défaut flespi : 10). */
  maxAttempts?: number
  priority?: number
}

export interface SendResult {
  mode: 'queue' | 'instant'
  providerCommandId: string
  command: FlespiCommand
  /** Instantané : réponse du boîtier. File : null. */
  executed: boolean
  response: unknown
  expiresAt: Date | null
}

/**
 * Contrôle une commande contre le catalogue RÉEL du boîtier.
 * Retourne la liste des erreurs (vide = valide).
 */
export function checkAgainstCatalog(
  cmd: FlespiCommand,
  catalogue: FlespiCommandDefinition[]
): string[] {
  if (catalogue.length === 0) return [] // catalogue indisponible : flespi tranchera
  const def = catalogue.find((c) => c.name === cmd.name)
  if (!def) {
    return [
      `La commande « ${cmd.name} » n'existe pas pour ce type de boîtier. ` +
        `Disponibles : ${catalogue.map((c) => c.name).join(', ')}`,
    ]
  }
  return validateAgainstSchema(cmd.properties, def.schema)
}

export class HttpFlespiCommandGateway {
  constructor(private readonly client: FlespiClient) {}

  /** Mise en file : la commande part dès que le boîtier est connecté. */
  async queue(
    flespiDeviceId: number,
    cmd: FlespiCommand,
    opts: QueueOptions = {}
  ): Promise<SendResult> {
    const item: Record<string, unknown> = { name: cmd.name, properties: cmd.properties }
    if (opts.ttl !== undefined) item.ttl = Math.min(Math.max(opts.ttl, 60), 2_592_000)
    if (opts.maxAttempts !== undefined) item.max_attempts = opts.maxAttempts
    if (opts.priority !== undefined) item.priority = opts.priority

    const r = await this.client.first<FlespiQueuedCommand>(
      'POST',
      `/gw/devices/${flespiDeviceId}/commands-queue`,
      { body: [item] }
    )
    if (!r?.id) throw new Error("Flespi n'a pas retourné d'identifiant de commande")

    logger.info(
      { flespiDeviceId, name: cmd.name, id: r.id, expires: r.expires },
      '[flespi] commande en file'
    )
    return {
      mode: 'queue',
      providerCommandId: String(r.id),
      command: cmd,
      executed: Boolean(r.executed),
      response: r.response ?? null,
      expiresAt: r.expires ? new Date(r.expires * 1000) : null,
    }
  }

  /** Exécution immédiate : échoue si le boîtier n'est pas connecté. */
  async execute(flespiDeviceId: number, cmd: FlespiCommand, timeoutS = 30): Promise<SendResult> {
    const r = await this.client.first<FlespiCommandResult>(
      'POST',
      `/gw/devices/${flespiDeviceId}/commands`,
      {
        body: [
          {
            name: cmd.name,
            properties: cmd.properties,
            timeout: Math.min(Math.max(timeoutS, 5), 60),
          },
        ],
      }
    )
    if (!r) throw new Error("Flespi n'a pas retourné de résultat de commande")
    logger.info(
      { flespiDeviceId, name: cmd.name, id: r.id, executed: r.executed },
      '[flespi] commande exécutée'
    )
    return {
      mode: 'instant',
      providerCommandId: String(r.id),
      command: cmd,
      executed: Boolean(r.executed),
      response: r.response ?? null,
      expiresAt: null,
    }
  }

  /** Résultats des commandes exécutées (acquittées ou refusées par le boîtier). */
  async results(flespiDeviceId: number): Promise<FlespiCommandResult[]> {
    const env = await this.client.request<FlespiCommandResult>(
      'GET',
      `/gw/devices/${flespiDeviceId}/commands-result`
    )
    return env.result
  }

  /** Commandes encore en file chez flespi. */
  async pending(flespiDeviceId: number): Promise<FlespiQueuedCommand[]> {
    const env = await this.client.request<FlespiQueuedCommand>(
      'GET',
      `/gw/devices/${flespiDeviceId}/commands-queue/all`
    )
    return env.result
  }

  /** Retire une commande de la file (avant qu'elle ne parte). */
  async cancel(flespiDeviceId: number, providerCommandId: string): Promise<void> {
    await this.client.request(
      'DELETE',
      `/gw/devices/${flespiDeviceId}/commands-queue/${providerCommandId}`
    )
  }
}

/**
 * Adaptateur du port applicatif `DeviceCommandGateway` (contexte sécurité).
 *
 * Prêt pour le Jalon 3 : l'immobilisation validée appellera `sendEngineCut`,
 * qui met en file `custom { S20, "1,1" }` avec un TTL court — une coupure
 * moteur exécutée une heure après la décision n'a plus de sens.
 */
export class FlespiDeviceCommandGateway implements DeviceCommandGateway {
  constructor(
    private readonly gateway: HttpFlespiCommandGateway,
    private readonly ttlSeconds = 900
  ) {}

  async sendEngineCut(input: {
    deviceId: string
    externalDeviceId: string | null
    commandId: string
  }) {
    return this.envoyer(input.externalDeviceId, 'cut_engine')
  }

  async sendEngineRestore(input: {
    deviceId: string
    externalDeviceId: string | null
    commandId: string
  }) {
    return this.envoyer(input.externalDeviceId, 'restore_engine')
  }

  private async envoyer(externalDeviceId: string | null, commande: FlespiCommandName) {
    if (!externalDeviceId) throw new Error('Boîtier non rattaché à flespi : commande impossible')
    const r = await this.gateway.queue(Number(externalDeviceId), buildBusinessCommand(commande), {
      ttl: this.ttlSeconds,
      maxAttempts: 3,
      priority: 10,
    })
    return { providerCommandId: r.providerCommandId }
  }
}

/**
 * Passerelle factice : exerce toute la chaîne (API, habilitations, audit,
 * machine à états) sans jeton flespi ni boîtier réel.
 */
export class FakeFlespiCommandGateway {
  readonly sent: Array<{ deviceId: number; command: FlespiCommand; mode: 'queue' | 'instant' }> = []

  async queue(flespiDeviceId: number, cmd: FlespiCommand): Promise<SendResult> {
    this.sent.push({ deviceId: flespiDeviceId, command: cmd, mode: 'queue' })
    return {
      mode: 'queue',
      providerCommandId: `fake-${this.sent.length}`,
      command: cmd,
      executed: false,
      response: null,
      expiresAt: null,
    }
  }

  async execute(flespiDeviceId: number, cmd: FlespiCommand): Promise<SendResult> {
    this.sent.push({ deviceId: flespiDeviceId, command: cmd, mode: 'instant' })
    return {
      mode: 'instant',
      providerCommandId: `fake-${this.sent.length}`,
      command: cmd,
      executed: true,
      response: 'OK',
      expiresAt: null,
    }
  }
}
