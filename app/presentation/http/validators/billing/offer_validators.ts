import vine from '@vinejs/vine'
import {
  GPS_HISTORY_DAYS,
  OFFER_CODE_PATTERN,
  OFFER_FEATURE_KEYS,
  OFFER_PERIODICITIES,
  OFFER_STATUSES,
} from '#domain/billing/offer_policy'

/**
 * Schémas des offres (migration 022).
 *
 * Les règles structurelles sont doublées en base (contraintes CHECK, index
 * uniques) : ici, elles produisent un 422 lisible champ par champ.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Code saisi librement (« premium-50 ») puis normalisé en MAJUSCULES avant contrôle. */
const code = () => vine.string().trim().toUpperCase().regex(OFFER_CODE_PATTERN)

const offerFields = {
  code: code(),
  name: vine.string().trim().minLength(2).maxLength(120),
  description: vine.string().trim().maxLength(2000).optional(),
  /** Montant dans la devise de l'offre (XOF par défaut : pas de centimes en pratique). */
  price: vine.number().min(0).max(999_999_999_999),
  currency: vine.string().trim().fixedLength(3).toUpperCase().optional(),
  periodicity: vine.enum(OFFER_PERIODICITIES),
  /** Absent : `inactive` (défaut en base). */
  status: vine.enum(OFFER_STATUSES).optional(),
  /** Date de commercialisation, AAAA-MM-JJ. Obligatoire pour une offre active. */
  launchedOn: vine.string().trim().regex(DATE).optional(),
  /** Nombre de véhicules ; `null` ou absent = illimité. */
  maxVehicles: vine.number().withoutDecimals().min(1).max(1_000_000).nullable().optional(),
  /** Profondeur de l'historique des trajets, en jours. */
  gpsHistoryDays: vine
    .number()
    .withoutDecimals()
    .min(GPS_HISTORY_DAYS.min)
    .max(GPS_HISTORY_DAYS.max)
    .optional(),
  features: vine.array(vine.enum(OFFER_FEATURE_KEYS)).distinct().optional(),
  /** Organisations rattachées dès la création — facultatives. */
  organizationIds: vine.array(vine.string().uuid()).distinct().maxLength(500).optional(),
}

export const createOfferValidator = vine.compile(vine.object(offerFields))

/**
 * Tous les champs de l'offre sont modifiables ; `null` efface (description,
 * date, limite). Les organisations se gèrent par `/:id/organizations`.
 */
export const updateOfferValidator = vine.compile(
  vine.object({
    code: code().optional(),
    name: offerFields.name.clone().optional(),
    description: vine.string().trim().maxLength(2000).nullable().optional(),
    price: offerFields.price.clone().optional(),
    currency: vine.string().trim().fixedLength(3).toUpperCase().optional(),
    periodicity: vine.enum(OFFER_PERIODICITIES).optional(),
    status: vine.enum(OFFER_STATUSES).optional(),
    launchedOn: vine.string().trim().regex(DATE).nullable().optional(),
    maxVehicles: vine.number().withoutDecimals().min(1).max(1_000_000).nullable().optional(),
    gpsHistoryDays: vine
      .number()
      .withoutDecimals()
      .min(GPS_HISTORY_DAYS.min)
      .max(GPS_HISTORY_DAYS.max)
      .optional(),
    features: vine.array(vine.enum(OFFER_FEATURE_KEYS)).distinct().optional(),
  })
)

/**
 * POST /admin/offers/:id/organizations
 *
 * `move: true` déplace vers cette offre les organisations qui en détiennent
 * déjà une autre ; sinon elles répondent 409 `E_ORGANIZATION_HAS_OFFER`.
 */
export const attachOfferOrganizationsValidator = vine.compile(
  vine.object({
    organizationIds: vine.array(vine.string().uuid()).minLength(1).maxLength(500).distinct(),
    move: vine.boolean().optional(),
  })
)

/** GET /admin/offers */
export const listOffersValidator = vine.compile(
  vine.object({
    search: vine.string().trim().maxLength(80).optional(),
    status: vine.enum(OFFER_STATUSES).optional(),
    periodicity: vine.enum(OFFER_PERIODICITIES).optional(),
    /** Offre détenue par cette organisation. */
    organizationId: vine.string().uuid().optional(),
    /** `true` : offres détenues par au moins une organisation ; `false` : aucune. */
    assigned: vine.boolean().optional(),
    page: vine.number().withoutDecimals().min(1).optional(),
    perPage: vine.number().withoutDecimals().min(1).max(100).optional(),
  })
)
