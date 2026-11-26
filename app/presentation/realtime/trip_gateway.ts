import type { Namespace, Server, Socket } from 'socket.io'
import logger from '@adonisjs/core/services/logger'
import { covers, isPlatformOperator } from '#domain/identity/role_policy'
import type { TripReadScope } from '#domain/telemetry/code_legacy/trip/trip_reading_types'
import type { TripReader } from '#application/telemetry/ports'
import type { ListTrips } from '#application/telemetry/use_cases/list_trips'
import type { GetTrip } from '#application/telemetry/use_cases/get_trip'
import type { ReadTripPoints } from '#application/telemetry/use_cases/read_trip_points'
import type { FollowVehicles } from '#application/telemetry/use_cases/follow_vehicles'
import type {
  SocketActor,
  SocketAuthenticator,
} from '#infrastructure/realtime/socket/socket_authenticator'
import {
  TRIPS_NAMESPACE,
  TRIP_CLIENT_EVENTS,
  TRIP_SERVER_EVENTS,
  tripRooms,
} from '#infrastructure/realtime/socket/socket_contract'
import {
  fromResult,
  socketError,
  toSocketError,
  type SocketAck,
  type SocketError,
} from '#presentation/realtime/socket_handler'
import {
  getTripValidator,
  listTripsValidator,
  organizationValidator,
  tripPointsValidator,
  vehiclesValidator,
} from '#presentation/realtime/validators/trip_socket_validators'

/** Habilitation exigée : voir la flotte (`viewVehicles` des routes HTTP). */
const REQUIRED_PERMISSION = 'vehicle:read'

/** `setTimeout` ne dépasse pas ~24,8 jours. */
const MAX_TIMER_MS = 2_147_483_647

export interface TripGatewayDeps {
  authenticator: SocketAuthenticator
  reader: TripReader
  listTrips: ListTrips
  getTrip: GetTrip
  readTripPoints: ReadTripPoints
  followVehicles: FollowVehicles
  sessionCheckSeconds: number
}

/** Données propres à une connexion (jamais envoyées au client). */
interface SocketData {
  actor: SocketActor
  token: string
  expiryTimer?: NodeJS.Timeout
}

/** Événements libres : leurs noms et charges sont fixés par `socket_contract`. */
type Events = Record<string, (...args: any[]) => void>
type TripSocket = Socket<Events, Events, Events, SocketData>
type Ack<T = unknown> = (response: SocketAck<T>) => void

/**
 * =========================================================================
 *  PASSERELLE SOCKET.IO `/trips` — lecture et suivi des trajets
 * =========================================================================
 *
 * L'équivalent d'un contrôleur pour la connexion persistante : authentifie,
 * vérifie les habilitations, valide la forme des demandes, appelle les cas
 * d'usage, répond par acquittement. Aucune règle métier ici.
 *
 * Cloisonnement :
 *   - connexion refusée sans jeton valide ou sans `vehicle:read` ;
 *   - un compte d'organisation ne lit et ne suit que SES trajets et véhicules,
 *     et rejoint d'office la salle de son organisation (ouvertures / clôtures) ;
 *   - l'exploitant (joker `*`) lit tout et choisit les organisations suivies ;
 *   - le jeton est revérifié périodiquement : une déconnexion, une suspension
 *     ou un changement de rôle ferme la connexion ouverte.
 */
export function registerTripGateway(io: Server, deps: TripGatewayDeps) {
  const nsp: Namespace = io.of(TRIPS_NAMESPACE)

  nsp.use(async (socket, next) => {
    try {
      const token = tokenOf(socket)
      const actor = token ? await deps.authenticator.authenticate(token) : null
      if (!actor) return next(refus('E_UNAUTHORIZED', 'Authentification requise'))
      if (!covers(actor.permissions, REQUIRED_PERMISSION)) {
        return next(refus('E_FORBIDDEN', "Vous n'avez pas l'habilitation requise"))
      }
      socket.data = { actor, token: token! } satisfies SocketData
      next()
    } catch (err) {
      logger.error({ err }, '[socket.io] authentification impossible')
      next(refus('E_INTERNAL', 'Erreur interne'))
    }
  })

  nsp.on('connection', (raw) => {
    const socket = raw as TripSocket
    const { actor } = socket.data
    if (!isPlatformOperator(actor.permissions)) {
      void socket.join(tripRooms.organization(actor.organizationId))
    }
    programmerExpiration(socket)
    socket.on('disconnect', () => clearTimeout(socket.data.expiryTimer))

    on(socket, TRIP_CLIENT_EVENTS.listTrips, async (payload) => {
      const f = await listTripsValidator.validate(payload)
      const portee = perimetre(socket, f.organizationId)
      if ('error' in portee) return portee
      return fromResult(
        await deps.listTrips.execute({
          scope: portee,
          from: new Date(f.from),
          to: new Date(f.to),
          vehicleId: f.vehicleId,
          status: f.status,
          page: f.page,
          perPage: f.perPage,
        })
      )
    })

    on(socket, TRIP_CLIENT_EVENTS.getTrip, async (payload) => {
      const f = await getTripValidator.validate(payload)
      return fromResult(await deps.getTrip.execute({ scope: scopeOf(socket), tripId: f.tripId }))
    })

    on(socket, TRIP_CLIENT_EVENTS.tripPoints, async (payload) => {
      const f = await tripPointsValidator.validate(payload)
      return fromResult(
        await deps.readTripPoints.execute({
          scope: scopeOf(socket),
          tripId: f.tripId,
          after: f.after ? new Date(f.after) : undefined,
          limit: f.limit,
        })
      )
    })

    on(socket, TRIP_CLIENT_EVENTS.followVehicles, async (payload) => {
      const f = await vehiclesValidator.validate(payload)
      const suivis = vehiculesSuivis(socket)
      const r = await deps.followVehicles.execute({
        scope: scopeOf(socket),
        vehicleIds: f.vehicleIds.filter((id) => !suivis.includes(id)),
        alreadyFollowed: suivis.length,
      })
      if (!r.ok) return fromResult(r)
      await socket.join(r.value.accepted.map(tripRooms.vehicle))
      return { data: { ...r.value, following: vehiculesSuivis(socket) } }
    })

    on(socket, TRIP_CLIENT_EVENTS.unfollowVehicles, async (payload) => {
      const f = await vehiclesValidator.validate(payload)
      await Promise.all(f.vehicleIds.map((id) => socket.leave(tripRooms.vehicle(id))))
      return { data: { following: vehiculesSuivis(socket) } }
    })

    on(socket, TRIP_CLIENT_EVENTS.followOrganization, async (payload) => {
      const f = await organizationValidator.validate(payload)
      if (!isPlatformOperator(socket.data.actor.permissions)) {
        return socketError('E_FORBIDDEN', 'Réservé à l’exploitant de la plateforme')
      }
      if (!(await deps.reader.organizationExists(f.organizationId))) {
        return socketError('E_NOT_FOUND', 'Organisation introuvable')
      }
      await socket.join(tripRooms.organization(f.organizationId))
      return { data: { organizationId: f.organizationId } }
    })

    on(socket, TRIP_CLIENT_EVENTS.unfollowOrganization, async (payload) => {
      const f = await organizationValidator.validate(payload)
      if (!isPlatformOperator(socket.data.actor.permissions)) {
        return socketError('E_FORBIDDEN', 'Réservé à l’exploitant de la plateforme')
      }
      await socket.leave(tripRooms.organization(f.organizationId))
      return { data: { organizationId: f.organizationId } }
    })
  })

  // ---- revérification périodique des sessions ouvertes
  const verification = setInterval(
    () => void reverifier(nsp, deps.authenticator),
    deps.sessionCheckSeconds * 1000
  )
  verification.unref()

  return {
    namespace: nsp,
    stop: () => clearInterval(verification),
  }
}

