import type { TransactionScope } from '#domain/kernel'
import type { Trip } from '#domain/telemetry/entities/trip'
import type { TripId, VehicleId, DeviceId } from '#domain/telemetry/value_objects'
import type { NormalizedReading } from '#domain/telemetry/entities/telemetry_reading'

/**
 * Ports de persistance du contexte Télémétrie.
 *
 * Déclarés dans le DOMAINE, implémentés dans `infrastructure/`. Le domaine
 * dicte le contrat ; l'infrastructure s'y plie.
 */

//journal des trames brutes /utilité mqtt avec flespi
export interface IngestMessageRepository {
  /** Journal des trames brutes. Idempotent sur (source, external_id). */
  record(
    input: {
      source: string
      externalId: string
      deviceIdent: string | null
      deviceId: string | null
      payload: unknown
      receivedAt: Date
    },
    tx?: TransactionScope
  ): Promise<void>

  /**
   * Trames journalisées mais jamais traitées (`status = 'pending'`).
   *
   * C'est le filet de la durabilité : une trame acquittée auprès du broker
   * puis perdue par un incident (base indisponible, arrêt brutal) se retrouve
   * ici, et `sisbm:ingest --replay-pending` la rejoue. Sans cette lecture, la
   * ligne « pending » ne serait qu'une trace morte.
   */
  findPending(
    input: { limit: number; olderThan: Date },
    tx?: TransactionScope
  ): Promise<Array<{ externalId: string; deviceIdent: string | null; payload: unknown }>>

  markProcessed(externalId: string, receivedAt: Date, tx?: TransactionScope): Promise<void>
  markRejected(
    externalId: string,
    receivedAt: Date,
    error: string,
    tx?: TransactionScope
  ): Promise<void>
}

export interface PositionRepository {
  /**
   * Insertion PAR LOT, idempotente.
   * Retourne le nombre de lignes réellement insérées : les rejeux du
   * Store & Forward sont absorbés par ON CONFLICT DO NOTHING.
   */

  insertBatch(readings: NormalizedReading[], tx?: TransactionScope): Promise<number>

  /** Dernier point VALIDE — référence du contrôle de plausibilité. */
  findLastValidFix(
    deviceId: DeviceId
  ): Promise<{ latitude: number; longitude: number; recordedAt: Date } | null>

  /** Rattache les positions d'une fenêtre au trajet clôturé. */
  attachToTrip(
    vehicleId: VehicleId,
    tripId: TripId,
    from: Date,
    to: Date,
    tx?: TransactionScope
  ): Promise<number>
}
//inserer en temps réel dans véhicule dans last_positions
export interface VehicleLastPositionRepository {
  /** UPSERT de l'état courant. Sert 100 % du temps réel, jamais `positions`. */
  upsert(reading: NormalizedReading, tx?: TransactionScope): Promise<void>
}

export interface TripRepository {
  /** Trajet ouvert, sous verrou consultatif par véhicule. */
  findOpenByVehicle(vehicleId: VehicleId, tx?: TransactionScope): Promise<Trip | null>
  save(trip: Trip, tx?: TransactionScope): Promise<void>
  //etat végétatif le trajet est marqué orphelin(orphan)
  findStale(now: Date, maxDurationHours: number, limit: number): Promise<Trip[]>
}
