import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { SCHEDULE_MODES } from '#domain/scheduling/value_objects'

/**
 * Schémas des calendriers d'utilisation.
 *
 * FORME uniquement. La cohérence des plages (fin après début, pas de
 * chevauchement) et la validité du fuseau sont des règles du domaine
 * (`validateWeeklyWindows`, `assertTimeZone`) : elles produisent des codes
 * d'erreur métier stables, pas des messages de champ.
 */

/** `HH:MM` ou `HH:MM:SS`, `24:00` admis comme fin de journée. */
const TIME = /^([01]\d|2[0-4]):[0-5]\d(:[0-5]\d)?$/

/** Une semaine complète tient largement en 100 plages. */
const MAX_WINDOWS = 100

const isoInstant = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  if (Number.isNaN(Date.parse(value))) {
    field.report('Le champ {{ field }} doit être une date ISO 8601', 'isoInstant', field)
  }
})

const windowSchema = vine.object({
  /** 0 = dimanche … 6 = samedi (convention PostgreSQL `EXTRACT(DOW)`). */
  dayOfWeek: vine.number().withoutDecimals().min(0).max(6),
  startTime: vine.string().trim().regex(TIME),
  endTime: vine.string().trim().regex(TIME),
})

const scheduleFields = {
  name: vine.string().trim().minLength(2).maxLength(80),
  description: vine.string().trim().maxLength(300).optional(),
  /** Fuseau IANA. Défaut : `Africa/Abidjan`. */
  timezone: vine.string().trim().minLength(3).maxLength(64).optional(),
  isActive: vine.boolean().optional(),
  windows: vine.array(windowSchema).maxLength(MAX_WINDOWS).optional(),
}

export const createUsageScheduleValidator = vine.compile(vine.object(scheduleFields))

export const updateUsageScheduleValidator = vine.compile(
  vine.object({
    ...scheduleFields,
    name: scheduleFields.name.clone().optional(),
    /** `null` efface la description. */
    description: vine.string().trim().maxLength(300).nullable().optional(),
  })
)

/** PUT /usage-schedules/:id/windows — la semaine entière, remplacée d'un bloc. */
export const replaceWindowsValidator = vine.compile(
  vine.object({
    windows: vine.array(windowSchema).maxLength(MAX_WINDOWS),
  })
)

export const listUsageSchedulesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    search: vine.string().trim().minLength(1).maxLength(80).optional(),
    isActive: vine.boolean().optional(),
  })
)

export const adminListUsageSchedulesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    search: vine.string().trim().minLength(1).maxLength(80).optional(),
    isActive: vine.boolean().optional(),
    organizationId: vine.string().uuid().optional(),
  })
)

/** Rattachement en lot, IDEMPOTENT ; le mode par défaut est `allowed`. */
export const attachScheduleVehiclesValidator = vine.compile(
  vine.object({
    vehicleIds: vine.array(vine.string().uuid()).minLength(1),
    mode: vine.enum(SCHEDULE_MODES).optional(),
  })
)

export const attachScheduleGroupsValidator = vine.compile(
  vine.object({
    vehicleGroupIds: vine.array(vine.string().uuid()).minLength(1),
    mode: vine.enum(SCHEDULE_MODES).optional(),
  })
)

/** Simulation : « que déciderait le moteur à tel instant ? ». */
export const previewScheduleValidator = vine.compile(
  vine.object({
    at: vine.string().trim().maxLength(40).use(isoInstant()).optional(),
  })
)

/**
 * Analyses de l'historique réel : dates civiles incluses (AAAA-MM-JJ), lues
 * dans `timezone` (défaut Africa/Abidjan). La cohérence de la période est
 * vérifiée par le contrôleur (E_INVALID_ANALYTICS_RANGE).
 */
const analyticsFields = {
  from: vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  to: vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: vine.string().trim().maxLength(64).optional(),
}

export const scheduleAnalyticsValidator = vine.compile(vine.object(analyticsFields))

export const adminScheduleAnalyticsValidator = vine.compile(
  vine.object({ ...analyticsFields, organizationId: vine.string().uuid().optional() })
)

/** Coupure / rétablissement de TOUT un groupe : motif obligatoire (CM-08). */
export const groupEngineCommandValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().minLength(5).maxLength(500),
  })
)
