import vine from '@vinejs/vine'
import {
  INITIAL_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_REFERENCE_PATTERN,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_TARGETS,
} from '#domain/billing/subscription_policy'

/**
 * Schémas des souscriptions (migrations 027, 028 et 030).
 *
 * Cible : `vehicleGroupId` (une flotte) OU `operatorId` (un client final) —
 * exactement l'une des deux, vérifié par le contrôleur (422
 * `E_SUBSCRIPTION_TARGET`) et par la base (`ck_subscriptions_target`).
 * Existence, appartenance à l'organisation et unicité : contrôleur.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const reference = () => vine.string().trim().regex(SUBSCRIPTION_REFERENCE_PATTERN)
/** Montants par période de l'offre (forfait, indépendant des véhicules). */
const amount = () => vine.number().min(0).max(999_999_999_999)
const page = () => vine.number().withoutDecimals().min(1)

/** Champs communs à toute création (Super Admin et distributeur). */
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

/** POST /admin/subscriptions — une flotte OU un opérateur de l'organisation. */
export const createSubscriptionValidator = vine.compile(
  vine.object({
    ...commonCreate,
    organizationId: vine.string().uuid(),
    vehicleGroupId: vine.string().uuid().optional(),
    operatorId: vine.string().uuid().optional(),
  })
)

/**
 * PATCH /admin/subscriptions/:id — l'organisation ne change pas. Donner une
 * nouvelle cible (flotte ou opérateur) remplace l'ancienne. Changer d'offre
 * sans `offerPrice` reprend le prix de la nouvelle offre.
 */
export const updateSubscriptionValidator = vine.compile(
  vine.object({
    ...commonUpdate,
    vehicleGroupId: vine.string().uuid().optional(),
    operatorId: vine.string().uuid().optional(),
  })
)

/** GET /admin/subscriptions */
export const listSubscriptionsValidator = vine.compile(
  vine.object({
    /** Référence, client ou opérateur. */
    search: vine.string().trim().maxLength(80).optional(),
    organizationId: vine.string().uuid().optional(),
    offerId: vine.string().uuid().optional(),
    vehicleGroupId: vine.string().uuid().optional(),
    operatorId: vine.string().uuid().optional(),
    target: vine.enum(SUBSCRIPTION_TARGETS).optional(),
    status: vine.enum(SUBSCRIPTION_STATUSES).optional(),
    page: page().optional(),
    perPage: page().max(100).optional(),
  })
)

/** GET /admin/subscriptions/operators?organizationId= */
export const listOperatorsValidator = vine.compile(
  vine.object({ organizationId: vine.string().uuid() })
)

// ------------------------------------------------------------ distributeur

/** POST /subscriptions — pour un opérateur de MON organisation. */
export const createClientSubscriptionValidator = vine.compile(
  vine.object({ ...commonCreate, operatorId: vine.string().uuid() })
)

/** PATCH /subscriptions/:id */
export const updateClientSubscriptionValidator = vine.compile(
  vine.object({ ...commonUpdate, operatorId: vine.string().uuid().optional() })
)

/** GET /subscriptions */
export const listClientSubscriptionsValidator = vine.compile(
  vine.object({
    search: vine.string().trim().maxLength(80).optional(),
    operatorId: vine.string().uuid().optional(),
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
