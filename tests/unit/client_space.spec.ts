import { test } from '@japa/runner'
import type { AuditLogger, ExecutionContext } from '#application/ports'
import type { IncidentRepository } from '#application/incident/ports'
import type { TripReader } from '#application/telemetry/ports'
import { OpenIncident } from '#application/incident/use_cases/open_incident'
import { ChangeIncidentStatus } from '#application/incident/use_cases/change_incident_status'
import { ListIncidents } from '#application/incident/use_cases/list_incidents'
import { BuildTripReport } from '#application/telemetry/use_cases/build_trip_report'
import {
  INCIDENT_STATUSES,
  INCIDENT_TRANSITIONS,
  type IncidentStatus,
} from '#domain/incident/code_legacy/incident/incident_statuses'
import { INCIDENT_LIST_MAX_PER_PAGE } from '#domain/incident/code_legacy/incident/incident_limits'
import type {
  IncidentDraft,
  IncidentListQuery,
  IncidentStatusChange,
  IncidentView,
} from '#domain/incident/code_legacy/incident/incident_types'
import { checkTransition, incidentReference } from '#domain/incident/incident_policy'
import type { VehicleTripStats } from '#domain/telemetry/code_legacy/trip/trip_report_types'
import { tripReportRange, tripReportTotals } from '#domain/telemetry/trip_reading_policy'

/**
 * =========================================================================
 *  ESPACE CLIENT — incidents et rapport de trajets (sans base)
 * =========================================================================
 */

const ORG = '11111111-1111-4111-8111-111111111111'
const AUTRE = '22222222-2222-4222-8222-222222222222'
const VEHICULE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NOW = new Date('2026-11-27T09:00:00.000Z')
const CONTEXTE: ExecutionContext = {
  actorId: '99999999-9999-4999-8999-999999999999',
  actorType: 'user',
  organizationId: AUTRE,
  requestId: 'test',
}

function dossier(over: Partial<IncidentView> = {}): IncidentView {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    organizationId: ORG,
    reference: 'INC-2026-000001',
    vehicle: null,
    category: 'breakdown',
    severity: 'warning',
    status: 'open',
    title: 'Panne moteur',
    description: null,
    occurredAt: NOW.toISOString(),
    openedAt: NOW.toISOString(),
    openedBy: null,
    acknowledgedAt: null,
    resolvedAt: null,
    closedAt: null,
    resolution: null,
    ...over,
  }
}

class FakeIncidents implements IncidentRepository {
  readonly listes: IncidentListQuery[] = []
  readonly crees: IncidentDraft[] = []
  readonly changements: IncidentStatusChange[] = []
  constructor(private actuel: IncidentView | null = dossier()) {}
  async list(q: IncidentListQuery) {
    this.listes.push(q)
    const counts = Object.fromEntries(INCIDENT_STATUSES.map((s) => [s, 0])) as Record<
      IncidentStatus,
      number
    >
    return { data: [], meta: { total: 0, page: q.page, perPage: q.perPage, counts } }
  }
  async find() {
    return this.actuel
  }
  async organizationExists(id: string) {
    return id === ORG
  }
  async vehicleBelongsTo(vehicleId: string, organizationId: string) {
    return vehicleId === VEHICULE && organizationId === ORG
  }
  async create(draft: IncidentDraft) {
    this.crees.push(draft)
    return dossier({ title: draft.title })
  }
  async changeStatus(_id: string, c: IncidentStatusChange) {
    this.changements.push(c)
    this.actuel = dossier({ ...this.actuel!, status: c.status, resolution: c.resolution })
    return this.actuel
  }
}

function audit() {
  const actions: string[] = []
  const logger: AuditLogger = { record: async (e) => void actions.push(e.action) }
  return { logger, actions }
}

const brouillon = (over: Partial<IncidentDraft> = {}): IncidentDraft => ({
  organizationId: ORG,
  vehicleId: null,
  category: 'breakdown',
  severity: 'warning',
  title: 'Panne moteur',
  description: null,
  occurredAt: NOW,
  ...over,
})

// =========================================================================

