/**
 * INCIDENTS — statuts du dossier (CHECK `ck_incidents_status`, migration 007).
 *
 *  open         ouvert, pas encore pris en charge
 *  in_progress  pris en charge (date de prise en charge renseignée)
 *  resolved     résolu : la résolution est obligatoire
 *  closed       clos : dossier archivé, plus aucun changement
 */
export const INCIDENT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

/** Dossiers encore à traiter (compteur « incidents ouverts »). */
export const ACTIVE_INCIDENT_STATUSES = [
  'open',
  'in_progress',
] as const satisfies readonly IncidentStatus[]

/**
 * Machine à états. `resolved → in_progress` rouvre un dossier dont la
 * résolution s'avère insuffisante ; `closed` est définitif.
 */
export const INCIDENT_TRANSITIONS: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: [],
}

/** Statuts qui exigent un texte de résolution (ce qui a été fait, ou pourquoi on classe). */
export const INCIDENT_STATUSES_REQUIRING_RESOLUTION = [
  'resolved',
  'closed',
] as const satisfies readonly IncidentStatus[]
