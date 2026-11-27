import { Err, NotFoundError, Ok, type DomainError, type Result } from '#domain/kernel'
import type { AuditLogger, Clock, ExecutionContext, UseCase } from '#application/ports'
import type { IncidentRepository } from '#application/incident/ports'
import type {
  IncidentDraft,
  IncidentView,
} from '#domain/incident/code_legacy/incident/incident_types'
import { IncidentVehicleOutOfScopeError } from '#domain/incident/errors'

export interface OpenIncidentInput {
  context: ExecutionContext
  draft: IncidentDraft
}

/**
 * CAS D'USAGE — Ouvrir un dossier d'incident.
 *
 * Le véhicule éventuel doit appartenir à l'organisation du dossier : un
 * incident ne peut pas désigner le véhicule d'un autre client.
 */
export class OpenIncident implements UseCase<OpenIncidentInput, IncidentView> {
  constructor(
    private readonly incidents: IncidentRepository,
    private readonly clock: Clock,
    private readonly audit: AuditLogger
  ) {}

  async execute(input: OpenIncidentInput): Promise<Result<IncidentView, DomainError>> {
    const { draft } = input
    if (!(await this.incidents.organizationExists(draft.organizationId))) {
      return Err(new NotFoundError('Organisation', draft.organizationId))
    }
    if (
      draft.vehicleId &&
      !(await this.incidents.vehicleBelongsTo(draft.vehicleId, draft.organizationId))
    ) {
      return Err(new IncidentVehicleOutOfScopeError(draft.vehicleId))
    }

    const incident = await this.incidents.create(draft, input.context.actorId, this.clock.now())
    await this.audit
      .record({
        context: { ...input.context, organizationId: draft.organizationId },
        action: 'incident.opened',
        resourceType: 'incident',
        resourceId: incident.id,
        after: {
          reference: incident.reference,
          title: incident.title,
          category: incident.category,
          severity: incident.severity,
          vehicleId: draft.vehicleId,
        },
      })
      .catch(() => undefined)
    return Ok(incident)
  }
}
