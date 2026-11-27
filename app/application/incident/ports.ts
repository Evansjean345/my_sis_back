import type {
  IncidentDraft,
  IncidentListPage,
  IncidentListQuery,
  IncidentStatusChange,
  IncidentView,
} from '#domain/incident/code_legacy/incident/incident_types'

/**
 * Ports du contexte Incidents.
 */
export interface IncidentRepository {
  list(query: IncidentListQuery): Promise<IncidentListPage>
  find(incidentId: string): Promise<IncidentView | null>
  organizationExists(organizationId: string): Promise<boolean>
  /** Véhicule vivant de cette organisation ? */
  vehicleBelongsTo(vehicleId: string, organizationId: string): Promise<boolean>
  /** Crée le dossier ; la référence `INC-AAAA-000123` est attribuée par la séquence. */
  create(draft: IncidentDraft, openedBy: string | null, at: Date): Promise<IncidentView>
  /** Applique un changement de statut déjà vérifié par le domaine. */
  changeStatus(incidentId: string, change: IncidentStatusChange): Promise<IncidentView>
}
