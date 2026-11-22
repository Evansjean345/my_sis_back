import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import SubscriptionModel from '#infrastructure/persistence/models/subscription_model'
import type OfferModel from '#infrastructure/persistence/models/offer_model'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { offersSubscribedByOrganization } from '#infrastructure/persistence/subscription_reads'
import {
  createClientSubscriptionValidator,
  listClientSubscriptionsValidator,
  subscriptionStatusValidator,
  updateClientSubscriptionValidator,
} from '#presentation/http/validators/billing/subscription_validators'
import { authorize } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import {
  clientsFinaux,
  SubscriptionBase,
} from '#presentation/http/controllers/billing/subscription_base'

/**
 * =========================================================================
 *  SOUSCRIPTIONS DE MES CLIENTS FINAUX — routes `/api/v1/subscriptions/*`
 * =========================================================================
 *
 * Le distributeur (rôle `admin`, habilitation `subscription:*`) crée et gère
 * les souscriptions des OPÉRATEURS de son organisation :
 *
 *   - cible : un opérateur de l'organisation uniquement (les souscriptions
 *     de flotte restent l'affaire de SISBM, au Super Admin) ;
 *   - offre : seulement une offre que l'organisation a elle-même souscrite
 *     (souscription de flotte active) — 422 `E_OFFER_NOT_SUBSCRIBED` ;
 *   - prix : le distributeur fixe son prix et sa remise (prix de l'offre par
 *     défaut).
 *
 * Toutes les lectures et écritures sont cloisonnées à l'organisation du
 * compte connecté. Règles communes : `subscription_base.ts`.
 */
@inject()
export default class ClientSubscriptionController extends SubscriptionBase {
  constructor(audit: LucidAuditLogger) {
    super(audit)
  }

  /** GET /subscriptions/offers — offres que je peux attribuer (celles que j'ai souscrites). */
  async offers(ctx: HttpContext) {
    await authorize(ctx, 'viewSubscriptions')
    return ctx.response.ok({ data: await offersSubscribedByOrganization(this.organisation(ctx)) })
  }

  /** GET /subscriptions/operators — mes clients finaux et leur souscription en cours. */
  async operators(ctx: HttpContext) {
    await authorize(ctx, 'viewSubscriptions')
    return ctx.response.ok({ data: await clientsFinaux(this.organisation(ctx)) })
  }

  /** GET /subscriptions ?search=&operatorId=&offerId=&status=&page=&perPage= — souscriptions de mes opérateurs. */
  async index(ctx: HttpContext) {
    await authorize(ctx, 'viewSubscriptions')
    const f = await ctx.request.validateUsing(listClientSubscriptionsValidator)

    const query = this.portee(ctx).orderBy('subscriptions.created_at', 'desc')
    if (f.operatorId) query.where('subscriptions.operator_id', f.operatorId)
    if (f.offerId) query.where('subscriptions.offer_id', f.offerId)
    if (f.status) query.where('subscriptions.status', f.status)
    if (f.search) {
      const motif = `%${f.search}%`
      query.where((q) =>
        q.whereILike('subscriptions.reference', motif).orWhereExists((sub) =>
          sub
            .from('users')
            .whereColumn('users.id', 'subscriptions.operator_id')
            .where((u) => u.whereILike('users.full_name', motif).orWhereILike('users.email', motif))
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

  /** POST /subscriptions — pour un de mes opérateurs. */
  async store(ctx: HttpContext) {
    await authorize(ctx, 'manageSubscriptions')
    const champs = await ctx.request.validateUsing(createClientSubscriptionValidator)
    return this.creer(
      ctx,
      { ...champs, organizationId: this.organisation(ctx) },
      this.offreSouscrite
    )
  }

  /** PATCH /subscriptions/:id */
  async update(ctx: HttpContext) {
    await authorize(ctx, 'manageSubscriptions')
    const champs = await ctx.request.validateUsing(updateClientSubscriptionValidator)
    const souscription = await this.trouver(ctx)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    return this.modifier(ctx, souscription, champs, this.offreSouscrite)
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

  /** Souscriptions d'opérateurs de MON organisation (jamais les souscriptions de flotte). */
  private portee(ctx: HttpContext) {
    return SubscriptionModel.query()
      .where('subscriptions.organization_id', this.organisation(ctx))
      .whereNotNull('subscriptions.operator_id')
      .whereNull('subscriptions.deleted_at')
  }

  private trouver(ctx: HttpContext): Promise<SubscriptionModel | null> {
    return this.portee(ctx).where('subscriptions.id', ctx.params.id).first()
  }

  /** Distributeur : seulement une offre que l'organisation a elle-même souscrite. */
  private offreSouscrite = async (ctx: HttpContext, offre: OfferModel) => {
    const souscrites = await offersSubscribedByOrganization(this.organisation(ctx))
    if (souscrites.some((o) => o.id === offre.id)) return false
    ctx.response.unprocessableEntity({
      error: {
        code: 'E_OFFER_NOT_SUBSCRIBED',
        message: `Votre organisation n'a pas souscrit l'offre ${offre.name} : vous ne pouvez pas l'attribuer`,
        details: { offerId: offre.id, allowed: souscrites.map((o) => o.id) },
      },
    })
    return true
  }
}
