import { Err, NotFoundError, Ok, type DomainError, type Result } from '#domain/kernel'
import type { UseCase } from '#application/ports'
import type { TripReader } from '#application/telemetry/ports'
import type {
  TripReadScope,
  TripSummary,
} from '#domain/telemetry/code_legacy/trip/trip_reading_types'
import { canReadOrganization } from '#domain/telemetry/trip_reading_policy'

export interface GetTripInput {
  scope: TripReadScope
  tripId: string
}

/**
 * CAS D'USAGE — Lire un trajet.
 *
 * Le trajet d'un autre client répond « introuvable », comme un identifiant
 * inconnu : son existence même n'est pas révélée.
 */
export class GetTrip implements UseCase<GetTripInput, TripSummary> {
  constructor(private readonly reader: TripReader) {}

  async execute(input: GetTripInput): Promise<Result<TripSummary, DomainError>> {
    const trajet = await this.reader.find(input.tripId)
    if (!trajet || !canReadOrganization(input.scope, trajet.organizationId)) {
      return Err(new NotFoundError('Trajet', input.tripId))
    }
    return Ok(trajet)
  }
}
