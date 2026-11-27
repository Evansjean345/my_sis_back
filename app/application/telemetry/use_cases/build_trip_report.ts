import { Err, NotFoundError, Ok, type DomainError, type Result } from '#domain/kernel'
import type { UseCase } from '#application/ports'
import type { TripReader } from '#application/telemetry/ports'
import type { TripReport } from '#domain/telemetry/code_legacy/trip/trip_report_types'
import { tripReportRange, tripReportTotals } from '#domain/telemetry/trip_reading_policy'

export interface BuildTripReportInput {
  organizationId: string
  from: Date
  to: Date
}

/**
 * CAS D'USAGE — Rapport d'activité des véhicules d'une organisation :
 * trajets, kilomètres, temps de conduite et de ralenti, vitesse maximale.
 */
export class BuildTripReport implements UseCase<BuildTripReportInput, TripReport> {
  constructor(private readonly reader: TripReader) {}

  async execute(input: BuildTripReportInput): Promise<Result<TripReport, DomainError>> {
    const periode = tripReportRange(input.from, input.to)
    if (!periode.ok) return periode
    if (!(await this.reader.organizationExists(input.organizationId))) {
      return Err(new NotFoundError('Organisation', input.organizationId))
    }

    const vehicles = await this.reader.vehicleStats({
      organizationId: input.organizationId,
      from: periode.value.from,
      to: periode.value.to,
    })
    return Ok({
      organizationId: input.organizationId,
      from: periode.value.from.toISOString(),
      to: periode.value.to.toISOString(),
      totals: tripReportTotals(vehicles),
      vehicles,
    })
  }
}
