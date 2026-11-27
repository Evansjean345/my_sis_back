import { test } from '@japa/runner'
import type { TransactionScope } from '#domain/kernel'
import type {
  IngestMessageRepository,
  PositionRepository,
  TripRepository,
} from '#domain/telemetry/repositories/telemetry_repositories'
import type { NormalizedReading } from '#domain/telemetry/entities/telemetry_reading'
import type { Trip } from '#domain/telemetry/entities/trip'
import type {
  DeviceResolver,
  RealtimeBroadcaster,
  TelemetryFrame,
  TripPointsQuery,
  TripReader,
} from '#application/telemetry/ports'
import type {
  TripListQuery,
  TripLiveUpdate,
  TripPoint,
  TripSummary,
} from '#domain/telemetry/code_legacy/trip/trip_reading_types'
import {
  LIVE_MAX_FOLLOWED_VEHICLES,
  TRIP_LIST_MAX_PER_PAGE,
  TRIP_POINTS_MAX_LIMIT,
} from '#domain/telemetry/code_legacy/trip/trip_reading_limits'
import { TRIP_LIVE_UPDATE_TYPES } from '#domain/telemetry/code_legacy/trip/trip_live_events'
import {
  canReadOrganization,
  followCapacity,
  tripPointsLimit,
  tripRange,
  tripsPerPage,
} from '#domain/telemetry/trip_reading_policy'
import { ListTrips } from '#application/telemetry/use_cases/list_trips'
import { GetTrip } from '#application/telemetry/use_cases/get_trip'
import { ReadTripPoints } from '#application/telemetry/use_cases/read_trip_points'
import { FollowVehicles } from '#application/telemetry/use_cases/follow_vehicles'
import { IngestTelemetryFrames } from '#application/telemetry/use_cases/ingest_telemetry_frames'
import { CompositeBroadcaster } from '#infrastructure/realtime/composite_broadcaster'
import { TRIP_SERVER_EVENTS, tripRooms } from '#infrastructure/realtime/socket/socket_contract'

/**
 * =========================================================================
 *  LECTURE ET SUIVI DES TRAJETS — sans base, sans Redis, sans Socket.IO
 * =========================================================================
 */

const ORG = '11111111-1111-4111-8111-111111111111'
const AUTRE = '22222222-2222-4222-8222-222222222222'
const VEHICULE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const BOITIER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TRAJET = '44444444-4444-4444-8444-444444444444'
const d = (iso: string) => new Date(iso)

function resume(over: Partial<TripSummary> = {}): TripSummary {
  return {
    id: TRAJET,
    organizationId: ORG,
    vehicleId: VEHICULE,
    registration: '1001 KN 01',
    deviceId: BOITIER,
    status: 'closed',
    startedAt: '2026-11-25T08:00:00.000Z',
    endedAt: '2026-11-25T08:10:00.000Z',
    lastPointAt: '2026-11-25T08:10:00.000Z',
    startLocation: null,
    endLocation: null,
    startAddress: null,
    endAddress: null,
    distanceMeters: 1000,
    durationSeconds: 600,
    idleSeconds: 0,
    maxSpeedKph: 50,
    avgSpeedKph: 30,
    positionsCount: 11,
    closeReason: 'ignition_off',
    ...over,
  }
}

/** Lecteur en mémoire : 11 points, un par minute. */
class FakeReader implements TripReader {
  readonly listes: TripListQuery[] = []
  readonly lectures: TripPointsQuery[] = []
  constructor(
    private readonly trajet: TripSummary | null = resume(),
    private readonly vehicules: Record<string, string> = { [VEHICULE]: ORG }
  ) {}
  async list(q: TripListQuery) {
    this.listes.push(q)
    return { data: [], meta: { total: 0, page: q.page, perPage: q.perPage } }
  }
  async find(id: string) {
    return this.trajet?.id === id ? this.trajet : null
  }
  async points(q: TripPointsQuery): Promise<TripPoint[]> {
    this.lectures.push(q)
    const tous = Array.from({ length: 11 }, (_, i) => ({
      recordedAt: new Date(Date.UTC(2026, 10, 25, 8, i)).toISOString(),
      latitude: 5.3,
      longitude: -4,
      speedKph: 30,
      headingDeg: null,
      ignition: true,
    }))
    return tous.filter((p) => !q.after || new Date(p.recordedAt) > q.after).slice(0, q.limit)
  }
  async vehiclesInScope(scope: { organizationId: string | null }, ids: readonly string[]) {
    return ids.filter(
      (id) =>
        this.vehicules[id] && (!scope.organizationId || this.vehicules[id] === scope.organizationId)
    )
  }
  async organizationExists() {
    return true
  }
  async vehicleStats() {
    return []
  }
}

