import db from '@adonisjs/lucid/services/db'

/**
 * =========================================================================
 *  ÉTAT TEMPS RÉEL DES VÉHICULES — accès SQL de VehicleController
 * =========================================================================
 *
 * Boîtier monté + dernière position connue (`vehicle_last_positions`, une
 * ligne par véhicule : jamais de scan de la table partitionnée `positions`).
 *
 * Une seule projection pour la carte (lot de véhicules) et pour la fiche
 * d'un véhicule : les deux écrans affichent exactement les mêmes champs.
 */

export interface VehicleLiveDetail {
  device: { id: string; imei: string; model: string | null; hasRelay: boolean } | null
  lastPosition: {
    latitude: number
    longitude: number
    speedKph: number | null
    ignition: boolean | null
    recordedAt: Date
    connectionState: string | null
  } | null
}

export class LucidVehicleLiveReader {
  /**
   * Boîtier monté et dernière position d'un lot de véhicules — UNE requête.
   * Query builder plutôt que `rawQuery` : knex développe un tableau lié en
   * liste `IN (?, ?, …)`, ce que `= ANY(:ids)` ne supporte pas.
   */
  async detailsByVehicle(ids: string[]): Promise<Record<string, VehicleLiveDetail>> {
    if (ids.length === 0) return {}

    const lignes = await db
      .from('vehicles as v')
      .joinRaw('LEFT JOIN device_assignments da ON da.vehicle_id = v.id AND upper_inf(da.period)')
      .leftJoin('devices as d', 'd.id', 'da.device_id')
      .leftJoin('vehicle_last_positions as p', 'p.vehicle_id', 'v.id')
      .whereIn('v.id', ids)
      .select(
        'v.id as vehicle_id',
        'd.id as device_id',
        'd.imei',
        'd.model',
        'd.has_relay',
        'p.speed_kph',
        'p.ignition',
        'p.recorded_at',
        'p.connection_state',
        db.raw('ST_Y(p.location::geometry) AS latitude'),
        db.raw('ST_X(p.location::geometry) AS longitude')
      )

    const parVehicule: Record<string, VehicleLiveDetail> = {}
    for (const l of lignes as Array<Record<string, any>>) {
      parVehicule[l.vehicle_id] = {
        device: l.device_id
          ? { id: l.device_id, imei: l.imei, model: l.model, hasRelay: l.has_relay }
          : null,
        lastPosition: l.recorded_at
          ? {
              latitude: l.latitude,
              longitude: l.longitude,
              speedKph: l.speed_kph,
              ignition: l.ignition,
              recordedAt: l.recorded_at,
              connectionState: l.connection_state,
            }
          : null,
      }
    }
    return parVehicule
  }

  /** Même projection pour un seul véhicule (fiche détail). */
  async detail(vehicleId: string): Promise<VehicleLiveDetail> {
    const details = await this.detailsByVehicle([vehicleId])
    return details[vehicleId] ?? { device: null, lastPosition: null }
  }

  /**
   * Véhicules non archivés par état de connexion (`online`, `offline`,
   * `stale`, `never_seen`). `organizationId: null` = toute la plateforme.
   */
  async countByConnection(organizationId: string | null): Promise<Record<string, number>> {
    const query = db
      .from('vehicles')
      .joinRaw('LEFT JOIN vehicle_last_positions p ON p.vehicle_id = vehicles.id')
      .whereNull('vehicles.deleted_at')
    if (organizationId !== null) query.where('vehicles.organization_id', organizationId)

    const lignes = await query
      .select(db.raw(`COALESCE(p.connection_state, 'never_seen') AS state`))
      .count('* as total')
      .groupByRaw(`COALESCE(p.connection_state, 'never_seen')`)

    const out: Record<string, number> = {}
    for (const l of lignes as Array<{ state: string; total: string | number }>) {
      out[l.state] = Number(l.total ?? 0)
    }
    return out
  }
}
