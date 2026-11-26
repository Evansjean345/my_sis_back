import { Ok, type DomainError, type Result } from '#domain/kernel'
import type { UseCase } from '#application/ports'
import type { TripReader } from '#application/telemetry/ports'
import type {
  TripListPage,
  TripReadScope,
} from '#domain/telemetry/code_legacy/trip/trip_reading_types'
import type { TripStatus } from '#domain/telemetry/value_objects'
import { tripRange, tripsPerPage } from '#domain/telemetry/trip_reading_policy'

export interface ListTripsInput {
  scope: TripReadScope
  from: Date
  to: Date
  vehicleId?: string
  status?: TripStatus
  page?: number
  perPage?: number
}

/**
 * CAS D'USAGE — Lister les trajets d'une période, les plus récents d'abord.
 *
 * Le périmètre est appliqué par le lecteur (organisation de l'acteur, ou
 * toutes pour l'exploitant) : un véhicule d'un autre client ne ressort pas,
 * même si son identifiant est passé en filtre.
 */
export class ListTrips implements UseCase<ListTripsInput, TripListPage> {
  constructor(private readonly reader: TripReader) {}

  async execute(input: ListTripsInput): Promise<Result<TripListPage, DomainError>> {
    const periode = tripRange(input.from, input.to)
    if (!periode.ok) return periode

    return Ok(
      await this.reader.list({
        scope: input.scope,
        from: periode.value.from,
        to: periode.value.to,
        vehicleId: input.vehicleId,
        status: input.status,
        page: Math.max(1, Math.trunc(input.page ?? 1)),
        perPage: tripsPerPage(input.perPage),
      })
    )
  }
}
