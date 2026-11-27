import type { IncidentCategory } from '#domain/incident/code_legacy/incident/incident_categories'
import type { IncidentSeverity } from '#domain/incident/code_legacy/incident/incident_severities'
import type { IncidentStatus } from '#domain/incident/code_legacy/incident/incident_statuses'

/**
 * =========================================================================
 *  INCIDENTS — interfaces (référentiel en dur)
 * =========================================================================
 */

/** Un dossier d'incident, tel que listé et affiché. */
export interface IncidentView {
  readonly id: string
  readonly organizationId: string
  readonly reference: string
  readonly vehicle: { readonly id: string; readonly registration: string } | null
  readonly category: IncidentCategory
  readonly severity: IncidentSeverity
  readonly status: IncidentStatus
  readonly title: string
  readonly description: string | null
  readonly occurredAt: string
  readonly openedAt: string
  readonly openedBy: { readonly id: string; readonly fullName: string } | null
  readonly acknowledgedAt: string | null
  readonly resolvedAt: string | null
  readonly closedAt: string | null
  readonly resolution: string | null
}

/** Recherche de dossiers. `organizationId: null` : toutes les organisations (exploitant). */
export interface IncidentListQuery {
  readonly organizationId: string | null
  readonly status?: IncidentStatus
  readonly severity?: IncidentSeverity
  readonly category?: IncidentCategory
  readonly search?: string
  readonly page: number
  readonly perPage: number
}

export interface IncidentListPage {
  readonly data: IncidentView[]
  readonly meta: {
    readonly total: number
    readonly page: number
    readonly perPage: number
    /** Dossiers du périmètre par statut, indépendamment du filtre de statut. */
    readonly counts: Readonly<Record<IncidentStatus, number>>
  }
}

/** Ouverture d'un dossier. */
export interface IncidentDraft {
  readonly organizationId: string
  readonly vehicleId: string | null
  readonly category: IncidentCategory
  readonly severity: IncidentSeverity
  readonly title: string
  readonly description: string | null
  readonly occurredAt: Date
}

/** Changement de statut, avec les dates qu'il renseigne. */
export interface IncidentStatusChange {
  readonly status: IncidentStatus
  readonly resolution: string | null
  readonly actorId: string | null
  readonly at: Date
}
