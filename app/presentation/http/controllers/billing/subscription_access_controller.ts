import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { grantsAccess } from '#domain/billing/subscription_policy'
import {
  keysByOffer,
  loadCatalogue,
  pathsOf,
  restrictCatalogue,
} from '#infrastructure/persistence/feature_catalogue'
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

  private async souscriptions(organizationId: string) {
    const lignes: {
      id: string
      reference: string
      status: string
      start_date: string
      end_date: string | null
      offer_id: string
      offer_code: string
      offer_name: string
      group_id: string
      group_name: string
    }[] = await db
      .from('subscriptions as s')
      .join('offers as o', 'o.id', 's.offer_id')
      .join('vehicle_groups as g', 'g.id', 's.vehicle_group_id')
      .where('s.organization_id', organizationId)
      .whereNull('s.deleted_at')
      .orderBy('s.created_at', 'desc')
      .select(
        's.id',
        's.reference',
        's.status',
        db.raw(`to_char(s.start_date, 'YYYY-MM-DD') as start_date`),
        db.raw(`to_char(s.end_date, 'YYYY-MM-DD') as end_date`),
        'o.id as offer_id',
        'o.code as offer_code',
        'o.name as offer_name',
        'g.id as group_id',
        'g.name as group_name'
      )
    return lignes.map((l) => ({
      id: l.id,
      reference: l.reference,
      status: l.status,
      startDate: l.start_date,
      endDate: l.end_date,
      offer: { id: l.offer_id, code: l.offer_code, name: l.offer_name },
      vehicleGroup: { id: l.group_id, name: l.group_name },
    }))
  }
}
