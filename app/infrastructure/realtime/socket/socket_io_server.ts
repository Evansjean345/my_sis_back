import type { Server as HttpServer } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'

/** Client Redis (ioredis) : publication, et son double pour l'abonnement. */
interface DuplicableRedis {
  duplicate(): unknown
}

export interface SocketServerOptions {
  path: string
  corsOrigin: '*' | string[]
  pingIntervalMs: number
  pingTimeoutMs: number
  maxHttpBufferSize: number
}

/**
 * =========================================================================
 *  SERVEUR SOCKET.IO — attaché au serveur HTTP de l'API
 * =========================================================================
 *
 * Même port que l'API, chemin dédié (`/socket.io` par défaut) : un seul
 * domaine, un seul certificat, un seul bloc Nginx.
 *
 * Adaptateur Redis : les salles sont partagées entre instances de l'API, et
 * l'émetteur Redis de l'ingestion atteint toutes les connexions.
 *
 * Transports : WebSocket d'abord, long-polling en repli (proxy d'entreprise,
 * réseau mobile qui bloque la mise à niveau). Le jeton circule dans
 * `auth.token` du handshake, jamais dans l'URL : il n'apparaît pas dans les
 * journaux d'accès Nginx.
 */
export function createSocketServer(
  httpServer: HttpServer | HttpsServer,
  redis: DuplicableRedis,
  options: SocketServerOptions
): Server {
  return new Server(httpServer, {
    path: options.path,
    serveClient: false,
    transports: ['websocket', 'polling'],
    pingInterval: options.pingIntervalMs,
    pingTimeout: options.pingTimeoutMs,
    maxHttpBufferSize: options.maxHttpBufferSize,
    // Le jeton est porté par le handshake, pas par un cookie : pas d'identifiants CORS.
    cors: { origin: options.corsOrigin, methods: ['GET', 'POST'], credentials: false },
    adapter: createAdapter(redis, redis.duplicate()),
  })
}
