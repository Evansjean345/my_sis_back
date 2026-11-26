/**
 * =========================================================================
 *  CONTRAT SOCKET.IO — espace `/trips` (lecture et suivi des trajets)
 * =========================================================================
 *
 * Source unique des noms d'événements et de salles, partagée par le serveur
 * (passerelle de présentation) et par l'émetteur Redis du processus
 * d'ingestion. Un tableau de bord n'utilise que ces noms.
 *
 * Connexion : `io(API_URL + '/trips', { path: '/socket.io', auth: { token } })`
 * — le jeton est celui de `POST /api/v1/auth/login` (`sisbm_…`).
 */

export const TRIPS_NAMESPACE = '/trips'

/** Demandes du tableau de bord, toutes avec acquittement `{ data } | { error }`. */
export const TRIP_CLIENT_EVENTS = {
  /** `{ from, to, vehicleId?, status?, page?, perPage?, organizationId? }` → page de trajets. */
  listTrips: 'trips:list',
  /** `{ tripId }` → résumé du trajet. */
  getTrip: 'trip:get',
  /** `{ tripId, after?, limit? }` → page de points (curseur `nextCursor`). */
  tripPoints: 'trip:points',
  /** `{ vehicleIds }` → suivi en direct de ces véhicules. */
  followVehicles: 'vehicles:follow',
  /** `{ vehicleIds }` → fin du suivi. */
  unfollowVehicles: 'vehicles:unfollow',
  /** `{ organizationId }` → exploitant seulement : ouverture / clôture de toute une organisation. */
  followOrganization: 'organization:follow',
  unfollowOrganization: 'organization:unfollow',
} as const

/** Diffusions du serveur. Charge utile : `TripLiveUpdate` (`type`, `trip`, `points`). */
export const TRIP_SERVER_EVENTS = {
  started: 'trip:started',
  progress: 'trip:progress',
  closed: 'trip:closed',
  /** Session expirée ou révoquée : la connexion va être fermée. */
  sessionEnded: 'session:ended',
} as const

/**
 * Salles :
 *   org:<id>      ouverture et clôture des trajets de l'organisation (rejointe à la connexion)
 *   vehicle:<id>  tout le direct d'un véhicule, points compris (sur `vehicles:follow`)
 */
export const tripRooms = {
  organization: (organizationId: string) => `org:${organizationId}`,
  vehicle: (vehicleId: string) => `vehicle:${vehicleId}`,
  isVehicle: (room: string) => room.startsWith('vehicle:'),
} as const
