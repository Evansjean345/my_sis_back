import db from '@adonisjs/lucid/services/db'
import type { IncidentRepository } from '#application/incident/ports'
import type { IncidentCategory } from '#domain/incident/code_legacy/incident/incident_categories'
import type { IncidentSeverity } from '#domain/incident/code_legacy/incident/incident_severities'
import {
  INCIDENT_STATUSES,
  type IncidentStatus,
} from '#domain/incident/code_legacy/incident/incident_statuses'
import type {
  IncidentDraft,
  IncidentListPage,
  IncidentListQuery,
  IncidentStatusChange,
  IncidentView,
} from '#domain/incident/code_legacy/incident/incident_types'
import { incidentReference } from '#domain/incident/incident_policy'

const COLONNES = `
  i.id, i.organization_id, i.reference, i.vehicle_id, v.registration,
  i.category, i.severity, i.status, i.title, i.description,
  i.occurred_at, i.opened_at, i.opened_by, u.full_name AS opened_by_name,
  i.acknowledged_at, i.resolved_at, i.closed_at, i.resolution`

const JOINTURES = `
  FROM incidents i
  LEFT JOIN vehicles v ON v.id = i.vehicle_id
  LEFT JOIN users u    ON u.id = i.opened_by`

const iso = (v: unknown): string => new Date(v as string).toISOString()
const isoOrNull = (v: unknown): string | null => (v ? iso(v) : null)

function toView(r: Record<string, unknown>): IncidentView {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    reference: String(r.reference),
    vehicle: r.vehicle_id
      ? { id: String(r.vehicle_id), registration: String(r.registration ?? '') }
      : null,
    category: r.category as IncidentCategory,
    severity: r.severity as IncidentSeverity,
    status: r.status as IncidentStatus,
    title: String(r.title),
    description: (r.description as string | null) ?? null,
    occurredAt: iso(r.occurred_at),
    openedAt: iso(r.opened_at),
    openedBy: r.opened_by
      ? { id: String(r.opened_by), fullName: String(r.opened_by_name ?? '') }
      : null,
    acknowledgedAt: isoOrNull(r.acknowledged_at),
    resolvedAt: isoOrNull(r.resolved_at),
    closedAt: isoOrNull(r.closed_at),
    resolution: (r.resolution as string | null) ?? null,
  }
}

/**
 * Dossiers d'incidents (table `incidents`, migration 007).
 *
 * Liste : filtres du périmètre et compteurs par statut en deux requêtes
 * (les compteurs ignorent le filtre de statut : ils alimentent les onglets).
 * Références : séquence `incidents_reference_seq`, format du domaine.
 */
export class LucidIncidentRepository implements IncidentRepository {
  async list(q: IncidentListQuery): Promise<IncidentListPage> {
    const perimetre: string[] = ['TRUE']
    const params: Record<string, unknown> = {}
    if (q.organizationId) {
      perimetre.push('i.organization_id = :org')
      params.org = q.organizationId
    }
    if (q.severity) {
      perimetre.push('i.severity = :severity')
      params.severity = q.severity
    }
    if (q.category) {
      perimetre.push('i.category = :category')
      params.category = q.category
    }
    if (q.search) {
      perimetre.push(
        '(i.title ILIKE :search OR i.reference ILIKE :search OR v.registration ILIKE :search)'
      )
      params.search = `%${q.search}%`
    }
    const filtres = q.status ? [...perimetre, 'i.status = :status'] : perimetre

    const [lignes, compteurs] = await Promise.all([
      db.rawQuery(
        `SELECT ${COLONNES}, count(*) OVER () AS total ${JOINTURES}
          WHERE ${filtres.join(' AND ')}
          ORDER BY i.opened_at DESC, i.id
          LIMIT :limit OFFSET :offset`,
        {
          ...params,
          ...(q.status ? { status: q.status } : {}),
          limit: q.perPage,
          offset: (q.page - 1) * q.perPage,
        }
      ),
      db.rawQuery(
        `SELECT i.status, count(*) AS n ${JOINTURES}
          WHERE ${perimetre.join(' AND ')}
          GROUP BY i.status`,
        params
      ),
    ])

    const rows = (lignes.rows ?? []) as Record<string, unknown>[]
    const counts = Object.fromEntries(INCIDENT_STATUSES.map((s) => [s, 0])) as Record<
      IncidentStatus,
      number
    >
    for (const c of (compteurs.rows ?? []) as Record<string, unknown>[]) {
      counts[c.status as IncidentStatus] = Number(c.n)
    }
    return {
      data: rows.map(toView),
      meta: { total: Number(rows[0]?.total ?? 0), page: q.page, perPage: q.perPage, counts },
    }
  }

  async find(incidentId: string): Promise<IncidentView | null> {
    const r = await db.rawQuery(`SELECT ${COLONNES} ${JOINTURES} WHERE i.id = :id`, {
      id: incidentId,
    })
    const l = (r.rows ?? [])[0] as Record<string, unknown> | undefined
    return l ? toView(l) : null
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    const l = await db
      .from('organizations')
      .where('id', organizationId)
      .whereNull('deleted_at')
      .select('id')
      .first()
    return Boolean(l)
  }

  async vehicleBelongsTo(vehicleId: string, organizationId: string): Promise<boolean> {
    const l = await db
      .from('vehicles')
      .where('id', vehicleId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id')
      .first()
    return Boolean(l)
  }

  async create(draft: IncidentDraft, openedBy: string | null, at: Date): Promise<IncidentView> {
    const id = await db.transaction(async (trx) => {
      const seq = await trx.rawQuery(`SELECT nextval('incidents_reference_seq') AS n`)
      const reference = incidentReference(at.getUTCFullYear(), Number(seq.rows[0].n))
      const [ligne] = await trx
        .table('incidents')
        .insert({
          organization_id: draft.organizationId,
          reference,
          vehicle_id: draft.vehicleId,
          category: draft.category,
          severity: draft.severity,
          status: 'open',
          title: draft.title,
          description: draft.description,
          occurred_at: draft.occurredAt.toISOString(),
          opened_at: at.toISOString(),
          opened_by: openedBy,
        })
        .returning('id')
      return String(typeof ligne === 'object' ? ligne.id : ligne)
    })
    return (await this.find(id))!
  }

  async changeStatus(incidentId: string, c: IncidentStatusChange): Promise<IncidentView> {
    const at = c.at.toISOString()
    const champs: Record<string, unknown> = {
      status: c.status,
      // Toute avancée vaut prise en charge, si elle n'a pas déjà eu lieu.
      acknowledged_at: db.raw('COALESCE(acknowledged_at, ?)', [at]),
    }
    if (c.status === 'in_progress') {
      // Réouverture d'un dossier résolu : la résolution précédente ne vaut plus.
      Object.assign(champs, { resolved_at: null, resolved_by: null, resolution: null })
    }
    if (c.status === 'resolved') {
      Object.assign(champs, { resolved_at: at, resolved_by: c.actorId, resolution: c.resolution })
    }
    if (c.status === 'closed') {
      Object.assign(champs, { closed_at: at, resolution: c.resolution })
    }
    await db.from('incidents').where('id', incidentId).update(champs)
    return (await this.find(incidentId))!
  }
}
