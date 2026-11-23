import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import SubscriptionModel from '#infrastructure/persistence/models/subscription_model'
import OfferModel from '#infrastructure/persistence/models/offer_model'
import type { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import {
  findVehicleGroup,
  liveSubscriptionOfGroup,
  type SubscriptionSummaries,
  subscriptionReferenceTaken,
  subscriptionSummaries,
} from '#infrastructure/persistence/subscription_reads'
import {
  canTransition,
  discountProblem,
  type SubscriptionStatus,
  SUBSCRIPTION_TRANSITIONS,
} from '#domain/billing/subscription_policy'
import { toExecutionContext } from '#presentation/http/support/execution_context'

const AUDITED = [
  'reference',
  'offerId',
  'vehicleGroupId',
  'offerPrice',
  'discount',
  'totalPrice',
  'status',
  'startDate',
  'endDate',
  'notes',
] as const

/** Données d'une création, quelle que soit l'origine (Super Admin ou client). */
export interface CreationInput {
  organizationId: string
  offerId: string
  vehicleGroupId: string
  reference?: string
  offerPrice?: number
  discount?: number
  status?: 'draft' | 'active'
  startDate?: string
  endDate?: string
  notes?: string
}

export interface UpdateInput {
  offerId?: string
  vehicleGroupId?: string
  reference?: string
  offerPrice?: number
  discount?: number
  startDate?: string
  endDate?: string | null
  notes?: string | null
}

/**
 * Règle d'offre (Super Admin comme client : `offreCommercialisee`).
 * Renvoie `true` si la réponse de refus a été envoyée.
 */
export type OfferRule = (ctx: HttpContext, offre: OfferModel) => Promise<boolean> | boolean

/**
 * =========================================================================
 *  SOUSCRIPTIONS — socle commun (Super Admin et distributeur)
 * =========================================================================
 *
 * Une souscription = une organisation × une offre × UNE flotte
 * (`vehicleGroupId`) de l'organisation.
 *
 * Tarif forfaitaire : `offerPrice` (prix de l'offre figé) − `discount` =
 * `totalPrice` (colonne générée). Statuts draft → active ⇄ suspended →
 * terminated ; une souscription active ne se supprime pas.
 *
 * Les méthodes `…Refuse` envoient la réponse d'erreur et renvoient `true` ;
 * le contrôleur s'arrête alors (`if (await this.xRefuse(…)) return`).
 */
export abstract class SubscriptionBase {
  constructor(protected readonly audit: LucidAuditLogger) {}

  // ----------------------------------------------------------------- flux

  protected async creer(ctx: HttpContext, data: CreationInput, regleOffre: OfferRule) {
    const offre = await this.offre(data.offerId)
    if (!offre) return this.introuvable(ctx, 'Offre')
    if (await regleOffre(ctx, offre)) return

    if (await this.groupeRefuse(ctx, data.vehicleGroupId, data.organizationId)) return
    if (data.reference && (await subscriptionReferenceTaken(data.reference))) {
      return this.referenceDejaPrise(ctx, data.reference)
    }
    if (data.endDate && data.endDate < (data.startDate ?? DateTime.now().toISODate()!)) {
      return this.regle(ctx, 'E_SUBSCRIPTION_DATES', 'La date de fin précède la date de début')
    }
    const prix = data.offerPrice !== undefined ? String(data.offerPrice) : offre.price
    const remise = String(data.discount ?? 0)
    const problemeRemise = discountProblem(prix, remise)
    if (problemeRemise) return this.regle(ctx, 'E_DISCOUNT_EXCEEDS_PRICE', problemeRemise)

    const souscription = await SubscriptionModel.create({
      ...(data.reference ? { reference: data.reference } : {}),
      organizationId: data.organizationId,
      offerId: offre.id,
      vehicleGroupId: data.vehicleGroupId,
      offerPrice: prix,
      discount: remise,
      currency: offre.currency,
      status: data.status ?? 'draft',
      ...(data.startDate ? { startDate: DateTime.fromISO(data.startDate) } : {}),
      endDate: data.endDate ? DateTime.fromISO(data.endDate) : null,
      notes: data.notes ?? null,
      createdBy: toExecutionContext(ctx).actorId,
    })
    await souscription.refresh()

    await this.tracer(ctx, souscription, 'created', { after: this.resume(souscription) })
    return ctx.response.created({ data: await this.detailler(souscription) })
  }

  protected async modifier(
    ctx: HttpContext,
    souscription: SubscriptionModel,
    data: UpdateInput,
    regleOffre: OfferRule
  ) {
    if (souscription.status === 'terminated') {
      return this.regle(
        ctx,
        'E_SUBSCRIPTION_TERMINATED',
        'Une souscription résiliée ne se modifie plus'
      )
    }

    let prixOffre: string | null = null
    if (data.offerId && data.offerId !== souscription.offerId) {
      const offre = await this.offre(data.offerId)
      if (!offre) return this.introuvable(ctx, 'Offre')
      if (await regleOffre(ctx, offre)) return
      prixOffre = offre.price
    }

    if (
      data.vehicleGroupId &&
      data.vehicleGroupId !== souscription.vehicleGroupId &&
      (await this.groupeRefuse(
        ctx,
        data.vehicleGroupId,
        souscription.organizationId,
        souscription.id
      ))
    ) {
      return
    }

    if (
      data.reference &&
      data.reference.toLowerCase() !== souscription.reference.toLowerCase() &&
      (await subscriptionReferenceTaken(data.reference, souscription.id))
    ) {
      return this.referenceDejaPrise(ctx, data.reference)
    }
    const debut = data.startDate ?? souscription.startDate.toISODate()!
    const fin = data.endDate !== undefined ? data.endDate : souscription.endDate?.toISODate()
    if (fin && fin < debut) {
      return this.regle(ctx, 'E_SUBSCRIPTION_DATES', 'La date de fin précède la date de début')
    }
    // Changer d'offre sans prix explicite reprend le prix de la nouvelle offre.
    const prix =
      data.offerPrice !== undefined
        ? String(data.offerPrice)
        : (prixOffre ?? souscription.offerPrice)
    const remise = data.discount !== undefined ? String(data.discount) : souscription.discount
    const problemeRemise = discountProblem(prix, remise)
    if (problemeRemise) return this.regle(ctx, 'E_DISCOUNT_EXCEEDS_PRICE', problemeRemise)

    const avant = this.resume(souscription)
    if (data.reference) souscription.reference = data.reference
    if (data.offerId) souscription.offerId = data.offerId
    if (data.vehicleGroupId) souscription.vehicleGroupId = data.vehicleGroupId
    souscription.offerPrice = prix
    souscription.discount = remise
    if (data.startDate) souscription.startDate = DateTime.fromISO(data.startDate)
    if (data.endDate !== undefined) {
      souscription.endDate = data.endDate ? DateTime.fromISO(data.endDate) : null
    }
    if (data.notes !== undefined) souscription.notes = data.notes
    await souscription.save()
    await souscription.refresh()

    await this.tracer(ctx, souscription, 'updated', {
      before: avant,
      after: this.resume(souscription),
    })
    return ctx.response.ok({ data: await this.detailler(souscription) })
  }

  protected async changerStatut(
    ctx: HttpContext,
    souscription: SubscriptionModel,
    status: SubscriptionStatus,
    reason?: string
  ) {
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
    if (status === 'active' && !(await this.offre(souscription.offerId))) {
      return this.introuvable(ctx, 'Offre')
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

  protected async supprimer(ctx: HttpContext, souscription: SubscriptionModel) {
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

  // --------------------------------------------------------------- flotte

  /** Flotte de l'organisation, sans autre souscription vivante ? */
  protected async groupeRefuse(
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

  // --------------------------------------------------------------- lecture

  protected offre(id: string) {
    return OfferModel.query().where('id', id).whereNull('deleted_at').first()
  }

  protected joindre(lignes: SubscriptionModel[]): Promise<SubscriptionSummaries> {
    return subscriptionSummaries(lignes)
  }

  protected exposer(s: SubscriptionModel, j: SubscriptionSummaries) {
    const offre = j.offers.get(s.offerId) ?? null
    return {
      ...s.serialize(),
      organization: j.organizations.get(s.organizationId) ?? null,
      offer: offre,
      vehicleGroup: j.groups.get(s.vehicleGroupId) ?? null,
      /** Périodicité de facturation : celle de l'offre. */
      periodicity: offre?.periodicity ?? null,
      /** Information seulement : le tarif ne dépend pas des véhicules. */
      vehiclesCount: j.vehicles.get(s.vehicleGroupId) ?? 0,
    }
  }

  protected async detailler(s: SubscriptionModel) {
    return this.exposer(s, await this.joindre([s]))
  }

  // -------------------------------------------------------------- réponses

  /** Règle commune : seule une offre commercialisée se souscrit. */
  protected offreCommercialisee = (ctx: HttpContext, offre: OfferModel) => {
    if (offre.status === 'active') return false
    this.offreInactive(ctx, offre)
    return true
  }

  protected offreInactive(ctx: HttpContext, offre: OfferModel) {
    return ctx.response.unprocessableEntity({
      error: {
        code: 'E_OFFER_INACTIVE',
        message: `L'offre ${offre.code} n'est pas commercialisée : activez-la avant d'y souscrire`,
        details: { offerId: offre.id },
      },
    })
  }

  protected referenceDejaPrise(ctx: HttpContext, reference: string) {
    return ctx.response.conflict({
      error: {
        code: 'E_SUBSCRIPTION_REFERENCE_TAKEN',
        message: 'Cette référence est déjà utilisée',
        details: { reference },
      },
    })
  }

  protected regle(ctx: HttpContext, code: string, message: string) {
    return ctx.response.unprocessableEntity({ error: { code, message, details: {} } })
  }

  protected introuvable(ctx: HttpContext, ressource: string) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: `${ressource} introuvable`, details: {} },
    })
  }

  // ----------------------------------------------------------------- audit

  protected resume(s: SubscriptionModel): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const k of AUDITED) {
      const v = s[k]
      out[k] = v instanceof DateTime ? v.toISODate() : (v ?? null)
    }
    return out
  }

  /** Trace sous l'organisation cliente : elle la retrouve dans son journal. */
  protected tracer(
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
