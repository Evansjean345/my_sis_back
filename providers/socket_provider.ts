import type { ApplicationService } from '@adonisjs/core/types'
import type { Server } from 'socket.io'

/**
 * =========================================================================
 *  SOCKET.IO — démarrage avec le serveur HTTP de l'API
 * =========================================================================
 *
 * `ready()` s'exécute une fois le serveur HTTP créé : Socket.IO s'y attache
 * (même port, chemin `/socket.io`). Enregistré pour l'environnement `web`
 * seulement : ni les commandes ace (`sisbm:ingest` publie par l'émetteur
 * Redis), ni les tests n'ouvrent de serveur.
 */
export default class SocketProvider {
  #io: Server | null = null
  #stop: (() => void) | null = null

  constructor(protected app: ApplicationService) {}

  async ready() {
    if (this.app.getEnvironment() !== 'web') return
    const { default: config } = await import('#config/socket')
    if (!config.enabled) return

    const server = await this.app.container.make('server')
    const http = server.getNodeServer()
    if (!http) return

    const { default: logger } = await import('@adonisjs/core/services/logger')
    const { default: redis } = await import('@adonisjs/redis/services/main')
    const { createSocketServer } = await import('#infrastructure/realtime/socket/socket_io_server')
    const { SocketAuthenticator } =
      await import('#infrastructure/realtime/socket/socket_authenticator')
    const { LucidTripReader } = await import('#infrastructure/persistence/readers/trip_reader')
    const { ListTrips } = await import('#application/telemetry/use_cases/list_trips')
    const { GetTrip } = await import('#application/telemetry/use_cases/get_trip')
    const { ReadTripPoints } = await import('#application/telemetry/use_cases/read_trip_points')
    const { FollowVehicles } = await import('#application/telemetry/use_cases/follow_vehicles')
    const { registerTripGateway } = await import('#presentation/realtime/trip_gateway')

    const io = createSocketServer(http, redis.connection('realtime').ioConnection, config)
    this.#io = io
    const gateway = registerTripGateway(io, {
      authenticator: new SocketAuthenticator(),
      reader: await this.app.container.make(LucidTripReader),
      listTrips: await this.app.container.make(ListTrips),
      getTrip: await this.app.container.make(GetTrip),
      readTripPoints: await this.app.container.make(ReadTripPoints),
      followVehicles: await this.app.container.make(FollowVehicles),
      sessionCheckSeconds: config.sessionCheckSeconds,
    })
    this.#stop = gateway.stop
    logger.info(`[socket.io] prêt sur ${config.path} (espace /trips)`)
  }

  async shutdown() {
    this.#stop?.()
    if (!this.#io) return
    // Ferme les connexions ; le serveur HTTP est arrêté par AdonisJS lui-même.
    this.#io.disconnectSockets(true)
    this.#io.engine.close()
    this.#io = null
  }
}
