import vine from '@vinejs/vine'
import {
  INITIAL_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_REFERENCE_PATTERN,
  SUBSCRIPTION_STATUSES,
} from '#domain/billing/subscription_policy'

/**
 * Schémas des souscriptions (migration 027).
 *
 * Organisation, offre et groupe : existence et cohérence vérifiées par le
 * contrôleur (le groupe doit appartenir à l'organisation, et n'avoir aucune
 * autre souscription vivante).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const reference = () => vine.string().trim().regex(SUBSCRIPTION_REFERENCE_PATTERN)
/** Montants par période de l'offre (forfait, indépendant des véhicules). */
const amount = () => vine.number().min(0).max(999_999_999_999)

export const createSubscriptionValidator = vine.compile(
  vine.object({
    /** Absente : `SUB-AAAA-00001`. */
    reference: reference().optional(),
    organizationId: vine.string().uuid(),
    offerId: vine.string().uuid(),
    vehicleGroupId: vine.string().uuid(),
    /** Prix de l'offre figé dans la souscription. Absent : prix actuel de l'offre. */
    offerPrice: amount().optional(),
    /** Remise en montant. Absente : 0. Jamais supérieure au prix. */
    discount: amount().optional(),
    status: vine.enum(INITIAL_SUBSCRIPTION_STATUSES).optional(),
    /** Absente : aujourd'hui. */
    startDate: vine.string().trim().regex(DATE).optional(),
    endDate: vine.string().trim().regex(DATE).optional(),
    notes: vine.string().trim().maxLength(2000).optional(),
  })
)

/**
 * L'organisation ne change pas. Changer d'offre sans `offerPrice` reprend le
 * prix de la nouvelle offre. `null` efface (date de fin, notes).
 */
export const updateSubscriptionValidator = vine.compile(
  vine.object({
    reference: reference().optional(),
    offerId: vine.string().uuid().optional(),
    vehicleGroupId: vine.string().uuid().optional(),
    offerPrice: amount().optional(),
    discount: amount().optional(),
    startDate: vine.string().trim().regex(DATE).optional(),
    endDate: vine.string().trim().regex(DATE).nullable().optional(),
    notes: vine.string().trim().maxLength(2000).nullable().optional(),
  })
)

/** POST /admin/subscriptions/:id/status */
export const subscriptionStatusValidator = vine.compile(
  vine.object({
    status: vine.enum(SUBSCRIPTION_STATUSES),
    reason: vine.string().trim().maxLength(500).optional(),
  })
)

/** GET /admin/subscriptions */
export const listSubscriptionsValidator = vine.compile(
  vine.object({
    /** Référence ou nom / code du client. */
    search: vine.string().trim().maxLength(80).optional(),
    organizationId: vine.string().uuid().optional(),
    offerId: vine.string().uuid().optional(),
    vehicleGroupId: vine.string().uuid().optional(),
    status: vine.enum(SUBSCRIPTION_STATUSES).optional(),
    page: vine.number().withoutDecimals().min(1).optional(),
    perPage: vine.number().withoutDecimals().min(1).max(100).optional(),
  })
)
