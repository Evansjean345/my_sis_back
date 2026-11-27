import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { DomainError } from '#domain/kernel'
import { ListIncidents } from '#application/incident/use_cases/list_incidents'
import { OpenIncident } from '#application/incident/use_cases/open_incident'
import { ChangeIncidentStatus } from '#application/incident/use_cases/change_incident_status'
import { LucidIncidentRepository } from '#infrastructure/persistence/repositories/incident_repository'
import {
  changeIncidentStatusValidator,
  listIncidentsValidator,
  openIncidentValidator,
} from '#presentation/http/validators/incident/incident_validators'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { authorizePlatform } from '#presentation/http/support/platform_scope'
import { notFoundInScope } from '#presentation/http/support/tenant_resources'

/**
 * =========================================================================
 *  INCIDENTS — tableau de bord de l'exploitant (routes `/admin/incidents`)
 * =========================================================================
 *
 * Dossiers de toutes les organisations ; l'espace client filtre sur la
 * sienne (`organizationId`). Les règles vivent dans le domaine et les cas
 * d'usage : ce contrôleur valide la forme et répond.
 */
@inject()
export default class IncidentController {
  constructor(
    private readonly listIncidents: ListIncidents,
    private readonly openIncident: OpenIncident,
    private readonly changeStatus: ChangeIncidentStatus,
    private readonly incidents: LucidIncidentRepository
  ) {}

  /** GET /admin/incidents ?organizationId=&status=&severity=&category=&search=&page=&perPage= */
  async indexAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const f = await ctx.request.validateUsing(listIncidentsValidator)
    const r = await this.listIncidents.execute({ ...f, organizationId: f.organizationId ?? null })
    if (!r.ok) return this.echec(ctx, r.error)
    return ctx.response.ok(r.value)
  }

  /** GET /admin/incidents/:id */
  async showAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const incident = await this.incidents.find(ctx.params.id)
    if (!incident) return notFoundInScope(ctx, 'Incident')
    return ctx.response.ok({ data: incident })
  }

  /** POST /admin/incidents — { organizationId, title, category, severity, vehicleId?, description?, occurredAt? } */
  async storeAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const p = await ctx.request.validateUsing(openIncidentValidator)
    const r = await this.openIncident.execute({
      context: toExecutionContext(ctx),
      draft: {
        organizationId: p.organizationId,
        vehicleId: p.vehicleId ?? null,
        category: p.category,
        severity: p.severity,
        title: p.title,
        description: p.description ?? null,
        occurredAt: p.occurredAt ?? new Date(),
      },
    })
    if (!r.ok) return this.echec(ctx, r.error)
    return ctx.response.created({ data: r.value })
  }

  /** PATCH /admin/incidents/:id/status — { status, resolution? } */
  async statusAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const p = await ctx.request.validateUsing(changeIncidentStatusValidator)
    const r = await this.changeStatus.execute({
      context: toExecutionContext(ctx),
      scopeOrganizationId: null,
      incidentId: ctx.params.id,
      status: p.status,
      resolution: p.resolution,
    })
    if (!r.ok) return this.echec(ctx, r.error)
    return ctx.response.ok({ data: r.value })
  }

  private echec(ctx: HttpContext, error: DomainError) {
    return ctx.response.status(error.httpStatus).send({ error: error.toJSON() })
  }
}
