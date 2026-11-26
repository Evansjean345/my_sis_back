import vine from '@vinejs/vine'
import {
  FIRST_DAY_OF_WEEK,
  LAST_DAY_OF_WEEK,
} from '#domain/scheduling/code_legacy/schedule/schedule_days'
import {
  MAX_SCHEDULE_WINDOWS,
  SCHEDULE_DESCRIPTION_MAX_LENGTH,
  SCHEDULE_NAME_MAX_LENGTH,
  SCHEDULE_NAME_MIN_LENGTH,
} from '#domain/scheduling/code_legacy/schedule/schedule_limits'
import { TIME_OF_DAY_PATTERN } from '#domain/scheduling/code_legacy/schedule/schedule_time'

/**
 * Schémas des calendriers d'utilisation.
 *
 * FORME uniquement. La cohérence des plages (fin après début, pas de
 * chevauchement) et la validité du fuseau sont des règles du domaine
 * (`validateWeeklyWindows`, `assertTimeZone`) : elles produisent des codes
 * d'erreur métier stables, pas des messages de champ.
 */

/** Plage horaire : jour (0 = dimanche … 6 = samedi) et heures `HH:MM`, `24:00` admis en fin. */
const windowSchema = vine.object({
  dayOfWeek: vine.number().withoutDecimals().min(FIRST_DAY_OF_WEEK).max(LAST_DAY_OF_WEEK),
  startTime: vine.string().trim().regex(TIME_OF_DAY_PATTERN),
  endTime: vine.string().trim().regex(TIME_OF_DAY_PATTERN),
})

const scheduleFields = {
  name: vine
    .string()
    .trim()
    .minLength(SCHEDULE_NAME_MIN_LENGTH)
    .maxLength(SCHEDULE_NAME_MAX_LENGTH),
  description: vine.string().trim().maxLength(SCHEDULE_DESCRIPTION_MAX_LENGTH).optional(),
  /** Fuseau IANA. Défaut : `Africa/Abidjan`. */
  timezone: vine.string().trim().minLength(3).maxLength(64).optional(),
  isActive: vine.boolean().optional(),
  windows: vine.array(windowSchema).maxLength(MAX_SCHEDULE_WINDOWS).optional(),
}

export const createUsageScheduleValidator = vine.compile(vine.object(scheduleFields))

export const updateUsageScheduleValidator = vine.compile(
  vine.object({
    ...scheduleFields,
    name: scheduleFields.name.clone().optional(),
    /** `null` efface la description. */
    description: vine
      .string()
      .trim()
      .maxLength(SCHEDULE_DESCRIPTION_MAX_LENGTH)
      .nullable()
      .optional(),
  })
)

/** PUT /usage-schedules/:id/windows — la semaine entière, remplacée d'un bloc. */
export const replaceWindowsValidator = vine.compile(
  vine.object({
    windows: vine.array(windowSchema).maxLength(MAX_SCHEDULE_WINDOWS),
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

/**
 * Ancien champ `mode` : seules les plages autorisées existent. `allowed` est
 * encore toléré (un tableau de bord pas encore aligné l'envoie) ; `forbidden`
 * est refusé, pour qu'une interdiction ne devienne jamais en silence une
 * autorisation. À retirer quand plus aucun client n'envoie `mode`.
 */
const legacyMode = () => vine.enum(['allowed'] as const).optional()

/** Rattachement en lot, IDEMPOTENT. */
export const attachScheduleVehiclesValidator = vine.compile(
  vine.object({
    vehicleIds: vine.array(vine.string().uuid()).minLength(1),
    mode: legacyMode(),
  })
)

export const attachScheduleGroupsValidator = vine.compile(
  vine.object({
    vehicleGroupIds: vine.array(vine.string().uuid()).minLength(1),
    mode: legacyMode(),
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
