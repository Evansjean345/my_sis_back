import vine from '@vinejs/vine'
import {
  INITIAL_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_REFERENCE_PATTERN,
  SUBSCRIPTION_STATUSES,
} from '#domain/billing/subscription_policy'

/**
 * Schémas des souscriptions (migrations 027, 028 et 031).
 *
 * Une souscription vise toujours UNE flotte (`vehicleGroupId`) de
 * l'organisation. Existence, appartenance à l'organisation et unicité :
 * contrôleur.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const reference = () => vine.string().trim().regex(SUBSCRIPTION_REFERENCE_PATTERN)
/** Montants par période de l'offre (forfait, indépendant des véhicules). */
const amount = () => vine.number().min(0).max(999_999_999_999)
const page = () => vine.number().withoutDecimals().min(1)

/** Champs communs à toute création (Super Admin et client). */
const commonCreate = {
  /** Absente : `SUB-AAAA-00001`. */
  reference: reference().optional(),
  offerId: vine.string().uuid(),
  /** Prix de l'offre figé dans la souscription. Absent : prix actuel de l'offre. */
  offerPrice: amount().optional(),
  /** Remise en montant. Absente : 0. Jamais supérieure au prix. */
  discount: amount().optional(),
  status: vine.enum(INITIAL_SUBSCRIPTION_STATUSES).optional(),
  /** Absente : aujourd'hui. */
  startDate: vine.string().trim().regex(DATE).optional(),
  endDate: vine.string().trim().regex(DATE).optional(),
  notes: vine.string().trim().maxLength(2000).optional(),
}

/** Champs communs à toute modification. `null` efface (date de fin, notes). */
const commonUpdate = {
  reference: reference().optional(),
  offerId: vine.string().uuid().optional(),
  offerPrice: amount().optional(),
  discount: amount().optional(),
  startDate: vine.string().trim().regex(DATE).optional(),
  endDate: vine.string().trim().regex(DATE).nullable().optional(),
  notes: vine.string().trim().maxLength(2000).nullable().optional(),
}

// ------------------------------------------------------------ Super Admin

/** POST /admin/subscriptions — une flotte de l'organisation. */
export const createSubscriptionValidator = vine.compile(
  vine.object({
    ...commonCreate,
    organizationId: vine.string().uuid(),
    vehicleGroupId: vine.string().uuid(),
  })
)

/**
 * PATCH [/admin]/subscriptions/:id — l'organisation ne change pas. Changer
 * d'offre sans `offerPrice` reprend le prix de la nouvelle offre.
 */
export const updateSubscriptionValidator = vine.compile(
  vine.object({ ...commonUpdate, vehicleGroupId: vine.string().uuid().optional() })
)

/** GET /admin/subscriptions */
export const listSubscriptionsValidator = vine.compile(
  vine.object({
    /** Référence ou client. */
    search: vine.string().trim().maxLength(80).optional(),
    organizationId: vine.string().uuid().optional(),
    offerId: vine.string().uuid().optional(),
    vehicleGroupId: vine.string().uuid().optional(),
    status: vine.enum(SUBSCRIPTION_STATUSES).optional(),
    page: page().optional(),
    perPage: page().max(100).optional(),
  })
)

// ------------------------------------------------------- client (admin)

/** POST /subscriptions — pour une flotte de MON organisation. */
export const createClientSubscriptionValidator = vine.compile(
  vine.object({ ...commonCreate, vehicleGroupId: vine.string().uuid() })
)

/** GET /subscriptions */
export const listClientSubscriptionsValidator = vine.compile(
  vine.object({
    /** Référence ou nom de la flotte. */
    search: vine.string().trim().maxLength(80).optional(),
    vehicleGroupId: vine.string().uuid().optional(),
    offerId: vine.string().uuid().optional(),
    status: vine.enum(SUBSCRIPTION_STATUSES).optional(),
    page: page().optional(),
    perPage: page().max(100).optional(),
  })
)

/** POST [/admin]/subscriptions/:id/status */
export const subscriptionStatusValidator = vine.compile(
  vine.object({
    status: vine.enum(SUBSCRIPTION_STATUSES),
    reason: vine.string().trim().maxLength(500).optional(),
  })
)
