import { Err, Ok, type Result } from '#domain/kernel'
import {
  LIVE_MAX_FOLLOWED_VEHICLES,
  TRIP_LIST_DEFAULT_PER_PAGE,
  TRIP_LIST_MAX_PER_PAGE,
  TRIP_LIST_MAX_RANGE_DAYS,
  TRIP_POINTS_DEFAULT_LIMIT,
  TRIP_POINTS_MAX_LIMIT,
} from '#domain/telemetry/code_legacy/trip/trip_reading_limits'
import type {
  TripLiveSnapshot,
  TripPoint,
  TripReadScope,
} from '#domain/telemetry/code_legacy/trip/trip_reading_types'
import type { TelemetryReading } from '#domain/telemetry/entities/telemetry_reading'
import type { Trip } from '#domain/telemetry/entities/trip'
import { InvalidTripRangeError } from '#domain/telemetry/errors'

/**
 * =========================================================================
 *  LECTURE DES TRAJETS — règles pures
 * =========================================================================
 *
 * Fonctions seulement : types et limites vivent dans `code_legacy/trip`.
 * Aucune I/O : la lecture SQL est faite par l'infrastructure, la connexion
 * persistante (Socket.IO) par la présentation.
 */

const MS_PER_DAY = 86_400_000

/** Période de recherche : début avant fin, au plus `TRIP_LIST_MAX_RANGE_DAYS` jours. */
export function tripRange(from: Date, to: Date): Result<{ from: Date; to: Date }> {
  const lisible = !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())
  if (
    !lisible ||
    from.getTime() > to.getTime() ||
    to.getTime() - from.getTime() > TRIP_LIST_MAX_RANGE_DAYS * MS_PER_DAY
  ) {
    return Err(
      new InvalidTripRangeError(
        lisible ? from.toISOString() : String(from),
        lisible ? to.toISOString() : String(to),
        TRIP_LIST_MAX_RANGE_DAYS
      )
    )
  }
  return Ok({ from, to })
}

function borne(value: number | undefined, defaut: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return defaut
  return Math.min(Math.max(1, Math.trunc(value)), max)
}

/** Trajets par page : 25 par défaut, 100 au plus. */
export function tripsPerPage(value?: number): number {
  return borne(value, TRIP_LIST_DEFAULT_PER_PAGE, TRIP_LIST_MAX_PER_PAGE)
}

/** Points par page : 500 par défaut, 2 000 au plus. */
export function tripPointsLimit(value?: number): number {
  return borne(value, TRIP_POINTS_DEFAULT_LIMIT, TRIP_POINTS_MAX_LIMIT)
}

/** Nombre de véhicules suivis en direct encore autorisé sur une connexion. */
export function followCapacity(alreadyFollowed: number): number {
  return Math.max(0, LIVE_MAX_FOLLOWED_VEHICLES - alreadyFollowed)
}

/** Cloisonnement : un compte ne lit que les trajets de son organisation (le joker `*` lit tout). */
export function canReadOrganization(scope: TripReadScope, organizationId: string): boolean {
  return scope.organizationId === null || scope.organizationId === organizationId
}

/** État d'un trajet, au format des mises à jour en direct. */
export function tripLiveSnapshot(trip: Trip): TripLiveSnapshot {
  const s = trip.snapshot()
  return {
    id: s.id,
    organizationId: s.organizationId,
    vehicleId: s.vehicleId,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    lastPointAt: s.lastPointAt.toISOString(),
    distanceMeters: s.distanceMeters,
    durationSeconds: s.durationSeconds,
    maxSpeedKph: s.maxSpeedKph,
    avgSpeedKph: s.avgSpeedKph,
    positionsCount: s.positionsCount,
    closeReason: s.closeReason,
  }
}

/** Point du tracé, à partir d'une lecture de télémétrie. */
export function tripPointOf(reading: TelemetryReading): TripPoint {
  return {
    recordedAt: reading.recordedAt.toISOString(),
    latitude: reading.coordinates.latitude,
    longitude: reading.coordinates.longitude,
    speedKph: reading.speed.kph,
    headingDeg: reading.headingDeg,
    ignition: reading.ignition,
  }
}