// =========================================================================

test.group('trajets · règles de lecture', () => {
  test('période : début avant fin, 31 jours au plus', ({ assert }) => {
    assert.isTrue(tripRange(d('2026-11-01T00:00:00Z'), d('2026-11-30T00:00:00Z')).ok)
    for (const [from, to] of [
      ['2026-11-30T00:00:00Z', '2026-11-01T00:00:00Z'],
      ['2026-10-01T00:00:00Z', '2026-11-30T00:00:00Z'],
      ['pas une date', '2026-11-30T00:00:00Z'],
    ]) {
      const r = tripRange(d(from), d(to))
      assert.isFalse(r.ok, `${from} → ${to}`)
      if (!r.ok) assert.equal(r.error.code, 'E_INVALID_TRIP_RANGE')
    }
  })

  test('bornes : par page et points par page', ({ assert }) => {
    assert.equal(tripsPerPage(), 25)
    assert.equal(tripsPerPage(10_000), TRIP_LIST_MAX_PER_PAGE)
    assert.equal(tripsPerPage(0), 1)
    assert.equal(tripPointsLimit(), 500)
    assert.equal(tripPointsLimit(99_999), TRIP_POINTS_MAX_LIMIT)
    assert.equal(followCapacity(LIVE_MAX_FOLLOWED_VEHICLES + 5), 0)
  })

  test("cloisonnement : sa propre organisation, ou toutes pour l'exploitant", ({ assert }) => {
    assert.isTrue(canReadOrganization({ organizationId: ORG }, ORG))
    assert.isFalse(canReadOrganization({ organizationId: ORG }, AUTRE))
    assert.isTrue(canReadOrganization({ organizationId: null }, AUTRE))
  })

  test('contrat : trois mises à jour en direct, une salle par véhicule', ({ assert }) => {
    assert.deepEqual([...TRIP_LIVE_UPDATE_TYPES], ['started', 'progress', 'closed'])
    for (const type of TRIP_LIVE_UPDATE_TYPES)
      assert.equal(TRIP_SERVER_EVENTS[type], `trip:${type}`)
    assert.equal(tripRooms.vehicle(VEHICULE), `vehicle:${VEHICULE}`)
    assert.isTrue(tripRooms.isVehicle(tripRooms.vehicle(VEHICULE)))
    assert.isFalse(tripRooms.isVehicle(tripRooms.organization(ORG)))
  })
})

