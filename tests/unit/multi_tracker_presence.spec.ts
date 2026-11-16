import { test } from '@japa/runner'
import type { TransactionScope } from '#domain/kernel'
import type {
  DevicePresence,
  DevicePresenceRepository,
  IngestMessageRepository,
  PositionRepository,
  TripRepository,
  VehicleLastPositionRepository,
} from '#domain/telemetry/repositories/telemetry_repositories'
import type { NormalizedReading } from '#domain/telemetry/entities/telemetry_reading'
import type {
  DeviceResolver,
  DeviceStatusPayload,
  RealtimeBroadcaster,
  ResolvedDevice,
  TelemetryFrame,
} from '#application/telemetry/ports'
import { IngestTelemetryFrames } from '#application/telemetry/use_cases/ingest_telemetry_frames'

/**
 * =========================================================================
 *  PLUSIEURS TRACKERS — un boîtier garé ne doit pas disparaître
 * =========================================================================
 *
 * Reproduit le constat du 12/11/2026 sur `sisbm:flespi:watch` :
 *
 *   7301039238 (device 9459952) roule : fix=true, une trame toutes les ~5 s
 *   7301151405 (device 9016730) garé  : fix=false, sat=—, trame datée 11:41
 *                                       reçue à 12:03 (Store & Forward)
 *
 * Les deux trames arrivaient bien par MQTT, mais la seconde était écartée
 * du temps réel (`invalid_fix` + rattrapage) : la supervision ne montrait
 * qu'UN véhicule. La présence doit désormais avancer pour les deux.
 */

const ORG = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-12T12:03:11.000Z')

const BOITIERS: Record<string, ResolvedDevice> = {
  '7301039238': {
    deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    organizationId: ORG,
    vehicleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    hasRelay: true,
    flespiDeviceId: 9459952,
  },
  '7301151405': {
    deviceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    organizationId: ORG,
    vehicleId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    hasRelay: true,
    flespiDeviceId: 9016730,
  },
}

function trame(p: Partial<TelemetryFrame> & { ident: string; recordedAt: Date }): TelemetryFrame {
  return {
    externalId: `${p.ident}:${p.recordedAt.getTime()}`,
    receivedAt: NOW,
    latitude: 5.297287,
    longitude: -4.002808,
    altitudeM: null,
    speedKph: 0,
    headingDeg: null,
    satellites: null,
    hdop: null,
    isValidFix: true,
    ignition: null,
    movement: null,
    engineBlocked: null,
    gsmSignal: null,
    batteryPct: null,
    externalVoltageV: null,
    raw: {},
    ...p,
  }
}

function monter() {
  const tx: TransactionScope = { raw: null, collect: () => {} }
  const presences = new Map<string, DevicePresence>()
  const statuts: DeviceStatusPayload[] = []
  const tempsReel: string[] = []

  const presence: DevicePresenceRepository = {
    async touch(p) {
      const actuel = presences.get(p.deviceId)
      if (actuel && actuel.seenAt >= p.seenAt) return false
      presences.set(p.deviceId, p)
      return true
    },
  }
  const broadcaster: RealtimeBroadcaster = {
    async publishPosition(_org, payload) {
      tempsReel.push(String(payload.deviceId))
    },
    async publishDeviceStatus(_org, payload) {
      statuts.push(payload)
    },
  }
  const resolver: DeviceResolver = {
    resolve: async (ident) => BOITIERS[ident] ?? null,
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
  const lastPositions: VehicleLastPositionRepository = { upsert: async () => {} }
  const trips: TripRepository = {
    findOpenByVehicle: async () => null,
    save: async () => {},
    findStale: async () => [],
  }

  let n = 0
  const ingestion = new IngestTelemetryFrames(
    { run: async (h) => h(tx) },
    journal,
    positions,
    lastPositions,
    trips,
    resolver,
    broadcaster,
    { now: () => NOW },
    { generate: () => `eeeeeeee-eeee-4eee-8eee-${String(++n).padStart(12, '0')}` },
    {
      maxHdop: 5,
      minSatellites: 4,
      maxPlausibleSpeedKph: 220,
      maxClockSkewSeconds: 300,
      backlogThresholdSeconds: 300,
      tripIdleTimeoutSeconds: 600,
      tripMaxDurationHours: 24,
      tripMinDistanceMeters: 200,
      idleSpeedThresholdKph: 3,
    },
    presence
  )
  return { ingestion, presences, statuts, tempsReel }
}

test.group('Ingestion — plusieurs trackers', () => {
  test('un boîtier garé sans fix GPS reste visible « en ligne »', async ({ assert }) => {
    const { ingestion, presences, statuts, tempsReel } = monter()

    const r = await ingestion.execute({
      frames: [
        trame({
          ident: '7301039238',
          recordedAt: new Date('2026-11-12T12:03:10.000Z'),
          speedKph: 31.5,
          headingDeg: 205,
          satellites: 10,
          ignition: true,
          gsmSignal: 29,
        }),
        trame({
          ident: '7301151405',
          recordedAt: new Date('2026-11-12T11:41:11.000Z'),
          latitude: 5.370452,
          longitude: -3.962932,
          isValidFix: false,
          ignition: false,
          batteryPct: 100,
        }),
      ],
    })

    assert.isTrue(r.ok)
    if (!r.ok) return
    assert.equal(r.value.presenceUpdates, 2)

    // Les DEUX boîtiers sont en ligne…
    assert.equal(presences.size, 2)
    assert.equal(presences.get(BOITIERS['7301151405'].deviceId)?.batteryPct, 100)

    // …mais seul celui qui a un fix temps réel alimente la carte.
    assert.deepEqual(tempsReel, [BOITIERS['7301039238'].deviceId])

    const garé = statuts.find((s) => s.ident === '7301151405')!
    assert.isFalse(garé.hasFix)
    assert.isTrue(garé.delayed)
    assert.isFalse(garé.ignition)

    const roule = statuts.find((s) => s.ident === '7301039238')!
    assert.isTrue(roule.hasFix)
    assert.isFalse(roule.delayed)
  })

  test('la présence ne régresse pas sur un rejeu plus ancien', async ({ assert }) => {
    const { ingestion, statuts } = monter()
    const ident = '7301151405'

    await ingestion.execute({
      frames: [trame({ ident, recordedAt: new Date('2026-11-12T12:00:00.000Z') })],
    })
    const r = await ingestion.execute({
      frames: [
        trame({
          ident,
          recordedAt: new Date('2026-11-12T10:00:00.000Z'),
          receivedAt: new Date('2026-11-12T12:00:00.000Z'),
        }),
      ],
    })

    assert.isTrue(r.ok && r.value.presenceUpdates === 0)
    assert.lengthOf(statuts, 1)
  })

  test('N boîtiers différents dans un même lot : N présences', async ({ assert }) => {
    const { ingestion, presences } = monter()
    const r = await ingestion.execute({
      frames: Object.keys(BOITIERS).flatMap((ident) => [
        trame({ ident, recordedAt: new Date('2026-11-12T12:03:00.000Z') }),
        trame({ ident, recordedAt: new Date('2026-11-12T12:03:05.000Z') }),
      ]),
    })
    assert.isTrue(r.ok)
    assert.equal(presences.size, Object.keys(BOITIERS).length)
  })
})
