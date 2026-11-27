import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { LucidClientSpaceReader } from '#infrastructure/persistence/readers/client_space_reader'
import { authorizePlatform } from '#presentation/http/support/platform_scope'
import { notFoundInScope } from '#presentation/http/support/tenant_resources'

/**
 * Espace client du SuperAdmin : tout ce qui concerne UNE organisation
 * (horaires, zones, vitesse, règles, conducteurs, rapports, incidents).
 * Ce contrôleur ne sert que le résumé ; chaque rubrique garde ses routes
 * `*All`, filtrées par `organizationId`.
 */
@inject()
export default class ClientSpaceController {
  constructor(private readonly reader: LucidClientSpaceReader) {}

  /** GET /api/v1/admin/organizations/:id/space — identité + compteurs des rubriques. */
  async showAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const data = await this.reader.summary(ctx.params.id)
    if (!data) return notFoundInScope(ctx, 'Organisation')
    return ctx.response.ok({ data })
  }
}
