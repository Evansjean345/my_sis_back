import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import SubscriptionModel from '#infrastructure/persistence/models/subscription_model'
import OfferModel from '#infrastructure/persistence/models/offer_model'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import {
  findVehicleGroup,
  liveSubscriptionOfGroup,
  organizationExists,
  type SubscriptionSummaries,
  subscriptionReferenceTaken,
  subscriptionSummaries,
} from '#infrastructure/persistence/subscription_reads'
import {
  canTransition,
  type SubscriptionStatus,
  subscriptionAmount,
  SUBSCRIPTION_TRANSITIONS,
} from '#domain/billing/subscription_policy'
import {
  createSubscriptionValidator,
  listSubscriptionsValidator,
  subscriptionStatusValidator,
  updateSubscriptionValidator,
} from '#presentation/http/validators/billing/subscription_validators'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { authorizePlatform } from '#presentation/http/support/platform_scope'

const AUDITED = [
  'reference',
  'offerId',
  'vehicleGroupId',
  'unitPrice',
  'status',
  'startDate',
  'endDate',
  'notes',
] as const

/**
 * =========================================================================
 *  SOUSCRIPTIONS — routes `/api/v1/admin/subscriptions/*` (plateforme)
 * =========================================================================
 *
 * Une souscription = une organisation × une offre × UN groupe de véhicules
 * de cette organisation. Une organisation souscrit donc à plusieurs offres
 * (une par flotte) et une offre est souscrite par plusieurs organisations.
 *
 * Exposé en plus des colonnes : `vehiclesCount` (véhicules du groupe à
 * l'instant T) et `amount` = tarif appliqué × véhicules, par période de
 * l'offre. Rien de cela n'est stocké : impossible de diverger.
 *
 * Règles : le groupe appartient à l'organisation (422) et n'a qu'une
 * souscription non résiliée (409) ; on ne souscrit qu'à une offre
 * commercialisée (422) ; statuts draft → active ⇄ suspended → terminated ;
 * une souscription active ne se supprime pas (409 : la résilier d'abord).
 */
@inject()
export default class SubscriptionController {
  constructor(private readonly audit: LucidAuditLogger) {}

  /** GET /admin/subscriptions ?search=&organizationId=&offerId=&vehicleGroupId=&status=&page=&perPage= */
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

  /** POST /admin/subscriptions */
  async store(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const champs = await ctx.request.validateUsing(createSubscriptionValidator)

    if (!(await organizationExists(champs.organizationId))) {
      return this.introuvable(ctx, 'Organisation')
    }

    const offre = await this.offre(champs.offerId)
    if (!offre) return this.introuvable(ctx, 'Offre')
    if (offre.status !== 'active') return this.offreInactive(ctx, offre)

    if (await this.groupeRefuse(ctx, champs.vehicleGroupId, champs.organizationId)) return
    if (champs.reference && (await this.referencePrise(champs.reference))) {
      return this.referenceDejaPrise(ctx, champs.reference)
    }
    if (champs.endDate && champs.endDate < (champs.startDate ?? DateTime.now().toISODate()!)) {
      return this.regle(ctx, 'E_SUBSCRIPTION_DATES', 'La date de fin précède la date de début')
    }

    const souscription = await SubscriptionModel.create({
      ...(champs.reference ? { reference: champs.reference } : {}),
      organizationId: champs.organizationId,
      offerId: offre.id,
      vehicleGroupId: champs.vehicleGroupId,
      unitPrice: String(champs.unitPrice ?? offre.price),
      currency: offre.currency,
      status: champs.status ?? 'draft',
      ...(champs.startDate ? { startDate: DateTime.fromISO(champs.startDate) } : {}),
      endDate: champs.endDate ? DateTime.fromISO(champs.endDate) : null,
      notes: champs.notes ?? null,
      createdBy: toExecutionContext(ctx).actorId,
    })
    await souscription.refresh()

    await this.tracer(ctx, souscription, 'created', { after: this.resume(souscription) })
    return ctx.response.created({ data: await this.detailler(souscription) })
  }

