import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { BuildTripReport } from '#application/telemetry/use_cases/build_trip_report'
import { tripReportValidator } from '#presentation/http/validators/telemetry/trip_report_validators'
import { authorizePlatform } from '#presentation/http/support/platform_scope'

/** Rapports d'activité — tableau de bord de l'exploitant (espace client). */
@inject()
export default class TripReportController {
  constructor(private readonly report: BuildTripReport) {}

  /** GET /admin/reports/trips ?organizationId=&from=AAAA-MM-JJ&to=AAAA-MM-JJ (bornes incluses) */
  async tripsAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const f = await ctx.request.validateUsing(tripReportValidator)
    const r = await this.report.execute({
      organizationId: f.organizationId,
      from: new Date(`${f.from}T00:00:00.000Z`),
      to: new Date(`${f.to}T23:59:59.999Z`),
    })
    if (!r.ok) return ctx.response.status(r.error.httpStatus).send({ error: r.error.toJSON() })
    return ctx.response.ok({ data: r.value })
  }
}
