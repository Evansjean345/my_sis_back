import { Ok, type DomainError, type Result } from '#domain/kernel'
import type { UseCase } from '#application/ports'
import type { IncidentRepository } from '#application/incident/ports'
import {
  INCIDENT_LIST_DEFAULT_PER_PAGE,
  INCIDENT_LIST_MAX_PER_PAGE,
} from '#domain/incident/code_legacy/incident/incident_limits'
import type {
  IncidentListPage,
  IncidentListQuery,
} from '#domain/incident/code_legacy/incident/incident_types'

export type ListIncidentsInput = Omit<IncidentListQuery, 'page' | 'perPage'> & {
  page?: number
  perPage?: number
}

/** CAS D'USAGE — Lister les incidents d'un périmètre, les plus récents d'abord. */
export class ListIncidents implements UseCase<ListIncidentsInput, IncidentListPage> {
  constructor(private readonly incidents: IncidentRepository) {}

  async execute(input: ListIncidentsInput): Promise<Result<IncidentListPage, DomainError>> {
    return Ok(
      await this.incidents.list({
        ...input,
        page: Math.max(1, Math.trunc(input.page ?? 1)),
        perPage: Math.min(
          Math.max(1, Math.trunc(input.perPage ?? INCIDENT_LIST_DEFAULT_PER_PAGE)),
          INCIDENT_LIST_MAX_PER_PAGE
        ),
      })
    )
  }
}