// ---------------------------------------------------------------------------

/** Jeton du handshake : `auth.token` (navigateur), ou en-tête `Authorization` (outils, mobile). */
function tokenOf(socket: Socket): string | null {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined
  if (typeof auth?.token === 'string' && auth.token) return auth.token
  const entete = socket.handshake.headers.authorization
  return typeof entete === 'string' && entete ? entete : null
}

/** Erreur de connexion lisible côté client : `connect_error` → `err.message`, `err.data.code`. */
function refus(code: string, message: string): Error {
  return Object.assign(new Error(message), { data: { code, message } })
}

/** Périmètre de l'acteur : son organisation, ou toutes pour l'exploitant. */
function scopeOf(socket: TripSocket): TripReadScope {
  const { actor } = socket.data
  return { organizationId: isPlatformOperator(actor.permissions) ? null : actor.organizationId }
}

/** L'exploitant peut restreindre à une organisation ; un compte client reste dans la sienne. */
function perimetre(
  socket: TripSocket,
  organizationId: string | undefined
): TripReadScope | { error: SocketError } {
  const scope = scopeOf(socket)
  if (!organizationId) return scope
  if (scope.organizationId === null) return { organizationId }
  return organizationId === scope.organizationId
    ? scope
    : { error: { code: 'E_FORBIDDEN', message: 'Organisation hors de votre périmètre' } }
}

function vehiculesSuivis(socket: TripSocket): string[] {
  return [...socket.rooms].filter(tripRooms.isVehicle).map((room) => room.slice('vehicle:'.length))
}

/** Toutes les demandes : acquittement obligatoire, erreurs au format commun. */
function on(
  socket: TripSocket,
  event: string,
  handler: (payload: unknown) => Promise<SocketAck<unknown>>
) {
  socket.on(event, async (payload: unknown, ack: unknown) => {
    // Sans acquittement, la réponse n'aurait nulle part où aller.
    if (typeof ack !== 'function') return
    try {
      ;(ack as Ack)(await handler(payload ?? {}))
    } catch (err) {
      ;(ack as Ack)({ error: toSocketError(err) })
    }
  })
}

function terminer(socket: TripSocket, code: string, message: string) {
  socket.emit(TRIP_SERVER_EVENTS.sessionEnded, { code, message })
  socket.disconnect(true)
}

/** Fermeture à l'expiration du jeton (7 jours après la connexion au plus). */
function programmerExpiration(socket: TripSocket) {
  const fin = socket.data.actor.expiresAt
  if (!fin) return
  const delai = Math.min(Math.max(0, fin.getTime() - Date.now()), MAX_TIMER_MS)
  socket.data.expiryTimer = setTimeout(
    () => terminer(socket, 'E_SESSION_EXPIRED', 'Session expirée : reconnectez-vous'),
    delai
  )
}

/** Un jeton révoqué (déconnexion), un compte suspendu ou un rôle réduit ferme la connexion. */
async function reverifier(nsp: Namespace, authenticator: SocketAuthenticator) {
  for (const raw of nsp.sockets.values()) {
    const socket = raw as TripSocket
    try {
      const actor = await authenticator.authenticate(socket.data.token)
      if (!actor || !covers(actor.permissions, REQUIRED_PERMISSION)) {
        terminer(socket, 'E_UNAUTHORIZED', 'Session révoquée : reconnectez-vous')
        continue
      }
      socket.data.actor = actor
    } catch (err) {
      // Base momentanément indisponible : on garde la connexion, nouvel essai au prochain tour.
      logger.warn({ err }, '[socket.io] revérification de session impossible')
    }
  }
}
