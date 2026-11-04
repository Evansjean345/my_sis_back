import vine from '@vinejs/vine'

/**
 * Schémas des conducteurs (migration 018).
 *
 * Les règles structurelles restent en base : unicité du permis et du
 * matricule par organisation, format du téléphone (E.164), cloisonnement
 * conducteur ↔ véhicule (trigger).
 */

export const DRIVER_STATUS = ['active', 'inactive', 'suspended'] as const

/** Catégories du permis de conduire ivoirien. */
export const LICENSE_CATEGORIES = ['A', 'A1', 'B', 'C', 'D', 'E', 'F'] as const

const E164 = /^\+[1-9][0-9]{7,14}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

const driverFields = {
  firstName: vine.string().trim().minLength(1).maxLength(60),
  lastName: vine.string().trim().minLength(1).maxLength(60),
  phone: vine.string().trim().regex(E164).optional(),
  email: vine.string().trim().email().maxLength(120).optional(),
  employeeCode: vine.string().trim().minLength(1).maxLength(40).optional(),
  licenseNumber: vine.string().trim().minLength(3).maxLength(40).optional(),
  licenseCategories: vine.array(vine.enum(LICENSE_CATEGORIES)).distinct().optional(),
  /** AAAA-MM-JJ */
  licenseExpiresOn: vine.string().trim().regex(DATE).optional(),
  status: vine.enum(DRIVER_STATUS).optional(),
  /** Véhicule rattaché — doit appartenir à la même organisation. */
  vehicleId: vine.string().uuid().optional(),
  notes: vine.string().trim().maxLength(500).optional(),
}

export const createDriverValidator = vine.compile(vine.object(driverFields))

/** Champs facultatifs ; `null` efface (véhicule, téléphone, e-mail, permis…). */
export const updateDriverValidator = vine.compile(
  vine.object({
    firstName: driverFields.firstName.clone().optional(),
    lastName: driverFields.lastName.clone().optional(),
    phone: vine.string().trim().regex(E164).nullable().optional(),
    email: vine.string().trim().email().maxLength(120).nullable().optional(),
    employeeCode: vine.string().trim().minLength(1).maxLength(40).nullable().optional(),
    licenseNumber: vine.string().trim().minLength(3).maxLength(40).nullable().optional(),
    licenseCategories: vine.array(vine.enum(LICENSE_CATEGORIES)).distinct().optional(),
    licenseExpiresOn: vine.string().trim().regex(DATE).nullable().optional(),
    status: vine.enum(DRIVER_STATUS).optional(),
    vehicleId: vine.string().uuid().nullable().optional(),
    notes: vine.string().trim().maxLength(500).nullable().optional(),
  })
)

/** PUT /drivers/:id/vehicle — `null` détache le conducteur de son véhicule. */
export const assignDriverVehicleValidator = vine.compile(
  vine.object({
    vehicleId: vine.string().uuid().nullable(),
  })
)

const listFields = {
  page: vine.number().min(1).optional(),
  perPage: vine.number().min(1).max(100).optional(),
  /** Nom, matricule ou numéro de permis. */
  search: vine.string().trim().minLength(1).maxLength(80).optional(),
  status: vine.enum(DRIVER_STATUS).optional(),
  vehicleId: vine.string().uuid().optional(),
  driverGroupId: vine.string().uuid().optional(),
  /** `true` : seulement les conducteurs sans véhicule. */
  unassigned: vine.boolean().optional(),
}

export const listDriversValidator = vine.compile(vine.object(listFields))

export const adminListDriversValidator = vine.compile(
  vine.object({ ...listFields, organizationId: vine.string().uuid().optional() })
)