test.group('trajets · cas d’usage', () => {
  test('liste : période refusée avant toute lecture', async ({ assert }) => {
    const reader = new FakeReader()
    const r = await new ListTrips(reader).execute({
      scope: { organizationId: ORG },
      from: d('2026-10-01T00:00:00Z'),
      to: d('2026-11-30T00:00:00Z'),
    })
    assert.isFalse(r.ok)
    assert.lengthOf(reader.listes, 0)
  })

  test('liste : périmètre et bornes transmis au lecteur', async ({ assert }) => {
    const reader = new FakeReader()
    await new ListTrips(reader).execute({
      scope: { organizationId: ORG },
      from: d('2026-11-01T00:00:00Z'),
      to: d('2026-11-02T00:00:00Z'),
      perPage: 5000,
      page: 0,
    })
    assert.equal(reader.listes[0].scope.organizationId, ORG)
    assert.equal(reader.listes[0].perPage, TRIP_LIST_MAX_PER_PAGE)
    assert.equal(reader.listes[0].page, 1)
  })

  test("trajet d'un autre client : introuvable, comme un identifiant inconnu", async ({
    assert,
  }) => {
    const r = await new GetTrip(new FakeReader()).execute({
      scope: { organizationId: AUTRE },
      tripId: TRAJET,
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_NOT_FOUND')
  })

  test('points : pages par curseur, jusqu’à `done`', async ({ assert }) => {
    const use = new ReadTripPoints(new FakeReader())
    const tailles: number[] = []
    let after: Date | undefined
    for (let i = 0; i < 5; i++) {
      const r = await use.execute({
        scope: { organizationId: ORG },
        tripId: TRAJET,
        after,
        limit: 4,
      })
      assert.isTrue(r.ok)
      if (!r.ok) return
      tailles.push(r.value.points.length)
      if (r.value.done) break
      after = new Date(r.value.nextCursor!)
    }
    assert.deepEqual(tailles, [4, 4, 3])
  })

  test('points : fenêtre du trajet, boîtier du trajet ; trajet ouvert sans borne haute', async ({
    assert,
  }) => {
    const ferme = new FakeReader()
    await new ReadTripPoints(ferme).execute({ scope: { organizationId: ORG }, tripId: TRAJET })
    assert.equal(ferme.lectures[0].deviceId, BOITIER)
    assert.equal(ferme.lectures[0].to?.toISOString(), '2026-11-25T08:10:00.000Z')
    assert.equal(ferme.lectures[0].limit, 501) // un de plus : sait s'il reste une page

    const ouvert = new FakeReader(resume({ status: 'open', endedAt: null }))
    await new ReadTripPoints(ouvert).execute({ scope: { organizationId: ORG }, tripId: TRAJET })
    assert.isNull(ouvert.lectures[0].to)
  })

  test('suivi : véhicules du périmètre seulement, dans la limite de la connexion', async ({
    assert,
  }) => {
    const autreVehicule = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const reader = new FakeReader(resume(), { [VEHICULE]: ORG, [autreVehicule]: AUTRE })
    const use = new FollowVehicles(reader)

    const r = await use.execute({
      scope: { organizationId: ORG },
      vehicleIds: [VEHICULE, autreVehicule, VEHICULE],
      alreadyFollowed: 0,
    })
    assert.isTrue(r.ok)
    if (!r.ok) return
    assert.deepEqual(r.value.accepted, [VEHICULE])
    assert.deepEqual(r.value.rejected, [autreVehicule])

    const plein = await use.execute({
      scope: { organizationId: ORG },
      vehicleIds: [VEHICULE],
      alreadyFollowed: LIVE_MAX_FOLLOWED_VEHICLES,
    })
    if (plein.ok) assert.deepEqual(plein.value.rejected, [VEHICULE])
  })
})

// =========================================================================
//  Ingestion → diffusion des trajets
// =========================================================================

const NOW = new Date('2026-11-26T08:10:00.000Z')

function trame(minute: number, ignition: boolean): TelemetryFrame {
  const recordedAt = new Date(Date.UTC(2026, 10, 26, 8, minute))
  return {
    ident: '861234567890001',
    externalId: `t-${minute}`,
    recordedAt,
    receivedAt: NOW,
    latitude: 5.3 + minute * 0.002,
    longitude: -4 - minute * 0.002,
    altitudeM: null,
    speedKph: 40,
    headingDeg: 300,
    satellites: 9,
    hdop: 0.8,
    isValidFix: true,
    ignition,
    movement: true,
    engineBlocked: null,
    gsmSignal: 20,
    batteryPct: 90,
    externalVoltageV: null,
    raw: {},
  }
}

function monter(opts: { rollback?: boolean } = {}) {
  const diffusions: TripLiveUpdate[] = []
  let ouvert: Trip | null = null
  const tx: TransactionScope = { raw: null, collect: () => {} }
  const broadcaster: RealtimeBroadcaster = {
    publishPosition: async () => {},
    publishTrip: async (_org, u) => void diffusions.push(u),
  }
  const resolver: DeviceResolver = {
    resolve: async () => ({
      deviceId: BOITIER,
      organizationId: ORG,
      vehicleId: VEHICULE,
      hasRelay: true,
      flespiDeviceId: 1,
    }),
    invalidate: async () => {},
  }
  const journal: IngestMessageRepository = {
    record: async () => {},
    findPending: async () => [],
    markProcessed: async () => {},
    markRejected: async () => {},
  }
  const positions: PositionRepository = {
    insertBatch: async (r: NormalizedReading[]) => r.length,
    findLastValidFix: async () => null,
    attachToTrip: async () => 0,
  }
  const trips: TripRepository = {
    findOpenByVehicle: async () => ouvert,
    save: async (t: Trip) => {
      ouvert = t.status === 'open' ? t : null
    },
    findStale: async () => [],
  }
  let n = 0
  const ingestion = new IngestTelemetryFrames(
    {
      run: async (h) => {
        const r = await h(tx)
        // Simule un COMMIT refusé par la base (contrainte, connexion perdue) : ROLLBACK.
        if (opts.rollback) throw new Error('COMMIT refusé')
        return r
      },
    },
    journal,
    positions,
    { upsert: async () => {} },
    trips,
    resolver,
    broadcaster,
    { now: () => NOW },
    { generate: () => `eeeeeeee-eeee-4eee-8eee-${String(++n).padStart(12, '0')}` },
    {
      maxHdop: 5,
      minSatellites: 4,
      maxPlausibleSpeedKph: 220,
      maxClockSkewSeconds: 3600,
      backlogThresholdSeconds: 3600,
      tripIdleTimeoutSeconds: 600,
      tripMaxDurationHours: 24,
      tripMinDistanceMeters: 50,
      idleSpeedThresholdKph: 3,
    }
  )
  return { ingestion, diffusions }
}

test.group('trajets · diffusion pendant l’ingestion', () => {
  test('ouverture, points, clôture — dans cet ordre', async ({ assert }) => {
    const { ingestion, diffusions } = monter()
    await ingestion.execute({ frames: [trame(0, true), trame(1, true), trame(2, true)] })
    await ingestion.execute({ frames: [trame(3, true), trame(4, false)] })

    assert.deepEqual(
      diffusions.map((u) => `${u.type}:${u.points.length}`),
      ['started:0', 'progress:3', 'progress:2', 'closed:0']
    )
    const [ouverture, , , cloture] = diffusions
    assert.equal(ouverture.trip.vehicleId, VEHICULE)
    assert.equal(ouverture.trip.status, 'open')
    assert.equal(cloture.trip.status, 'closed')
    assert.equal(cloture.trip.closeReason, 'ignition_off')
    assert.isAbove(cloture.trip.distanceMeters, 0)
    assert.equal(diffusions[1].points[0].recordedAt, '2026-11-26T08:00:00.000Z')
    assert.equal(diffusions[1].points[0].headingDeg, 300)
  })

  test("rien n'est diffusé si la transaction échoue", async ({ assert }) => {
    const { ingestion, diffusions } = monter({ rollback: true })
    await assert.rejects(() => ingestion.execute({ frames: [trame(0, true), trame(1, true)] }))
    assert.lengthOf(diffusions, 0)
  })

  test('un diffuseur en échec ne bloque ni l’ingestion ni les autres diffuseurs', async ({
    assert,
  }) => {
    const recus: string[] = []
    const composite = new CompositeBroadcaster([
      {
        publishPosition: async () => {
          throw new Error('SSE en panne')
        },
        publishTrip: async () => {
          throw new Error('Redis en panne')
        },
      },
      {
        publishPosition: async () => void recus.push('position'),
        publishTrip: async (_o, u) => void recus.push(u.type),
      },
    ])
    await composite.publishPosition(ORG, {})
    await composite.publishTrip(ORG, {
      type: 'started',
      trip: {} as TripLiveUpdate['trip'],
      points: [],
    })
    assert.deepEqual(recus, ['position', 'started'])
  })
})
