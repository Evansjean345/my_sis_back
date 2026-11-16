import transmit from '@adonisjs/transmit/services/main'
import logger from '@adonisjs/core/services/logger'
import type { DeviceStatusPayload, RealtimeBroadcaster } from '#application/telemetry/ports'

/**
 * Diffusion temps réel vers les tableaux de bord (SSE).
 *
 * Le canal est cloisonné par organisation : un client ne peut pas s'abonner au
 * flux d'une autre entité.
 *
 * Best-effort volontaire : un échec de diffusion ne doit JAMAIS faire échouer
 * l'ingestion. La position est déjà persistée — perdre un rafraîchissement
 * d'écran est sans conséquence, perdre une position ne l'est pas.
 */
//SERVER SIDE EVENT POUR LA PUBLICATIONS EN TEMPS REELS DES POSITIONS
export class TransmitBroadcaster implements RealtimeBroadcaster {
  async publishPosition(organizationId: string, payload: Record<string, unknown>): Promise<void> {
    try {
      transmit.broadcast(`org/${organizationId}/positions`, payload as never)
    } catch (err) {
      logger.warn({ err, organizationId }, '[realtime] diffusion en échec — sans incidence')
    }
  }

  /** Canal `org/{id}/devices` — autorisé dans `start/transmit.ts`. */
  async publishDeviceStatus(organizationId: string, payload: DeviceStatusPayload): Promise<void> {
    try {
      transmit.broadcast(`org/${organizationId}/devices`, payload as never)
    } catch (err) {
      logger.warn({ err, organizationId }, '[realtime] diffusion d’état en échec — sans incidence')
    }
  }
}

/** Diffuseur muet, pour les tests. */
export class NoopBroadcaster implements RealtimeBroadcaster {
  readonly published: Array<{ organizationId: string; payload: Record<string, unknown> }> = []

  readonly statuses: Array<{ organizationId: string; payload: DeviceStatusPayload }> = []

  async publishPosition(organizationId: string, payload: Record<string, unknown>): Promise<void> {
    this.published.push({ organizationId, payload })
  }

  async publishDeviceStatus(organizationId: string, payload: DeviceStatusPayload): Promise<void> {
    this.statuses.push({ organizationId, payload })
  }
}
