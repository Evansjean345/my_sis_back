import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import {
  LIVE_MAX_FOLLOWED_VEHICLES,
  TRIP_LIST_MAX_PER_PAGE,
  TRIP_POINTS_MAX_LIMIT,
} from '#domain/telemetry/code_legacy/trip/trip_reading_limits'
import { TRIP_STATUSES } from '#domain/telemetry/value_objects'

/**
 * Charges utiles des demandes Socket.IO (espace `/trips`).
 *
 * FORME uniquement, comme pour les routes HTTP : la cohérence de la période
 * et les bornes de lecture sont des règles du domaine (`trip_reading_policy`).
 */

/** Instant ISO 8601 lisible (`2026-11-26T08:00:00Z`). */
const isoInstant = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  if (Number.isNaN(Date.parse(value))) {
    field.report('Le champ {{ field }} doit être une date ISO 8601', 'isoInstant', field)
  }
})
const instant = () => vine.string().trim().maxLength(40).use(isoInstant())

export const listTripsValidator = vine.compile(
  vine.object({
    from: instant(),
    to: instant(),
    vehicleId: vine.string().uuid().optional(),
    status: vine.enum(TRIP_STATUSES).optional(),
    page: vine.number().withoutDecimals().min(1).optional(),
    perPage: vine.number().withoutDecimals().min(1).max(TRIP_LIST_MAX_PER_PAGE).optional(),
    /** Exploitant de la plateforme seulement : restreint la liste à une organisation. */
    organizationId: vine.string().uuid().optional(),
  })
)

export const getTripValidator = vine.compile(vine.object({ tripId: vine.string().uuid() }))

export const tripPointsValidator = vine.compile(
  vine.object({
    tripId: vine.string().uuid(),
    /** `nextCursor` de la page précédente. */
    after: instant().optional(),
    limit: vine.number().withoutDecimals().min(1).max(TRIP_POINTS_MAX_LIMIT).optional(),
  })
)

export const vehiclesValidator = vine.compile(
  vine.object({
    vehicleIds: vine.array(vine.string().uuid()).minLength(1).maxLength(LIVE_MAX_FOLLOWED_VEHICLES),
  })
)

export const organizationValidator = vine.compile(
  vine.object({ organizationId: vine.string().uuid() })
)
