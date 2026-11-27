import { Err, NotFoundError, Ok, type DomainError, type Result } from '#domain/kernel'
import type { AuditLogger, Clock, ExecutionContext, UseCase } from '#application/ports'
import type { IncidentRepository } from '#application/incident/ports'
import type { IncidentStatus } from '#domain/incident/code_legacy/incident/incident_statuses'
import type { IncidentView } from '#domain/incident/code_legacy/incident/incident_types'
import { checkTransition } from '#domain/incident/incident_policy'

export interface ChangeIncidentStatusInput {
  context: ExecutionContext
  /** `null` : toutes les organisations (exploitant). */
  scopeOrganizationId: string | null
  incidentId: string
  status: IncidentStatus
  resolution?: string | null
}

/**
 * CAS D'USAGE — Faire avancer un dossier : prise en charge, résolution,
 * réouverture, clôture. La machine à états est dans le domaine.
 */
export class ChangeIncidentStatus implements UseCase<ChangeIncidentStatusInput, IncidentView> {
  constructor(
    private readonly incidents: IncidentRepository,
    private readonly clock: Clock,
    private readonly audit: AuditLogger
  ) {}

  async execute(input: ChangeIncidentStatusInput): Promise<Result<IncidentView, DomainError>> {
    const actuel = await this.incidents.find(input.incidentId)
    if (
      !actuel ||
      (input.scopeOrganizationId !== null && actuel.organizationId !== input.scopeOrganizationId)
    ) {
      return Err(new NotFoundError('Incident', input.incidentId))
    }

    const verifie = checkTransition({
      from: actuel.status,
      to: input.status,
      resolution: input.resolution ?? null,
      currentResolution: actuel.resolution,
    })
    if (!verifie.ok) return verifie

    const apres = await this.incidents.changeStatus(actuel.id, {
      status: input.status,
      resolution: verifie.value.resolution,
      actorId: input.context.actorId,
      at: this.clock.now(),
    })
    await this.audit
      .record({
        context: { ...input.context, organizationId: actuel.organizationId },
        action: `incident.${input.status}`,
        resourceType: 'incident',
        resourceId: actuel.id,
        before: { status: actuel.status, resolution: actuel.resolution },
        after: { status: apres.status, resolution: apres.resolution },
        metadata: { reference: actuel.reference },
      })
      .catch(() => undefined)
    return Ok(apres)
  }
}
