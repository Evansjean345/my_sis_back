import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import OfferModel from '#infrastructure/persistence/models/offer_model'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { activationProblem } from '#domain/billing/offer_policy'
import {
  type Feature,
  keysByOffer,
  loadCatalogue,
  pathsOf,
  resolveKeys,
  restrictCatalogue,
} from '#infrastructure/persistence/feature_catalogue'
import {
  createOfferWithSubFeatures,
  updateOfferWithSubFeatures,
} from '#infrastructure/persistence/repositories/offer_repository'
import {
  type OfferSubscriptionStats,
  statsByOffer,
} from '#infrastructure/persistence/subscription_reads'
import {
  createOfferValidator,
  listOffersValidator,
  updateOfferValidator,
} from '#presentation/http/validators/billing/offer_validators'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { authorizePlatform } from '#presentation/http/support/platform_scope'

/** Champs tracés avant / après dans le journal d'audit. */
const AUDITED = [
  'code',
  'name',
  'description',
  'price',
  'currency',
  'periodicity',
  'status',
  'launchedOn',
  'maxVehicles',
  'gpsHistoryDays',
] as const

/**
 * =========================================================================
 *  OFFRES COMMERCIALES — routes `/api/v1/admin/offers/*` (plateforme)
 * =========================================================================
 *
 * Réservées à l'exploitant (joker `*`).
 *
 * Fonctionnalités : catalogue en base (migration 026). Une offre est exposée
 * avec `featureKeys` (clés des sous-fonctionnalités incluses) et `features`,
 * les mêmes rangées sous leur fonctionnalité :
 *   features: [{ id, name, subFeatures: [{ id, key, label, path }] }]
 *
 * Organisations : par les SOUSCRIPTIONS (migration 027). `stats` donne le
 * nombre de souscriptions et de véhicules couverts ; une offre souscrite ne
 * se supprime pas (409 `E_OFFER_IN_USE`) : on la retire du catalogue.
 */
@inject()
export default class OfferController {
  constructor(private readonly audit: LucidAuditLogger) {}

  /** GET /admin/offers/features — catalogue : fonctionnalités et sous-fonctionnalités. */
  async features(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return ctx.response.ok({ data: await loadCatalogue() })
  }

  /** GET /admin/offers ?search=&status=&periodicity=&organizationId=&page=&perPage= */
  async index(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const f = await ctx.request.validateUsing(listOffersValidator)

    const query = OfferModel.query().whereNull('deleted_at').orderBy('name')
    if (f.status) query.where('status', f.status)
    if (f.periodicity) query.where('periodicity', f.periodicity)
    if (f.organizationId) {
      query.whereExists((q) =>
        q
          .from('subscriptions')
          .whereColumn('subscriptions.offer_id', 'offers.id')
          .where('subscriptions.organization_id', f.organizationId!)
          .whereNull('subscriptions.deleted_at')
          .whereNot('subscriptions.status', 'terminated')
      )
    }
    if (f.search) {
      const motif = `%${f.search}%`
      query.where((q) => q.whereILike('name', motif).orWhereILike('code', motif))
    }

    const page = await query.paginate(f.page ?? 1, Math.min(f.perPage ?? 25, 100))
    const lignes = page.all()
    const ids = lignes.map((o) => o.id)
    const [catalogue, cles, stats] = await Promise.all([
      loadCatalogue(),
      keysByOffer(ids),
      statsByOffer(ids),
    ])
    return ctx.response.ok({
      meta: page.getMeta(),
      data: lignes.map((o) => this.exposer(o, catalogue, cles.get(o.id) ?? [], stats.get(o.id)!)),
    })
  }

  /** GET /admin/offers/:id */
  async show(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const offre = await this.trouver(ctx.params.id)
    if (!offre) return this.introuvable(ctx)
    return ctx.response.ok({ data: await this.detailler(offre) })
  }

  /** POST /admin/offers */
  async store(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { launchedOn, featureKeys, ...champs } =
      await ctx.request.validateUsing(createOfferValidator)

    const statut = champs.status ?? 'inactive'
    const probleme = activationProblem({ status: statut, launchedOn: launchedOn ?? null })
    if (probleme) return this.regleMetier(ctx, 'E_OFFER_LAUNCH_DATE_REQUIRED', probleme)
    if (await this.codePris(champs.code)) return this.codeDejaPris(ctx, champs.code)
    const { ids, unknown } = await resolveKeys(featureKeys ?? [])
    if (unknown.length) return this.clesInconnues(ctx, unknown)

    const offre = await createOfferWithSubFeatures(
      {
        ...champs,
        description: champs.description ?? null,
        price: String(champs.price),
        status: statut,
        launchedOn: launchedOn ? DateTime.fromISO(launchedOn) : null,
        maxVehicles: champs.maxVehicles ?? null,
      },
      ids
    )
    await offre.refresh()

    const detail = await this.detailler(offre)
    await this.tracer(ctx, offre, 'created', {
      after: { ...this.resume(offre), featureKeys: detail.featureKeys },
    })
    return ctx.response.created({ data: detail })
  }

