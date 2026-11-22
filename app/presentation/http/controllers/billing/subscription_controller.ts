import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import SubscriptionModel from '#infrastructure/persistence/models/subscription_model'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import type OfferModel from '#infrastructure/persistence/models/offer_model'
import { organizationExists } from '#infrastructure/persistence/subscription_reads'
import {
  createSubscriptionValidator,
  listOperatorsValidator,
  listSubscriptionsValidator,
  subscriptionStatusValidator,
  updateSubscriptionValidator,
} from '#presentation/http/validators/billing/subscription_validators'
import { authorizePlatform } from '#presentation/http/support/platform_scope'
import {
  clientsFinaux,
  SubscriptionBase,
} from '#presentation/http/controllers/billing/subscription_base'

/**
 * =========================================================================
 *  SOUSCRIPTIONS — routes `/api/v1/admin/subscriptions/*` (plateforme)
 * =========================================================================
 *
 * L'exploitant (SISBM) souscrit pour une organisation, au choix :
 *   - une FLOTTE (`vehicleGroupId`) — le distributeur et ses opérateurs sans
 *     souscription propre en reçoivent l'offre ;
 *   - un CLIENT FINAL (`operatorId`) — un opérateur de l'organisation, qui ne
 *     gère pas de groupes de véhicules ; il ne voit alors que cette offre.
 *
 * Seules les offres commercialisées se souscrivent (422 `E_OFFER_INACTIVE`).
 * Règles communes : `subscription_base.ts`.
 */
@inject()
export default class SubscriptionController extends SubscriptionBase {
  constructor(audit: LucidAuditLogger) {
    super(audit)
  }

  /** GET /admin/subscriptions ?search=&organizationId=&offerId=&vehicleGroupId=&operatorId=&target=&status= */
  async index(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const f = await ctx.request.validateUsing(listSubscriptionsValidator)

    const query = SubscriptionModel.query()
      .whereNull('subscriptions.deleted_at')
      .orderBy('subscriptions.created_at', 'desc')
    if (f.organizationId) query.where('subscriptions.organization_id', f.organizationId)
    if (f.offerId) query.where('subscriptions.offer_id', f.offerId)
    if (f.vehicleGroupId) query.where('subscriptions.vehicle_group_id', f.vehicleGroupId)
    if (f.operatorId) query.where('subscriptions.operator_id', f.operatorId)
    if (f.target === 'operator') query.whereNotNull('subscriptions.operator_id')
    if (f.target === 'vehicle_group') query.whereNull('subscriptions.operator_id')
    if (f.status) query.where('subscriptions.status', f.status)
    if (f.search) {
      const motif = `%${f.search}%`
      query.where((q) =>
        q
          .whereILike('subscriptions.reference', motif)
          .orWhereExists((sub) =>
            sub
              .from('organizations')
              .whereColumn('organizations.id', 'subscriptions.organization_id')
              .where((o) =>
                o.whereILike('organizations.name', motif).orWhereILike('organizations.code', motif)
              )
          )
          .orWhereExists((sub) =>
            sub
              .from('users')
              .whereColumn('users.id', 'subscriptions.operator_id')
              .where((u) =>
                u.whereILike('users.full_name', motif).orWhereILike('users.email', motif)
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

  /**
   * GET /admin/subscriptions/operators?organizationId= — clients finaux
   * (opérateurs) de l'organisation, avec leur souscription en cours.
   */
  async operators(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(listOperatorsValidator)
    return ctx.response.ok({ data: await clientsFinaux(organizationId) })
  }

  /** GET /admin/subscriptions/:id */
  async show(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const souscription = await this.trouver(ctx.params.id)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    return ctx.response.ok({ data: await this.detailler(souscription) })
  }

  /** POST /admin/subscriptions — une flotte OU un opérateur. */
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

  /** Super Admin : toute offre commercialisée. */
  private offreCommercialisee = (ctx: HttpContext, offre: OfferModel) => {
    if (offre.status === 'active') return false
    this.offreInactive(ctx, offre)
    return true
  }
}
