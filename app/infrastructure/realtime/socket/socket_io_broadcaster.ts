import { Emitter } from '@socket.io/redis-emitter'
import logger from '@adonisjs/core/services/logger'
import type { RealtimeBroadcaster } from '#application/telemetry/ports'
import type { TripLiveUpdate } from '#domain/telemetry/code_legacy/trip/trip_reading_types'
import {
  TRIPS_NAMESPACE,
  TRIP_SERVER_EVENTS,
  tripRooms,
} from '#infrastructure/realtime/socket/socket_contract'

/** Client Redis accepté par l'émetteur (ioredis). */
type RedisClient = ConstructorParameters<typeof Emitter>[0]

/**
 * Diffusion Socket.IO depuis N'IMPORTE QUEL processus.
 *
 * L'ingestion (`node ace sisbm:ingest`) ne porte pas le serveur Socket.IO :
 * elle publie dans Redis, et l'adaptateur Redis du serveur (processus API,
 * une ou plusieurs instances) relaie aux connexions des salles visées.
 *
 *   trip:started / trip:closed  → salles org:<id> et vehicle:<id>
 *   trip:progress (points)      → salle vehicle:<id> seulement : seuls les
 *                                 écrans qui suivent CE véhicule reçoivent ses points
 *
 * Best-effort, comme la diffusion SSE : un échec n'interrompt jamais l'ingestion.
 */
export class SocketIoBroadcaster implements RealtimeBroadcaster {
  readonly #trips: ReturnType<Emitter['of']>

  constructor(redis: RedisClient) {
    this.#trips = new Emitter(redis).of(TRIPS_NAMESPACE)
  }

  /** Positions : déjà diffusées par le flux SSE (`org/:id/positions`). */
  async publishPosition(): Promise<void> {}

  async publishTrip(organizationId: string, update: TripLiveUpdate): Promise<void> {
    try {
      const vehicule = tripRooms.vehicle(update.trip.vehicleId)
      if (update.type === 'progress') {
        this.#trips.to(vehicule).emit(TRIP_SERVER_EVENTS.progress, update)
        return
      }
      this.#trips
        .to([tripRooms.organization(organizationId), vehicule])
        .emit(TRIP_SERVER_EVENTS[update.type], update)
    } catch (err) {
      logger.warn(
        { err, organizationId },
        '[socket.io] diffusion de trajet en échec — sans incidence'
      )
    }
  }
}
