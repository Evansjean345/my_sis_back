import { test } from '@japa/runner'
import {
  EVENT_TYPES,
  PUSH_ONLY_EVENT_TYPES,
} from '#domain/policy/code_legacy/rule/rule_event_types'
import type { RuleReferences } from '#domain/policy/code_legacy/rule/rule_types'
import {
  conditionTarget,
  geofenceAlerts,
  geofenceProblem,
  notificationChannels,
  resolveConditions,
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

test.group('Règles — référentiel', () => {
  test('towing, tamper et harsh_driving ne sont plus des déclencheurs', ({ assert }) => {
    for (const removed of ['towing', 'tamper', 'harsh_driving']) {
      assert.notInclude(EVENT_TYPES as readonly string[], removed)
      assert.notInclude(PUSH_ONLY_EVENT_TYPES as readonly string[], removed)
    }
    assert.lengthOf(EVENT_TYPES, 10)
  })

  test('cible normalisée', ({ assert }) => {
    assert.deepEqual(conditionTarget(), { type: 'all' })
    assert.deepEqual(conditionTarget({ type: 'fleet' }), { type: 'fleet', id: '' })
    assert.deepEqual(conditionTarget({ type: 'vehicle', id: 'v1' }), { type: 'vehicle', id: 'v1' })
  })
})

test.group('Règles — références du client', () => {
  const refs: RuleReferences = {
    speedPolicies: new Map([
      ['p1', { name: 'Limite générale', active: true }],
      ['p2', { name: 'Ancienne', active: false }],
    ]),
    zones: new Map([
      ['z1', { name: 'Dépôt', active: true, alertOnEntry: false, alertOnExit: true }],
      ['z2', { name: 'Port', active: true, alertOnEntry: true, alertOnExit: false }],
    ]),
    schedules: new Map([['s1', { name: 'Semaine', active: true }]]),
    vehicles: new Map([
      ['v1', { registration: 'AB-1234-CI', active: true }],
      ['v2', { registration: 'CD-5678-CI', active: false }],
    ]),
    fleets: new Map([['f1', { name: 'Flotte Bus' }]]),
  }

  test('libellés calculés et cible résolue', ({ assert }) => {
    const r = resolveConditions(
      'overspeed',
      [{ field: 'speed_policy', operator: 'eq', value: 'p1', target: { type: 'fleet', id: 'f1' } }],
      refs
    )
    assert.notProperty(r, 'problem')
    if ('conditions' in r) {
      assert.equal(r.conditions[0].valueLabel, 'Limite générale')
      assert.deepEqual(r.conditions[0].target, { type: 'fleet', id: 'f1', label: 'Flotte Bus' })
      assert.equal(r.conditions[0].id, 'c1')
    }
  })

  test('sortie de zone : plusieurs zones, chacune réglée pour la sortie', ({ assert }) => {
    const ok = resolveConditions(
      'geofence_exit',
      [{ field: 'zone', operator: 'eq', value: '', values: ['z1'] }],
      refs
    )
    assert.deepEqual('conditions' in ok ? ok.conditions[0].valueLabels : null, ['Dépôt'])
    const ko = resolveConditions(
      'geofence_exit',
      [{ field: 'zone', operator: 'eq', value: '', values: ['z1', 'z2'] }],
      refs
    )
    assert.match('problem' in ko ? ko.problem : '', /configurée pour l'événement/)
  })

  test('références inactives ou inconnues refusées', ({ assert }) => {
    const policy = resolveConditions(
      'overspeed',
      [{ field: 'speed_policy', operator: 'eq', value: 'p2' }],
      refs
    )
    assert.match('problem' in policy ? policy.problem : '', /politique de vitesse active/)
    const vehicle = resolveConditions(
      'overspeed',
      [
        {
          field: 'speed_policy',
          operator: 'eq',
          value: 'p1',
          target: { type: 'vehicle', id: 'v2' },
        },
      ],
      refs
    )
    assert.match('problem' in vehicle ? vehicle.problem : '', /véhicule choisi/)
    const fleet = resolveConditions(
      'schedule_violation',
      [
        {
          field: 'schedule',
          operator: 'eq',
          value: 's1',
          target: { type: 'fleet', id: 'inconnue' },
        },
      ],
      refs
    )
    assert.match('problem' in fleet ? fleet.problem : '', /flotte choisie/)
  })
})
