import type { HttpContext } from '@adonisjs/core/http'
import { accessScope, grantsAccess } from '#domain/billing/subscription_policy'
import {
  keysByOffer,
  loadCatalogue,
  pathsOf,
  restrictCatalogue,
} from '#infrastructure/persistence/feature_catalogue'
import { subscriptionsOfOrganization } from '#infrastructure/persistence/subscription_reads'
import { toExecutionContext } from '#presentation/http/support/execution_context'

/**
 * =========================================================================
 *  ACCÈS PAR SOUSCRIPTION — `GET /api/v1/subscriptions/access` (tout compte)
 * =========================================================================
 *
 * Pages que le compte connecté peut ouvrir, selon les souscriptions ACTIVES
 * qui le concernent (`accessScope`) :
 *
 *   - un opérateur qui a sa PROPRE souscription non résiliée → ses
 *     souscriptions actives seules (`scope: 'operator'`) ; suspendue, elle
 *     ne donne plus rien : jamais de repli sur l'offre du distributeur ;
 *   - tout autre compte (distributeur, opérateur sans souscription propre)
 *     → souscriptions de FLOTTE actives de l'organisation
 *     (`scope: 'organization'`).
 *
 * Les tableaux de bord filtrent leur menu avec `paths` ; une page absente de
 * `catalogPaths` (trackers, utilisateurs…) n'est pas soumise aux offres.
 */
export default class SubscriptionAccessController {
  async access(ctx: HttpContext) {
    const { organizationId, actorId } = toExecutionContext(ctx)
    const [catalogue, propres] = await Promise.all([
      loadCatalogue(),
      actorId ? subscriptionsOfOrganization(organizationId, actorId) : Promise.resolve([]),
    ])
    const vivantes = propres.filter((s) => s.status !== 'terminated')
    const scope = accessScope(vivantes.length)
    const souscriptions =
      scope === 'operator' ? propres : await subscriptionsOfOrganization(organizationId, null)

    const actives = souscriptions.filter((s) => grantsAccess(s.status))
    const parOffre = await keysByOffer([...new Set(actives.map((s) => s.offer.id))])
    const cles = new Set(actives.flatMap((s) => parOffre.get(s.offer.id) ?? []))
    const ordonnees = catalogue
      .flatMap((f) => f.subFeatures.map((s) => s.key))
      .filter((k) => cles.has(k))

    return ctx.response.ok({
      data: {
        scope,
        featureKeys: ordonnees,
        features: restrictCatalogue(catalogue, ordonnees),
        paths: pathsOf(catalogue, ordonnees),
        catalogPaths: pathsOf(catalogue),
        subscriptions: souscriptions,
      },
    })
  }
}
