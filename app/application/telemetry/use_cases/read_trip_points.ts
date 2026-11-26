import { Ok, type DomainError, type Result } from '#domain/kernel'
import type { UseCase } from '#application/ports'
import type { TripReader } from '#application/telemetry/ports'
import type {
  TripPointsPage,
  TripReadScope,
} from '#domain/telemetry/code_legacy/trip/trip_reading_types'
import { tripPointsLimit } from '#domain/telemetry/trip_reading_policy'
import { GetTrip } from '#application/telemetry/use_cases/get_trip'

export interface ReadTripPointsInput {
  scope: TripReadScope
  tripId: string
  /** Curseur rendu par la page précédente (`nextCursor`) ; absent : depuis le départ. */
  after?: Date
  limit?: number
}

/**
 * CAS D'USAGE — Lire le tracé d'un trajet, page par page.
 *
 * Lecture par curseur plutôt qu'en un seul envoi : un long trajet se lit
 * sans saturer la connexion, et une lecture interrompue (réseau mobile)
 * reprend là où elle s'est arrêtée. Pour un trajet ouvert, la dernière page
 * rend `done` et le direct (`trip:progress`) prend le relais.
 */
export class ReadTripPoints implements UseCase<ReadTripPointsInput, TripPointsPage> {
  readonly #trajet: GetTrip

  constructor(private readonly reader: TripReader) {
    this.#trajet = new GetTrip(reader)
  }

  async execute(input: ReadTripPointsInput): Promise<Result<TripPointsPage, DomainError>> {
    const trajet = await this.#trajet.execute({ scope: input.scope, tripId: input.tripId })
    if (!trajet.ok) return trajet

    const t = trajet.value
    const limit = tripPointsLimit(input.limit)
    // Un point de plus que demandé : sa présence dit s'il reste une page.
    const lus = await this.reader.points({
      vehicleId: t.vehicleId,
      deviceId: t.deviceId,
      from: new Date(t.startedAt),
      to: t.status === 'open' ? null : new Date(t.endedAt ?? t.lastPointAt),
      after: input.after ?? null,
      limit: limit + 1,
    })

    const points = lus.slice(0, limit)
    const reste = lus.length > limit
    return Ok({
      tripId: t.id,
      points,
      nextCursor: points.at(-1)?.recordedAt ?? input.after?.toISOString() ?? null,
      done: !reste,
    })
  }
}
