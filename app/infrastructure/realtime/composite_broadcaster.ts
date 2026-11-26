import type { DeviceStatusPayload, RealtimeBroadcaster } from '#application/telemetry/ports'
import type { TripLiveUpdate } from '#domain/telemetry/code_legacy/trip/trip_reading_types'

/**
 * Plusieurs canaux temps réel derrière un seul port : le flux SSE existant
 * (positions, état des boîtiers) ET Socket.IO (trajets). Chaque diffuseur
 * reçoit ce qu'il sait traiter ; un diffuseur en échec n'empêche pas les autres.
 */
export class CompositeBroadcaster implements RealtimeBroadcaster {
  constructor(private readonly broadcasters: readonly RealtimeBroadcaster[]) {}

  async publishPosition(organizationId: string, payload: Record<string, unknown>): Promise<void> {
    await this.each((b) => b.publishPosition(organizationId, payload))
  }

  async publishDeviceStatus(organizationId: string, payload: DeviceStatusPayload): Promise<void> {
    await this.each((b) => b.publishDeviceStatus?.(organizationId, payload))
  }

  async publishTrip(organizationId: string, update: TripLiveUpdate): Promise<void> {
    await this.each((b) => b.publishTrip?.(organizationId, update))
  }

  private async each(send: (b: RealtimeBroadcaster) => Promise<void> | undefined) {
    await Promise.allSettled(this.broadcasters.map(async (b) => send(b)))
  }
}
