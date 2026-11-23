import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import SubscriptionModel from '#infrastructure/persistence/models/subscription_model'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { subscribableOffers } from '#infrastructure/persistence/subscription_reads'
import {
  createClientSubscriptionValidator,
  listClientSubscriptionsValidator,
  subscriptionStatusValidator,
  updateSubscriptionValidator,
} from '#presentation/http/validators/billing/subscription_validators'
import { authorize } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { SubscriptionBase } from '#presentation/http/controllers/billing/subscription_base'

/**
 * =========================================================================
 *  MES SOUSCRIPTIONS — routes `/api/v1/subscriptions/*` (client final)
 * =========================================================================
 *
 * L'administrateur d'une organisation (rôle `admin`, habilitation
 * `subscription:*`) est le client final : il souscrit lui-même une offre
 * commercialisée pour une de SES flottes, comme le fait SISBM depuis le
 * Super Admin. L'opérateur reste en retrait (aucune souscription propre).
 *
 * Toutes les lectures et écritures sont cloisonnées à l'organisation du
 * compte connecté. Règles communes : `subscription_base.ts`.
 */
@inject()
export default class ClientSubscriptionController extends SubscriptionBase {
  constructor(audit: LucidAuditLogger) {
    super(audit)
  }

  /** GET /subscriptions/offers — offres que je peux souscrire (commercialisées). */
  async offers(ctx: HttpContext) {
    await authorize(ctx, 'viewSubscriptions')
    return ctx.response.ok({ data: await subscribableOffers() })
  }

  /** GET /subscriptions ?search=&vehicleGroupId=&offerId=&status=&page=&perPage= */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'viewSubscriptions')
    const f = await ctx.request.validateUsing(listClientSubscriptionsValidator)

    const query = this.portee(ctx).orderBy('subscriptions.created_at', 'desc')
    if (f.vehicleGroupId) query.where('subscriptions.vehicle_group_id', f.vehicleGroupId)
    if (f.offerId) query.where('subscriptions.offer_id', f.offerId)
    if (f.status) query.where('subscriptions.status', f.status)
    if (f.search) {
      const motif = `%${f.search}%`
      query.where((q) =>
        q
          .whereILike('subscriptions.reference', motif)
          .orWhereExists((sub) =>
            sub
              .from('vehicle_groups')
              .whereColumn('vehicle_groups.id', 'subscriptions.vehicle_group_id')
              .whereILike('vehicle_groups.name', motif)
          )
      )
    }

    const page = await query.paginate(f.page ?? 1, Math.min(f.perPage ?? 25, 100))
    const lignes = page.all()
    const joints = await this.joindre(lignes)
    return ctx.response.ok({
      meta: page.getMeta(),
      data: lignes.map((s) => this.exposer(s, joints)),
    })
  }

  /** GET /subscriptions/:id */
  async show(ctx: HttpContext) {
    await authorize(ctx, 'viewSubscriptions')
    const souscription = await this.trouver(ctx)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    return ctx.response.ok({ data: await this.detailler(souscription) })
  }

  /** POST /subscriptions — pour une de mes flottes. */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageSubscriptions')
    const champs = await ctx.request.validateUsing(createClientSubscriptionValidator)
    return this.creer(
      ctx,
      { ...champs, organizationId: this.organisation(ctx) },
      this.offreCommercialisee
    )
  }

  /** PATCH /subscriptions/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageSubscriptions')
    const champs = await ctx.request.validateUsing(updateSubscriptionValidator)
    const souscription = await this.trouver(ctx)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    return this.modifier(ctx, souscription, champs, this.offreCommercialisee)
  }

  /** POST /subscriptions/:id/status */
  async changeStatus(ctx: HttpContext) {
    await authorize(ctx, 'manageSubscriptions')
    const { status, reason } = await ctx.request.validateUsing(subscriptionStatusValidator)
    const souscription = await this.trouver(ctx)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    return this.changerStatut(ctx, souscription, status, reason)
  }

  /** DELETE /subscriptions/:id */
  async destroy(ctx: HttpContext) {
    await authorize(ctx, 'manageSubscriptions')
    const souscription = await this.trouver(ctx)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    return this.supprimer(ctx, souscription)
  }

  // -------------------------------------------------------------------------

  private organisation(ctx: HttpContext): string {
    return toExecutionContext(ctx).organizationId
  }

  /** Souscriptions de MON organisation. */
  private portee(ctx: HttpContext) {
    return SubscriptionModel.query()
      .where('subscriptions.organization_id', this.organisation(ctx))
      .whereNull('subscriptions.deleted_at')
  }

  private trouver(ctx: HttpContext): Promise<SubscriptionModel | null> {
    return this.portee(ctx).where('subscriptions.id', ctx.params.id).first()
  }
}
