import vine from '@vinejs/vine'
import {
  GPS_HISTORY_DAYS,
  OFFER_CODE_PATTERN,
  OFFER_PERIODICITIES,
  OFFER_STATUSES,
  SUB_FEATURE_KEY_PATTERN,
} from '#domain/billing/offer_policy'

/**
 * Schémas des offres (migrations 022 et 026).
 *
 * Les règles structurelles sont doublées en base (contraintes CHECK, index
 * uniques) : ici, elles produisent un 422 lisible champ par champ.
 * `featureKeys` : clés de sous-fonctionnalités ; leur existence dans le
 * catalogue est vérifiée par le contrôleur (422 `E_UNKNOWN_FEATURE`).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Code saisi librement (« premium-50 ») puis normalisé en MAJUSCULES avant contrôle. */
const code = () => vine.string().trim().toUpperCase().regex(OFFER_CODE_PATTERN)
const featureKeys = () =>
  vine.array(vine.string().trim().regex(SUB_FEATURE_KEY_PATTERN)).distinct().maxLength(200)
const gpsHistoryDays = () =>
  vine.number().withoutDecimals().min(GPS_HISTORY_DAYS.min).max(GPS_HISTORY_DAYS.max)
const maxVehicles = () => vine.number().withoutDecimals().min(1).max(1_000_000)
const price = () => vine.number().min(0).max(999_999_999_999)
const currency = () => vine.string().trim().fixedLength(3).toUpperCase()

export const createOfferValidator = vine.compile(
  vine.object({
    code: code(),
    name: vine.string().trim().minLength(2).maxLength(120),
    description: vine.string().trim().maxLength(2000).optional(),
    /** Prix de référence par véhicule et par période (XOF par défaut). */
    price: price(),
    currency: currency().optional(),
    periodicity: vine.enum(OFFER_PERIODICITIES),
    /** Absent : `inactive` (défaut en base). */
    status: vine.enum(OFFER_STATUSES).optional(),
    /** Date de commercialisation, AAAA-MM-JJ. Obligatoire pour une offre active. */
    launchedOn: vine.string().trim().regex(DATE).optional(),
    /** Nombre de véhicules ; `null` ou absent = illimité. */
    maxVehicles: maxVehicles().nullable().optional(),
    gpsHistoryDays: gpsHistoryDays().optional(),
    featureKeys: featureKeys().optional(),
  })
)

/** Tous les champs sont modifiables ; `null` efface (description, date, limite). */
export const updateOfferValidator = vine.compile(
  vine.object({
    code: code().optional(),
    name: vine.string().trim().minLength(2).maxLength(120).optional(),
    description: vine.string().trim().maxLength(2000).nullable().optional(),
    price: price().optional(),
    currency: currency().optional(),
    periodicity: vine.enum(OFFER_PERIODICITIES).optional(),
    status: vine.enum(OFFER_STATUSES).optional(),
    launchedOn: vine.string().trim().regex(DATE).nullable().optional(),
    maxVehicles: maxVehicles().nullable().optional(),
    gpsHistoryDays: gpsHistoryDays().optional(),
    featureKeys: featureKeys().optional(),
  })
)

/** GET /admin/offers */
export const listOffersValidator = vine.compile(
  vine.object({
    search: vine.string().trim().maxLength(80).optional(),
    status: vine.enum(OFFER_STATUSES).optional(),
    periodicity: vine.enum(OFFER_PERIODICITIES).optional(),
    /** Offres souscrites par cette organisation (souscription non résiliée). */
    organizationId: vine.string().uuid().optional(),
    page: vine.number().withoutDecimals().min(1).optional(),
    perPage: vine.number().withoutDecimals().min(1).max(100).optional(),
  })
)