test.group('incidents · règles', () => {
  test('référence lisible INC-AAAA-000123', ({ assert }) => {
    assert.equal(incidentReference(2026, 123), 'INC-2026-000123')
    assert.equal(incidentReference(2027, 1_234_567), 'INC-2027-1234567')
  })

  test('machine à états : un dossier clos ne bouge plus', ({ assert }) => {
    assert.deepEqual([...INCIDENT_TRANSITIONS.closed], [])
    const r = checkTransition({
      from: 'closed',
      to: 'open',
      resolution: null,
      currentResolution: 'x',
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_INVALID_INCIDENT_TRANSITION')
  })

  test('résoudre ou classer exige une résolution', ({ assert }) => {
    for (const to of ['resolved', 'closed'] as const) {
      const r = checkTransition({ from: 'open', to, resolution: '  ', currentResolution: null })
      assert.isFalse(r.ok, to)
      if (!r.ok) assert.equal(r.error.code, 'E_INCIDENT_RESOLUTION_REQUIRED')
    }
    const ok = checkTransition({
      from: 'in_progress',
      to: 'resolved',
      resolution: ' Remorqué au garage ',
      currentResolution: null,
    })
    assert.isTrue(ok.ok)
    if (ok.ok) assert.equal(ok.value.resolution, 'Remorqué au garage')
  })

  test('clore un dossier résolu garde sa résolution ; rouvrir l’efface', ({ assert }) => {
    const cloture = checkTransition({
      from: 'resolved',
      to: 'closed',
      resolution: null,
      currentResolution: 'Pièce changée',
    })
    if (cloture.ok) assert.equal(cloture.value.resolution, 'Pièce changée')
    const reouverture = checkTransition({
      from: 'resolved',
      to: 'in_progress',
      resolution: null,
      currentResolution: 'Pièce changée',
    })
    assert.isTrue(reouverture.ok)
    if (reouverture.ok) assert.isNull(reouverture.value.resolution)
  })
})

test.group('incidents · cas d’usage', () => {
  test('ouverture : véhicule d’un autre client refusé', async ({ assert }) => {
    const repo = new FakeIncidents()
    const r = await new OpenIncident(repo, { now: () => NOW }, audit().logger).execute({
      context: CONTEXTE,
      draft: brouillon({ vehicleId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_INCIDENT_VEHICLE_OUT_OF_SCOPE')
    assert.lengthOf(repo.crees, 0)
  })

  test('ouverture : dossier créé et tracé dans l’organisation du dossier', async ({ assert }) => {
    const repo = new FakeIncidents()
    const traces: Array<{ action: string; org: string | null }> = []
    const r = await new OpenIncident(
      repo,
      { now: () => NOW },
      { record: async (e) => void traces.push({ action: e.action, org: e.context.organizationId }) }
    ).execute({ context: CONTEXTE, draft: brouillon({ vehicleId: VEHICULE }) })
    assert.isTrue(r.ok)
    assert.deepEqual(traces, [{ action: 'incident.opened', org: ORG }])
  })

  test('ouverture : organisation inconnue', async ({ assert }) => {
    const r = await new OpenIncident(
      new FakeIncidents(),
      { now: () => NOW },
      audit().logger
    ).execute({ context: CONTEXTE, draft: brouillon({ organizationId: AUTRE }) })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_NOT_FOUND')
  })

  test('changement de statut : hors périmètre = introuvable', async ({ assert }) => {
    const repo = new FakeIncidents()
    const r = await new ChangeIncidentStatus(repo, { now: () => NOW }, audit().logger).execute({
      context: CONTEXTE,
      scopeOrganizationId: AUTRE,
      incidentId: dossier().id,
      status: 'in_progress',
    })
    assert.isFalse(r.ok)
    assert.lengthOf(repo.changements, 0)
  })

  test('prise en charge puis résolution, tracées', async ({ assert }) => {
    const repo = new FakeIncidents()
    const { logger, actions } = audit()
    const use = new ChangeIncidentStatus(repo, { now: () => NOW }, logger)
    await use.execute({
      context: CONTEXTE,
      scopeOrganizationId: null,
      incidentId: dossier().id,
      status: 'in_progress',
    })
    const r = await use.execute({
      context: CONTEXTE,
      scopeOrganizationId: null,
      incidentId: dossier().id,
      status: 'resolved',
      resolution: 'Batterie remplacée',
    })
    assert.isTrue(r.ok)
    assert.deepEqual(actions, ['incident.in_progress', 'incident.resolved'])
    assert.equal(repo.changements[1].resolution, 'Batterie remplacée')
    assert.equal(repo.changements[1].at.getTime(), NOW.getTime())
  })

  test('liste : bornes de pagination', async ({ assert }) => {
    const repo = new FakeIncidents()
    await new ListIncidents(repo).execute({ organizationId: ORG, perPage: 10_000, page: 0 })
    assert.equal(repo.listes[0].perPage, INCIDENT_LIST_MAX_PER_PAGE)
    assert.equal(repo.listes[0].page, 1)
  })
})

// =========================================================================

const ligne = (over: Partial<VehicleTripStats>): VehicleTripStats => ({
  vehicleId: VEHICULE,
  registration: '1001 KN 01',
  trips: 0,
  distanceKm: 0,
  drivingSeconds: 0,
  idleSeconds: 0,
  maxSpeedKph: null,
  avgSpeedKph: null,
  lastTripAt: null,
  ...over,
})

test.group('rapport de trajets', () => {
  test('période : un trimestre au plus', ({ assert }) => {
    assert.isTrue(tripReportRange(new Date('2026-09-01'), new Date('2026-11-30')).ok)
    const r = tripReportRange(new Date('2026-06-01'), new Date('2026-11-30'))
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.details.maxDays, 93)
  })

  test('totaux : véhicules actifs, kilomètres, vitesse maximale', ({ assert }) => {
    const t = tripReportTotals([
      ligne({ trips: 3, distanceKm: 12.34, drivingSeconds: 1800, maxSpeedKph: 80 }),
      ligne({ trips: 1, distanceKm: 4.5, drivingSeconds: 600, maxSpeedKph: 95 }),
      ligne({}),
    ])
    assert.deepEqual(
      { ...t },
      {
        trips: 4,
        distanceKm: 16.8,
        drivingSeconds: 2400,
        idleSeconds: 0,
        maxSpeedKph: 95,
        activeVehicles: 2,
        vehicles: 3,
      }
    )
  })

  test('cas d’usage : période refusée avant toute lecture', async ({ assert }) => {
    let lu = false
    const reader = {
      organizationExists: async () => true,
      vehicleStats: async () => {
        lu = true
        return []
      },
    } as unknown as TripReader
    const r = await new BuildTripReport(reader).execute({
      organizationId: ORG,
      from: new Date('2026-01-01'),
      to: new Date('2026-11-30'),
    })
    assert.isFalse(r.ok)
    assert.isFalse(lu)
  })
})