  /** PATCH /admin/subscriptions/:id — l'organisation ne change pas ; une souscription résiliée est figée. */
  async update(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const champs = await ctx.request.validateUsing(updateSubscriptionValidator)
    const souscription = await this.trouver(ctx.params.id)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    if (souscription.status === 'terminated') {
      return this.regle(
        ctx,
        'E_SUBSCRIPTION_TERMINATED',
        'Une souscription résiliée ne se modifie plus'
      )
    }

    let prixOffre: string | null = null
    if (champs.offerId && champs.offerId !== souscription.offerId) {
      const offre = await this.offre(champs.offerId)
      if (!offre) return this.introuvable(ctx, 'Offre')
      if (offre.status !== 'active') return this.offreInactive(ctx, offre)
      prixOffre = offre.price
    }
    if (
      champs.vehicleGroupId &&
      champs.vehicleGroupId !== souscription.vehicleGroupId &&
      (await this.groupeRefuse(
        ctx,
        champs.vehicleGroupId,
        souscription.organizationId,
        souscription.id
      ))
    ) {
      return
    }
    if (
      champs.reference &&
      champs.reference.toLowerCase() !== souscription.reference.toLowerCase() &&
      (await this.referencePrise(champs.reference, souscription.id))
    ) {
      return this.referenceDejaPrise(ctx, champs.reference)
    }
    const debut = champs.startDate ?? souscription.startDate.toISODate()!
    const fin = champs.endDate !== undefined ? champs.endDate : souscription.endDate?.toISODate()
    if (fin && fin < debut) {
      return this.regle(ctx, 'E_SUBSCRIPTION_DATES', 'La date de fin précède la date de début')
    }

    const avant = this.resume(souscription)
    if (champs.reference) souscription.reference = champs.reference
    if (champs.offerId) souscription.offerId = champs.offerId
    if (champs.vehicleGroupId) souscription.vehicleGroupId = champs.vehicleGroupId
    // Changer d'offre sans tarif explicite applique le prix de la nouvelle offre.
    if (champs.unitPrice !== undefined) souscription.unitPrice = String(champs.unitPrice)
    else if (prixOffre !== null) souscription.unitPrice = prixOffre
    if (champs.startDate) souscription.startDate = DateTime.fromISO(champs.startDate)
    if (champs.endDate !== undefined) {
      souscription.endDate = champs.endDate ? DateTime.fromISO(champs.endDate) : null
    }
    if (champs.notes !== undefined) souscription.notes = champs.notes
    await souscription.save()
    await souscription.refresh()

    await this.tracer(ctx, souscription, 'updated', {
      before: avant,
      after: this.resume(souscription),
    })
    return ctx.response.ok({ data: await this.detailler(souscription) })
  }

