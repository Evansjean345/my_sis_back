import { test } from '@japa/runner'
import {
  geofenceAlerts,
  geofenceProblem,
  notificationChannels,
  ruleFieldsForEvent,
  ruleProblem,
  speedPolicyProblem,
  zoneIdsOf,
} from '#domain/policy/rule_policy'

const base = {
  name: 'Sortie du dépôt',
  trigger: 'geofence_exit' as const,
  conditions: [{ field: 'zone' as const, operator: 'eq' as const, value: 'z1' }],
  actions: [{ type: 'alert' as const, value: 'critical' }],
}

test.group('Règles — cohérence', () => {
  test('règle valide', ({ assert }) => {
    assert.isNull(ruleProblem(base))
  })

  test('au moins une action, gravité valide', ({ assert }) => {
    assert.equal(ruleProblem({ ...base, actions: [] }), 'Ajoutez au moins une action.')
    assert.match(
      ruleProblem({ ...base, actions: [{ type: 'alert', value: 'urgent' }] })!,
      /gravité/
    )
    assert.match(
      ruleProblem({ ...base, actions: [{ type: 'incident', value: ' ' }] })!,
      /paramètre/
    )
  })

  test("la condition correspond à l'événement et à son opérateur", ({ assert }) => {
    assert.deepEqual(ruleFieldsForEvent('overspeed'), ['speed_policy'])
    assert.deepEqual(ruleFieldsForEvent('sos'), [])
    assert.match(ruleProblem({ ...base, trigger: 'overspeed' })!, /ne correspond pas à l'événement/)
    assert.match(
      ruleProblem({
        ...base,
        conditions: [{ field: 'zone', operator: 'gt', value: 'z1' }],
      })!,
      /opérateur/
    )
  })

  test('sortie de zone : plusieurs zones en OU, dédoublonnées', ({ assert }) => {
    assert.deepEqual(
      zoneIdsOf('geofence_exit', {
        field: 'zone',
        operator: 'eq',
        value: '',
        values: ['a', 'b', 'a'],
      }),
      ['a', 'b']
    )
    assert.deepEqual(
      zoneIdsOf('geofence_entry', { field: 'zone', operator: 'eq', value: 'a', values: ['b'] }),
      ['a']
    )
  })

  test('cible véhicule ou flotte obligatoire si choisie', ({ assert }) => {
    assert.match(
      ruleProblem({
        ...base,
        conditions: [{ ...base.conditions[0], target: { type: 'fleet', id: '' } }],
      })!,
      /flotte/
    )
  })

  test('notification : push toujours, SMS / e-mail hors événements push seul', ({ assert }) => {
    assert.deepEqual(notificationChannels('overspeed', ['sms', 'email', 'fax']), [
      'push',
      'sms',
      'email',
    ])
    assert.deepEqual(notificationChannels('sos', ['sms']), ['push'])
  })
})

test.group('Zones et politiques de vitesse', () => {
  const zone = {
    name: 'Dépôt',
    shape: 'circle' as const,
    center: { lat: 5.3, lng: -4 },
    radiusM: 400,
    points: [],
  }

  test('cercle de 50 m minimum, polygone de 3 sommets', ({ assert }) => {
    assert.isNull(geofenceProblem(zone))
    assert.match(geofenceProblem({ ...zone, radiusM: 20 })!, /50 m/)
    assert.match(
      geofenceProblem({ ...zone, shape: 'polygon', points: [zone.center] })!,
      /3 sommets/
    )
  })

  test("l'événement surveillé dépend du type de zone", ({ assert }) => {
    assert.deepEqual(geofenceAlerts('forbidden'), { alertOnEntry: true, alertOnExit: false })
    assert.deepEqual(geofenceAlerts('authorized'), { alertOnEntry: false, alertOnExit: true })
  })

  test('politique : limite, zone ou véhicules selon la portée', ({ assert }) => {
    const p = {
      name: 'Ville',
      scope: 'global' as const,
      zoneId: null,
      vehicleIds: [],
      limitKph: 50,
    }
    assert.isNull(speedPolicyProblem(p))
    assert.match(speedPolicyProblem({ ...p, limitKph: 250 })!, /5 et 200/)
    assert.match(speedPolicyProblem({ ...p, scope: 'zone' })!, /zone/)
    assert.match(speedPolicyProblem({ ...p, scope: 'vehicle' })!, /véhicule/)
  })
})
