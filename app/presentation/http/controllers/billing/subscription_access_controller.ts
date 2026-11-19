import type { HttpContext } from '@adonisjs/core/http'
import { grantsAccess } from '#domain/billing/subscription_policy'
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
 *  ACCÈS PAR SOUSCRIPTION — routes `/api/v1/subscriptions/*` (organisation)
 * =========================================================================
 *
 * Ce que l'organisation du compte connecté a le droit d'ouvrir, d'après ses
 * souscriptions ACTIVES : union des sous-fonctionnalités de leurs offres.
 * Le tableau de bord du distributeur s'en sert pour filtrer son menu :
 *
 *   - `catalogPaths` : toutes les pages soumises à une offre (le catalogue) ;
 *   - `paths`        : celles que les souscriptions actives ouvrent.
 *
 * Une page absente de `catalogPaths` (véhicules, utilisateurs…) n'est pas
 * concernée par les offres et reste toujours visible.
 */
export default class SubscriptionAccessController {
  /** GET /subscriptions/access */
  async access(ctx: HttpContext) {
    const organizationId = toExecutionContext(ctx).organizationId
    const [catalogue, souscriptions] = await Promise.all([
      loadCatalogue(),
      this.souscriptions(organizationId),
    ])

    const actives = souscriptions.filter((s) => grantsAccess(s.status))
    const parOffre = await keysByOffer([...new Set(actives.map((s) => s.offer.id))])
    const cles = new Set(actives.flatMap((s) => parOffre.get(s.offer.id) ?? []))
    const ordonnees = catalogue
      .flatMap((f) => f.subFeatures.map((s) => s.key))
      .filter((k) => cles.has(k))

    return ctx.response.ok({
      data: {
        featureKeys: ordonnees,
        features: restrictCatalogue(catalogue, ordonnees),
        paths: pathsOf(catalogue, ordonnees),
        catalogPaths: pathsOf(catalogue),
        subscriptions: souscriptions,
      },
    })
  }

  /** GET /subscriptions — souscriptions de l'organisation (non supprimées). */
  async index(ctx: HttpContext) {
    const organizationId = toExecutionContext(ctx).organizationId
    return ctx.response.ok({ data: await this.souscriptions(organizationId) })
  }

  private souscriptions(organizationId: string) {
    return subscriptionsOfOrganization(organizationId)
  }
}
