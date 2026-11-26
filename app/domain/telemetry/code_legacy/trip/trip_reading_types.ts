import type { TripLiveUpdateType } from '#domain/telemetry/code_legacy/trip/trip_live_events'
import type { TripCloseReason, TripStatus } from '#domain/telemetry/value_objects'

/**
 * =========================================================================
 *  TRAJETS — interfaces de lecture (référentiel en dur)
 * =========================================================================
 *
 * Formes échangées avec les tableaux de bord : dates en ISO 8601 (UTC),
 * distances en mètres, vitesses en km/h.
 */

export interface GeoPoint {
  readonly latitude: number
  readonly longitude: number
}

/** Périmètre de lecture : une organisation, ou toutes (`null`, exploitant de la plateforme). */
export interface TripReadScope {
  readonly organizationId: string | null
}

/** Un trajet tel qu'il est listé et affiché. */
export interface TripSummary {
  readonly id: string
  readonly organizationId: string
  readonly vehicleId: string
  readonly registration: string | null
  readonly deviceId: string | null
  readonly status: TripStatus
  readonly startedAt: string
  readonly endedAt: string | null
  readonly lastPointAt: string
  readonly startLocation: GeoPoint | null
  readonly endLocation: GeoPoint | null
  readonly startAddress: string | null
  readonly endAddress: string | null
  readonly distanceMeters: number
  readonly durationSeconds: number | null
  readonly idleSeconds: number
  readonly maxSpeedKph: number | null
  readonly avgSpeedKph: number | null
  readonly positionsCount: number
  readonly closeReason: TripCloseReason | null
}

/** Un point du tracé. */
export interface TripPoint extends GeoPoint {
  readonly recordedAt: string
  readonly speedKph: number | null
  readonly headingDeg: number | null
  readonly ignition: boolean | null
}

/** Recherche de trajets. */
export interface TripListQuery {
  readonly scope: TripReadScope
  readonly from: Date
  readonly to: Date
  readonly vehicleId?: string
  readonly status?: TripStatus
  readonly page: number
  readonly perPage: number
}

export interface TripListPage {
  readonly data: TripSummary[]
  readonly meta: { readonly total: number; readonly page: number; readonly perPage: number }
}

/**
 * Une page de points. `nextCursor` (ISO de `recorded_at`) se repasse en
 * `after` pour la page suivante ; `done` dit qu'il n'y a plus rien à lire
 * pour l'instant (un trajet ouvert peut encore grandir : le direct prend le relais).
 */
export interface TripPointsPage {
  readonly tripId: string
  readonly points: TripPoint[]
  readonly nextCursor: string | null
  readonly done: boolean
}

/** État d'un trajet au moment d'une mise à jour en direct. */
export interface TripLiveSnapshot {
  readonly id: string
  readonly organizationId: string
  readonly vehicleId: string
  readonly status: TripStatus
  readonly startedAt: string
  readonly endedAt: string | null
  readonly lastPointAt: string
  readonly distanceMeters: number
  readonly durationSeconds: number | null
  readonly maxSpeedKph: number
  readonly avgSpeedKph: number
  readonly positionsCount: number
  readonly closeReason: TripCloseReason | null
}

/** Mise à jour diffusée en direct ; `points` seulement pour `progress`. */
export interface TripLiveUpdate {
  readonly type: TripLiveUpdateType
  readonly trip: TripLiveSnapshot
  readonly points: TripPoint[]
}
