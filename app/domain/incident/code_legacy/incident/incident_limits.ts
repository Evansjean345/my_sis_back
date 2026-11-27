/**
 * INCIDENTS — formats et limites.
 */

/** Référence lisible : `INC-2026-000123` (séquence `incidents_reference_seq`). */
export const INCIDENT_REFERENCE_PREFIX = 'INC'
export const INCIDENT_REFERENCE_DIGITS = 6

export const INCIDENT_TITLE_MIN_LENGTH = 3
export const INCIDENT_TITLE_MAX_LENGTH = 160
export const INCIDENT_DESCRIPTION_MAX_LENGTH = 2000
export const INCIDENT_RESOLUTION_MIN_LENGTH = 5
export const INCIDENT_RESOLUTION_MAX_LENGTH = 2000

export const INCIDENT_LIST_DEFAULT_PER_PAGE = 25
export const INCIDENT_LIST_MAX_PER_PAGE = 100
