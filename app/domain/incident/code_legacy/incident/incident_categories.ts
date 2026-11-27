/**
 * INCIDENTS — catégories (CHECK `ck_incidents_category`, migration 007).
 */
export const INCIDENT_CATEGORIES = [
  'theft',
  'accident',
  'breakdown',
  'speeding',
  'unauthorized_use',
  'geofence_breach',
  'device_issue',
  'other',
] as const
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number]
