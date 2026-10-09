import { test } from '@japa/runner'
import { Trip } from '#domain/telemetry/entities/trip'
import { Coordinates, Distance, Speed } from '#domain/measures'
import { DeviceId, TripId, VehicleId } from '#domain/telemetry/value_objects'

/**
 * =========================================================================
 *  TRAJETS — REJEU STORE & FORWARD (incident d'ingestion du 09/10/2026)
 * =========================================================================
 *
 * Reproduit la trame qui bloquait l'ingestion en production. Un boîtier
 * MV730 sorti de zone blanche rejoue un contact OFF daté du 06/10 20:41,
 * alors que le trajet ouvert a démarré le 07/10 04:46 et accumulé des points
 * jusqu'au 08/10 12:06.
 *
 * L'agrégat écrivait alors `ended_at < started_at` et `duration_s = -29072`.
 * PostgreSQL refusait la ligne (`ck_trips_dates`, SQLSTATE 23514), la trame
 * n'était jamais acquittée, et l'ingestion rejouait indéfiniment le même
 * message. Un seul boîtier arrêtait toute la flotte.
 */

const IDS = {
  trip: '11111111-1111-4111-8111-111111111111',
  vehicle: 'eb1d8a26-e3fd-40fe-9b75-89b96c82ebb4',
  device: '529a5dfe-d85b-4274-9474-50236e13adae',
  organization: '11111111-1111-4111-8111-111111111111',
}

// Dates EXACTES de la ligne refusée par la base.
const DEBUT = new Date('2026-10-07T04:46:10.000Z')
const DERNIER_POINT = new Date('2026-10-08T12:06:01.000Z')
const OFF_REJOUE = new Date('2026-10-06T20:41:38.000Z')

function vitesse(kph: number): Speed {
  const s = Speed.fromKph(kph)
  if (!s.ok) throw new Error('fixture invalide')
  return s.value
}

function position(lon: number, lat: number): Coordinates {
  const c = Coordinates.create(lat, lon)
  if (!c.ok) throw new Error('fixture invalide')
  return c.value
}

/** Trajet ouvert le 07/10, dernier point le 08/10 — l'état de l'incident. */
function trajetOuvert(): Trip {
  return Trip.rehydrate(TripId.from(IDS.trip), {
    organizationId: IDS.organization,
    vehicleId: VehicleId.from(IDS.vehicle),
    deviceId: DeviceId.from(IDS.device),
    status: 'open',
    startedAt: DEBUT,
    endedAt: null,
    startLocation: position(-3.985, 5.35),
    endLocation: position(-3.97, 5.36),
    lastPointAt: DERNIER_POINT,
    distance: Distance.trusted(9769.9),
    maxSpeed: vitesse(9.3),
    speedSum: 9.3,
    positionsCount: 3,
    idleSeconds: 0,
    closeReason: null,
  })
}

test.group('Télémétrie — contact OFF rejoué dans le désordre', () => {
  test('la clôture antérieure au dernier point est REFUSÉE', ({ assert }) => {
    const trip = trajetOuvert()

    const r = trip.close({ at: OFF_REJOUE, reason: 'ignition_off', minDistanceMeters: 100 })

    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_OUT_OF_ORDER_POSITION')
  })

  test('le trajet reste OUVERT et sans date de fin — aucune ligne impossible', ({ assert }) => {
    const trip = trajetOuvert()
    trip.close({ at: OFF_REJOUE, reason: 'ignition_off', minDistanceMeters: 100 })

    const snap = trip.snapshot()
    assert.equal(snap.status, 'open')
    assert.isNull(snap.endedAt)
    assert.isNull(snap.durationSeconds)
  })

  test("l'invariant de la base ne peut plus être violé (ended_at >= started_at)", ({ assert }) => {
    const trip = trajetOuvert()
    trip.close({ at: OFF_REJOUE, reason: 'ignition_off', minDistanceMeters: 100 })
    const snap = trip.snapshot()

    // C'est exactement ce que vérifie `ck_trips_dates`.
    assert.isTrue(snap.endedAt === null || snap.endedAt.getTime() >= snap.startedAt.getTime())
    // Et la durée négative (-29072 s) n'est plus représentable.
    assert.isTrue(snap.durationSeconds === null || snap.durationSeconds >= 0)
  })

  test('un contact OFF COHÉRENT clôture normalement', ({ assert }) => {
    const trip = trajetOuvert()
    const off = new Date(DERNIER_POINT.getTime() + 60_000)

    const r = trip.close({ at: off, reason: 'ignition_off', minDistanceMeters: 100 })

    assert.isTrue(r.ok)
    const snap = trip.snapshot()
    assert.equal(snap.status, 'closed')
    assert.equal(snap.endedAt?.toISOString(), off.toISOString())
    assert.isTrue((snap.durationSeconds ?? -1) > 0)
  })

  test("le trajet non clôturé EXPIRE sur son dernier point, pas sur l'heure courante", ({
    assert,
  }) => {
    const trip = trajetOuvert()
    // 24 h après le dernier point : le contact OFF ne viendra plus.
    const maintenant = new Date(DERNIER_POINT.getTime() + 25 * 3_600_000)

    assert.isTrue(trip.isStale(maintenant, 24))
    const r = trip.close({
      at: trip.lastPointAt,
      reason: 'timeout',
      minDistanceMeters: 100,
    })

    assert.isTrue(r.ok)
    const snap = trip.snapshot()
    assert.equal(snap.status, 'closed')
    assert.equal(snap.closeReason, 'timeout')
    // La durée s'arrête au dernier point : elle n'inclut pas les 25 h d'arrêt.
    assert.equal(snap.endedAt?.toISOString(), DERNIER_POINT.toISOString())
    assert.isTrue((snap.durationSeconds ?? -1) > 0)
  })

  test('une position antérieure reste refusée, sans corrompre les agrégats', ({ assert }) => {
    const trip = trajetOuvert()
    const avant = trip.snapshot()

    const r = trip.addPosition({
      at: OFF_REJOUE,
      location: position(-3.95, 5.34),
      speed: vitesse(40),
      idleThresholdKph: 3,
    })

    assert.isFalse(r.ok)
    const apres = trip.snapshot()
    assert.equal(apres.positionsCount, avant.positionsCount)
    assert.equal(apres.distanceMeters, avant.distanceMeters)
    assert.equal(apres.lastPointAt.toISOString(), DERNIER_POINT.toISOString())
  })
})
