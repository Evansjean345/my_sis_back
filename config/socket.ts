import env from '#start/env'

/**
 * =========================================================================
 *  SOCKET.IO — connexion persistante des tableaux de bord
 * =========================================================================
 *
 * Attaché au serveur HTTP de l'API (même port), sur `path`. Derrière Nginx,
 * la mise à niveau WebSocket doit être relayée (cf. docs/11).
 *
 * Plusieurs instances de l'API partagent les salles par l'adaptateur Redis :
 * une mise à jour publiée par l'ingestion atteint chaque connexion, quelle
 * que soit l'instance qui la porte.
 */
const origines = env.get('SOCKET_IO_CORS_ORIGIN', '*')

export default {
  enabled: env.get('SOCKET_IO_ENABLED', true),
  path: env.get('SOCKET_IO_PATH', '/socket.io'),

  /** `*` ou liste séparée par des virgules (`https://admin.sisbm-core.com,https://…`). */
  corsOrigin:
    origines.trim() === '*'
      ? ('*' as const)
      : origines
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),

  /** Battement de cœur : une connexion morte (réseau mobile coupé) est libérée en ~45 s. */
  pingIntervalMs: 25_000,
  pingTimeoutMs: 20_000,

  /** Les demandes du tableau de bord sont petites : 100 Ko suffisent largement. */
  maxHttpBufferSize: 100_000,

  /** Revérification du jeton des connexions ouvertes (déconnexion, compte suspendu). */
  sessionCheckSeconds: env.get('SOCKET_IO_SESSION_CHECK_SECONDS', 60),
}
