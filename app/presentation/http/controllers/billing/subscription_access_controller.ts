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
 *  ACCÈS PAR SOUSCRIPTION — `GET /api/v1/subscriptions/access` (tout compte)
 * =========================================================================
 *
 * Pages que le compte connecté peut ouvrir : union des sous-fonctionnalités
 * des offres souscrites ACTIVES de son organisation (une par flotte). Tous
 * les comptes de l'organisation — administrateur comme opérateur — ont le
 * même accès.
 *
 * Les tableaux de bord filtrent leur menu avec `paths` ; une page absente de
 * `catalogPaths` (trackers, utilisateurs…) n'est pas soumise aux offres.
 */
export default class SubscriptionAccessController {
  async access(ctx: HttpContext) {
    const { organizationId } = toExecutionContext(ctx)
    const [catalogue, souscriptions] = await Promise.all([
      loadCatalogue(),
      subscriptionsOfOrganization(organizationId),
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
}
