import vine from '@vinejs/vine'
import { INCIDENT_CATEGORIES } from '#domain/incident/code_legacy/incident/incident_categories'
import {
  INCIDENT_DESCRIPTION_MAX_LENGTH,
  INCIDENT_LIST_MAX_PER_PAGE,
  INCIDENT_RESOLUTION_MAX_LENGTH,
  INCIDENT_TITLE_MAX_LENGTH,
  INCIDENT_TITLE_MIN_LENGTH,
} from '#domain/incident/code_legacy/incident/incident_limits'
import { INCIDENT_SEVERITIES } from '#domain/incident/code_legacy/incident/incident_severities'
import { INCIDENT_STATUSES } from '#domain/incident/code_legacy/incident/incident_statuses'

/**
 * Incidents — FORME des requêtes. La machine à états et l'exigence de
 * résolution sont des règles du domaine (`incident_policy`).
 */

export const listIncidentsValidator = vine.compile(
  vine.object({
    organizationId: vine.string().uuid().optional(),
    status: vine.enum(INCIDENT_STATUSES).optional(),
    severity: vine.enum(INCIDENT_SEVERITIES).optional(),
    category: vine.enum(INCIDENT_CATEGORIES).optional(),
    search: vine.string().trim().minLength(1).maxLength(80).optional(),
    page: vine.number().withoutDecimals().min(1).optional(),
    perPage: vine.number().withoutDecimals().min(1).max(INCIDENT_LIST_MAX_PER_PAGE).optional(),
  })
)

export const openIncidentValidator = vine.compile(
  vine.object({
    organizationId: vine.string().uuid(),
    title: vine
      .string()
      .trim()
      .minLength(INCIDENT_TITLE_MIN_LENGTH)
      .maxLength(INCIDENT_TITLE_MAX_LENGTH),
    category: vine.enum(INCIDENT_CATEGORIES),
    severity: vine.enum(INCIDENT_SEVERITIES),
    vehicleId: vine.string().uuid().nullable().optional(),
    description: vine
      .string()
      .trim()
      .maxLength(INCIDENT_DESCRIPTION_MAX_LENGTH)
      .nullable()
      .optional(),
    /** Absent : maintenant. */
    occurredAt: vine.date({ formats: { utc: true } }).optional(),
  })
)

export const changeIncidentStatusValidator = vine.compile(
  vine.object({
    status: vine.enum(INCIDENT_STATUSES),
    resolution: vine
      .string()
      .trim()
      .maxLength(INCIDENT_RESOLUTION_MAX_LENGTH)
      .nullable()
      .optional(),
  })
)