  /**
   * POST /admin/subscriptions/:id/status — body : { status, reason? }
   * Activer, suspendre, réactiver ou résilier (la résiliation date la fin).
   */
  async changeStatus(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { status, reason } = await ctx.request.validateUsing(subscriptionStatusValidator)
    const souscription = await this.trouver(ctx.params.id)
    if (!souscription) return this.introuvable(ctx, 'Souscription')

    const actuel = souscription.status as SubscriptionStatus
    if (actuel === status) {
      return ctx.response.ok({ data: { ...(await this.detailler(souscription)), unchanged: true } })
    }
    if (!canTransition(actuel, status)) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_INVALID_STATUS_TRANSITION',
          message: `Passage de « ${actuel} » à « ${status} » impossible`,
          details: { from: actuel, to: status, allowed: SUBSCRIPTION_TRANSITIONS[actuel] },
        },
      })
    }
    if (status === 'active') {
      const offre = await this.offre(souscription.offerId)
      if (!offre) return this.introuvable(ctx, 'Offre')
    }

    souscription.status = status
    if (status === 'terminated' && !souscription.endDate) {
      const aujourdhui = DateTime.now().startOf('day')
      souscription.endDate =
        aujourdhui < souscription.startDate ? souscription.startDate : aujourdhui
    }
    await souscription.save()
    await souscription.refresh()

    await this.tracer(ctx, souscription, 'status_changed', {
      before: { status: actuel },
      after: { status },
      metadata: reason ? { reason } : undefined,
    })
    return ctx.response.ok({ data: await this.detailler(souscription) })
  }

  /** DELETE /admin/subscriptions/:id — suppression logique, refusée si active. */
  async destroy(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const souscription = await this.trouver(ctx.params.id)
    if (!souscription) return this.introuvable(ctx, 'Souscription')
    if (souscription.status === 'active') {
      return ctx.response.conflict({
        error: {
          code: 'E_SUBSCRIPTION_ACTIVE',
          message:
            'Une souscription active ne se supprime pas : suspendez-la ou résiliez-la d’abord',
          details: {},
        },
      })
    }

    const avant = this.resume(souscription)
    souscription.deletedAt = DateTime.now()
    await souscription.save()
    await this.tracer(ctx, souscription, 'deleted', { before: avant })
    return ctx.response.noContent()
  }

  // -------------------------------------------------------------------------

  private trouver(id: string): Promise<SubscriptionModel | null> {
    return SubscriptionModel.query().where('id', id).whereNull('deleted_at').first()
  }

  private offre(id: string) {
    return OfferModel.query().where('id', id).whereNull('deleted_at').first()
  }

  /**
   * Le groupe existe-t-il, appartient-il à l'organisation, est-il libre ?
   * Sinon la réponse est ENVOYÉE et la méthode renvoie `true`.
   */
  private async groupeRefuse(
    ctx: HttpContext,
    groupId: string,
    organizationId: string,
    exceptId?: string
  ): Promise<boolean> {
    const groupe = await findVehicleGroup(groupId)
    if (!groupe) {
      this.introuvable(ctx, 'Groupe de véhicules')
      return true
    }
    if (groupe.organizationId !== organizationId) {
      ctx.response.unprocessableEntity({
        error: {
          code: 'E_VEHICLE_GROUP_MISMATCH',
          message: 'Ce groupe de véhicules appartient à une autre organisation',
          details: { vehicleGroupId: groupId },
        },
      })
      return true
    }
    const existante = await liveSubscriptionOfGroup(groupId, exceptId)
    if (!existante) return false
    ctx.response.conflict({
      error: {
        code: 'E_VEHICLE_GROUP_SUBSCRIBED',
        message: `Le groupe « ${groupe.name} » a déjà une souscription en cours (${existante.reference}) : résiliez-la d'abord`,
        details: { subscription: existante },
      },
    })
    return true
  }

  private referencePrise(reference: string, exceptId?: string): Promise<boolean> {
    return subscriptionReferenceTaken(reference, exceptId)
  }

  private joindre(lignes: SubscriptionModel[]): Promise<SubscriptionSummaries> {
    return subscriptionSummaries(lignes)
  }

  private exposer(s: SubscriptionModel, j: SubscriptionSummaries) {
    const vehicles = j.vehicles.get(s.vehicleGroupId) ?? 0
    const offre = j.offers.get(s.offerId) ?? null
    return {
      ...s.serialize(),
      organization: j.organizations.get(s.organizationId) ?? null,
      offer: offre,
      vehicleGroup: j.groups.get(s.vehicleGroupId) ?? null,
      /** Périodicité de facturation : celle de l'offre. */
      periodicity: offre?.periodicity ?? null,
      vehiclesCount: vehicles,
      amount: subscriptionAmount(s.unitPrice, vehicles),
    }
  }

  private async detailler(s: SubscriptionModel) {
    return this.exposer(s, await this.joindre([s]))
  }

  private offreInactive(ctx: HttpContext, offre: OfferModel) {
    return ctx.response.unprocessableEntity({
      error: {
        code: 'E_OFFER_INACTIVE',
        message: `L'offre ${offre.code} n'est pas commercialisée : activez-la avant d'y souscrire`,
        details: { offerId: offre.id },
      },
    })
  }

  private referenceDejaPrise(ctx: HttpContext, reference: string) {
    return ctx.response.conflict({
      error: {
        code: 'E_SUBSCRIPTION_REFERENCE_TAKEN',
        message: 'Cette référence est déjà utilisée',
        details: { reference },
      },
    })
  }

  private regle(ctx: HttpContext, code: string, message: string) {
    return ctx.response.unprocessableEntity({ error: { code, message, details: {} } })
  }

  private introuvable(ctx: HttpContext, ressource: string) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: `${ressource} introuvable`, details: {} },
    })
  }

  private resume(s: SubscriptionModel): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const k of AUDITED) {
      const v = s[k]
      out[k] = v instanceof DateTime ? v.toISODate() : (v ?? null)
    }
    return out
  }

  /** Trace sous l'organisation cliente : elle la retrouve dans son journal. */
  private tracer(
    ctx: HttpContext,
    s: SubscriptionModel,
    action: string,
    details: {
      before?: Record<string, unknown>
      after?: Record<string, unknown>
      metadata?: Record<string, unknown>
    }
  ) {
    return this.audit.record({
      context: { ...toExecutionContext(ctx), organizationId: s.organizationId },
      action: `billing.subscription.${action}`,
      resourceType: 'subscription',
      resourceId: s.id,
      ...details,
    })
  }
}
