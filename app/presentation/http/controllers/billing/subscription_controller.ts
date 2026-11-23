import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import SubscriptionModel from '#infrastructure/persistence/models/subscription_model'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { organizationExists } from '#infrastructure/persistence/subscription_reads'
import {
  createSubscriptionValidator,
  listSubscriptionsValidator,
  subscriptionStatusValidator,
  updateSubscriptionValidator,
} from '#presentation/http/validators/billing/subscription_validators'
import { authorizePlatform } from '#presentation/http/support/platform_scope'
import { SubscriptionBase } from '#presentation/http/controllers/billing/subscription_base'

/**
 * =========================================================================
 *  SOUSCRIPTIONS — routes `/api/v1/admin/subscriptions/*` (plateforme)
 * =========================================================================
 *
 * L'exploitant (SISBM) souscrit pour une organisation et UNE de ses flottes
 * (`vehicleGroupId`) ; les comptes de l'organisation en reçoivent l'offre.
 *
 * Seules les offres commercialisées se souscrivent (422 `E_OFFER_INACTIVE`).
 * Règles communes : `subscription_base.ts`.
 */
@inject()
export default class SubscriptionController extends SubscriptionBase {
  constructor(audit: LucidAuditLogger) {
    super(audit)
  }

  /** GET /admin/subscriptions ?search=&organizationId=&offerId=&vehicleGroupId=&status= */
  async index(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const f = await ctx.request.validateUsing(listSubscriptionsValidator)

    const query = SubscriptionModel.query()
      .whereNull('subscriptions.deleted_at')
      .orderBy('subscriptions.created_at', 'desc')
    if (f.organizationId) query.where('subscriptions.organization_id', f.organizationId)
    if (f.offerId) query.where('subscriptions.offer_id', f.offerId)
    if (f.vehicleGroupId) query.where('subscriptions.vehicle_group_id', f.vehicleGroupId)
    if (f.status) query.where('subscriptions.status', f.status)
    if (f.search) {
      const motif = `%${f.search}%`
      query.where((q) =>
        q.whereILike('subscriptions.reference', motif).orWhereExists((sub) =>
          sub
            .from('organizations')
            .whereColumn('organizations.id', 'subscriptions.organization_id')
            .where((o) =>
              o.whereILike('organizations.name', motif).orWhereILike('organizations.code', motif)
            )
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

  /** GET /admin/subscriptions/:id */
  async show(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const souscription = await this.trouver(ctx.params.id)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    return ctx.response.ok({ data: await this.detailler(souscription) })
  }

  /** POST /admin/subscriptions — une flotte de l'organisation. */
  async store(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const champs = await ctx.request.validateUsing(createSubscriptionValidator)
    if (!(await organizationExists(champs.organizationId))) {
      return this.introuvable(ctx, 'Organisation')
    }
    return this.creer(ctx, champs, this.offreCommercialisee)
  }

  /** PATCH /admin/subscriptions/:id */
  async update(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const champs = await ctx.request.validateUsing(updateSubscriptionValidator)
    const souscription = await this.trouver(ctx.params.id)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    return this.modifier(ctx, souscription, champs, this.offreCommercialisee)
  }

  /** POST /admin/subscriptions/:id/status — activer, suspendre, réactiver ou résilier. */
  async changeStatus(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { status, reason } = await ctx.request.validateUsing(subscriptionStatusValidator)
    const souscription = await this.trouver(ctx.params.id)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    return this.changerStatut(ctx, souscription, status, reason)
  }

  /** DELETE /admin/subscriptions/:id — suppression logique, refusée si active. */
  async destroy(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const souscription = await this.trouver(ctx.params.id)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    return this.supprimer(ctx, souscription)
  }

  // -------------------------------------------------------------------------

  private trouver(id: string): Promise<SubscriptionModel | null> {
    return SubscriptionModel.query().where('id', id).whereNull('deleted_at').first()
  }
}
