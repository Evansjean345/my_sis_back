/**
 * INCIDENTS — gravité (CHECK `ck_incidents_severity`, migration 007).
 */
export const INCIDENT_SEVERITIES = ['info', 'warning', 'critical'] as const
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number]