  /** PATCH /admin/offers/:id — toute offre est modifiable, prédéfinie ou non. */
  async update(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { launchedOn, featureKeys, price, ...champs } =
      await ctx.request.validateUsing(updateOfferValidator)
    const offre = await this.trouver(ctx.params.id)
    if (!offre) return this.introuvable(ctx)

    const statut = champs.status ?? offre.status
    const date = launchedOn !== undefined ? launchedOn : (offre.launchedOn?.toISODate() ?? null)
    const probleme = activationProblem({
      status: statut as 'active' | 'inactive',
      launchedOn: date,
    })
    if (probleme) return this.regleMetier(ctx, 'E_OFFER_LAUNCH_DATE_REQUIRED', probleme)
    if (champs.code && champs.code !== offre.code && (await this.codePris(champs.code, offre.id))) {
      return this.codeDejaPris(ctx, champs.code)
    }
    const resolution = featureKeys ? await resolveKeys(featureKeys) : null
    if (resolution?.unknown.length) return this.clesInconnues(ctx, resolution.unknown)

    const parOffre = await keysByOffer([offre.id])
    const clesAvant = parOffre.get(offre.id) ?? []
    const avant = { ...this.resume(offre), featureKeys: clesAvant }
    await updateOfferWithSubFeatures(
      offre,
      (o) => {
        o.merge(champs)
        if (price !== undefined) o.price = String(price)
        if (launchedOn !== undefined) {
          o.launchedOn = launchedOn ? DateTime.fromISO(launchedOn) : null
        }
      },
      resolution ? resolution.ids : null
    )
    await offre.refresh()

    const detail = await this.detailler(offre)
    await this.tracer(ctx, offre, 'updated', {
      before: avant,
      after: { ...this.resume(offre), featureKeys: detail.featureKeys },
    })
    return ctx.response.ok({ data: detail })
  }

  /** DELETE /admin/offers/:id — refusé si l'offre a des souscriptions non résiliées. */
  async destroy(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const offre = await this.trouver(ctx.params.id)
    if (!offre) return this.introuvable(ctx)

    const parOffre = await statsByOffer([offre.id])
    const stats = parOffre.get(offre.id)!
    if (stats.subscriptions > 0) {
      return ctx.response.conflict({
        error: {
          code: 'E_OFFER_IN_USE',
          message: `${stats.subscriptions} souscription(s) utilisent cette offre : retirez-la du catalogue (statut inactif) plutôt que de la supprimer`,
          details: { subscriptions: stats.subscriptions },
        },
      })
    }

    const avant = this.resume(offre)
    offre.deletedAt = DateTime.now()
    await offre.save()
    await this.tracer(ctx, offre, 'deleted', { before: avant })
    return ctx.response.noContent()
  }

  // -------------------------------------------------------------------------

  private trouver(id: string): Promise<OfferModel | null> {
    return OfferModel.query().where('id', id).whereNull('deleted_at').first()
  }

  private exposer(
    o: OfferModel,
    catalogue: Feature[],
    cles: string[],
    stats: OfferSubscriptionStats
  ) {
    const { organizations, ...chiffres } = stats
    return {
      ...o.serialize(),
      featureKeys: cles,
      features: restrictCatalogue(catalogue, cles),
      paths: pathsOf(catalogue, cles),
      stats: chiffres,
      organizations,
      organizationsCount: organizations.length,
    }
  }

  private async detailler(o: OfferModel) {
    const [catalogue, cles, stats] = await Promise.all([
      loadCatalogue(),
      keysByOffer([o.id]),
      statsByOffer([o.id]),
    ])
    return this.exposer(o, catalogue, cles.get(o.id) ?? [], stats.get(o.id)!)
  }

  private async codePris(code: string, exceptId?: string): Promise<boolean> {
    const query = OfferModel.query().where('code', code).whereNull('deleted_at').select('id')
    if (exceptId) query.whereNot('id', exceptId)
    return (await query.first()) !== null
  }

  private codeDejaPris(ctx: HttpContext, code: string) {
    return ctx.response.conflict({
      error: {
        code: 'E_OFFER_CODE_TAKEN',
        message: 'Ce code est déjà utilisé par une autre offre',
        details: { code },
      },
    })
  }

  private clesInconnues(ctx: HttpContext, keys: string[]) {
    return ctx.response.unprocessableEntity({
      error: {
        code: 'E_UNKNOWN_FEATURE',
        message: 'Sous-fonctionnalité absente du catalogue',
        details: { featureKeys: keys },
      },
    })
  }

  private regleMetier(ctx: HttpContext, code: string, message: string) {
    return ctx.response.unprocessableEntity({ error: { code, message, details: {} } })
  }

  private introuvable(ctx: HttpContext) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: 'Offre introuvable', details: {} },
    })
  }

  private resume(o: OfferModel): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const k of AUDITED) {
      const v = o[k]
      out[k] = v instanceof DateTime ? v.toISODate() : (v ?? null)
    }
    return out
  }

  private tracer(
    ctx: HttpContext,
    offre: OfferModel,
    action: string,
    details: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ) {
    return this.audit.record({
      context: toExecutionContext(ctx),
      action: `billing.offer.${action}`,
      resourceType: 'offer',
      resourceId: offre.id,
      ...details,
    })
  }
}
