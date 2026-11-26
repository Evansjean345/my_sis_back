import db from '@adonisjs/lucid/services/db'
import type { TripPointsQuery, TripReader } from '#application/telemetry/ports'
import type {
  GeoPoint,
  TripListPage,
  TripListQuery,
  TripPoint,
  TripReadScope,
  TripSummary,
} from '#domain/telemetry/code_legacy/trip/trip_reading_types'
import type { TripCloseReason, TripStatus } from '#domain/telemetry/value_objects'

const COLONNES = `
  t.id, t.organization_id, t.vehicle_id, v.registration, t.device_id, t.status,
  t.started_at, t.ended_at, COALESCE(t.last_point_at, t.ended_at, t.started_at) AS last_point_at,
  ST_Y(t.start_location::geometry) AS start_lat, ST_X(t.start_location::geometry) AS start_lng,
  ST_Y(t.end_location::geometry)   AS end_lat,   ST_X(t.end_location::geometry)   AS end_lng,
  t.start_address, t.end_address, t.distance_m, t.duration_s, t.idle_duration_s,
  t.max_speed_kph, t.avg_speed_kph, t.positions_count, t.close_reason`

const iso = (v: unknown): string => new Date(v as string).toISOString()
const isoOrNull = (v: unknown): string | null => (v ? iso(v) : null)
const num = (v: unknown): number => Number(v ?? 0)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function point(lat: unknown, lng: unknown): GeoPoint | null {
  return lat === null || lat === undefined || lng === null || lng === undefined
    ? null
    : { latitude: Number(lat), longitude: Number(lng) }
}

function toSummary(r: Record<string, unknown>): TripSummary {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    vehicleId: String(r.vehicle_id),
    registration: (r.registration as string | null) ?? null,
    deviceId: (r.device_id as string | null) ?? null,
    status: r.status as TripStatus,
    startedAt: iso(r.started_at),
    endedAt: isoOrNull(r.ended_at),
    lastPointAt: iso(r.last_point_at),
    startLocation: point(r.start_lat, r.start_lng),
    endLocation: point(r.end_lat, r.end_lng),
    startAddress: (r.start_address as string | null) ?? null,
    endAddress: (r.end_address as string | null) ?? null,
    distanceMeters: num(r.distance_m),
    durationSeconds: numOrNull(r.duration_s),
    idleSeconds: num(r.idle_duration_s),
    maxSpeedKph: numOrNull(r.max_speed_kph),
    avgSpeedKph: numOrNull(r.avg_speed_kph),
    positionsCount: num(r.positions_count),
    closeReason: (r.close_reason as TripCloseReason | null) ?? null,
  }
}

/**
 * =========================================================================
 *  LECTURE DES TRAJETS — requêtes SQL
 * =========================================================================
 *
 * Liste : trajets qui CHEVAUCHENT la période (un trajet commencé la veille
 * et encore en cours ressort), les plus récents d'abord, total en une passe
 * (`count(*) OVER ()`).
 *
 * Points : lus dans `positions` par véhicule ET boîtier du trajet, sur sa
 * fenêtre temporelle, points valides seulement. Le filtre sur `recorded_at`
 * limite la lecture aux partitions mensuelles concernées ; l'index unique
 * (device_id, recorded_at) rend le curseur exact.
 */
export class LucidTripReader implements TripReader {
  async list(q: TripListQuery): Promise<TripListPage> {
    const conditions = [
      't.started_at <= :to',
      'COALESCE(t.ended_at, t.last_point_at, t.started_at) >= :from',
    ]
    const params: Record<string, unknown> = {
      from: q.from.toISOString(),
      to: q.to.toISOString(),
      limit: q.perPage,
      offset: (q.page - 1) * q.perPage,
    }
    if (q.scope.organizationId) {
      conditions.push('t.organization_id = :org')
      params.org = q.scope.organizationId
    }
    if (q.vehicleId) {
      conditions.push('t.vehicle_id = :vehicle')
      params.vehicle = q.vehicleId
    }
    if (q.status) {
      conditions.push('t.status = :status')
      params.status = q.status
    }

    const r = await db.rawQuery(
      `SELECT ${COLONNES}, count(*) OVER () AS total
         FROM trips t
         JOIN vehicles v ON v.id = t.vehicle_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.started_at DESC, t.id
        LIMIT :limit OFFSET :offset`,
      params
    )
    const lignes = (r.rows ?? []) as Record<string, unknown>[]
    return {
      data: lignes.map(toSummary),
      meta: { total: num(lignes[0]?.total), page: q.page, perPage: q.perPage },
    }
  }

  async find(tripId: string): Promise<TripSummary | null> {
    const r = await db.rawQuery(
      `SELECT ${COLONNES} FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = :id`,
      { id: tripId }
    )
    const ligne = (r.rows ?? [])[0] as Record<string, unknown> | undefined
    return ligne ? toSummary(ligne) : null
  }

  async points(q: TripPointsQuery): Promise<TripPoint[]> {
    const conditions = ['vehicle_id = :vehicle', 'is_valid', 'recorded_at >= :from']
    const params: Record<string, unknown> = {
      vehicle: q.vehicleId,
      from: q.from.toISOString(),
      limit: q.limit,
    }
    if (q.deviceId) {
      conditions.push('device_id = :device')
      params.device = q.deviceId
    }
    if (q.to) {
      conditions.push('recorded_at <= :to')
      params.to = q.to.toISOString()
    }
    if (q.after) {
      conditions.push('recorded_at > :after')
      params.after = q.after.toISOString()
    }

    const r = await db.rawQuery(
      `SELECT recorded_at,
              ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              speed_kph, heading_deg, ignition
         FROM positions
        WHERE ${conditions.join(' AND ')}
        ORDER BY recorded_at, id
        LIMIT :limit`,
      params
    )
    return ((r.rows ?? []) as Record<string, unknown>[]).map((p) => ({
      recordedAt: iso(p.recorded_at),
      latitude: Number(p.lat),
      longitude: Number(p.lng),
      speedKph: numOrNull(p.speed_kph),
      headingDeg: numOrNull(p.heading_deg),
      ignition: (p.ignition as boolean | null) ?? null,
    }))
  }

  async vehiclesInScope(scope: TripReadScope, vehicleIds: readonly string[]): Promise<string[]> {
    if (vehicleIds.length === 0) return []
    const q = db
      .from('vehicles')
      .whereIn('id', [...vehicleIds])
      .whereNull('deleted_at')
      .select('id')
    if (scope.organizationId) q.where('organization_id', scope.organizationId)
    const lignes = await q
    return lignes.map((r) => String(r.id))
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    const ligne = await db
      .from('organizations')
      .where('id', organizationId)
      .whereNull('deleted_at')
      .select('id')
      .first()
    return Boolean(ligne)
  }
}
