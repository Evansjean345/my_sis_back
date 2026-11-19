import { test } from '@japa/runner'
import {
  activationProblem,
  featuresByModule,
  normalizeFeatures,
  normalizeOfferCode,
  OFFER_CODE_PATTERN,
  OFFER_FEATURE_KEYS,
  pathsOf,
  vehicleQuotaReached,
} from '#domain/billing/offer_policy'

/**
 * =========================================================================
 *  OFFRES — règles pures (catalogue, quotas, activation)
 * =========================================================================
 */

test.group('Offres | fonctionnalités', () => {
  test('le catalogue suit les modules du menu, clés historiques conservées', ({ assert }) => {
    assert.lengthOf(OFFER_FEATURE_KEYS, 14)
    for (const cle of ['fleet', 'zones', 'drivers', 'incidents', 'support', 'speed', 'alerts']) {
      assert.include(OFFER_FEATURE_KEYS, cle)
    }
    assert.deepEqual(
      featuresByModule().map((m) => `${m.module}:${m.features.length}`),
      [
        'Supervision:1',
        'Alertes & Notifications:4',
        'Gestion des incidents:1',
        'Rubriques client:7',
        'Support:1',
      ]
    )
    assert.deepEqual(pathsOf(['fleet', 'drivers', 'alerts']), [
      '/dashboard/fleet',
      '/dashboard/alerts',
      '/dashboard/driver',
    ])
  })

  test('normalise : dédoublonne, ignore l’inconnu, ordre du catalogue', ({ assert }) => {
    assert.deepEqual(normalizeFeatures(['support', 'alerts', 'fleet', 'alerts', 'inconnue']), [
      'fleet',
      'alerts',
      'support',
    ])
  })
})

test.group('Offres | code', () => {
  test('saisi librement, stocké en majuscules', ({ assert }) => {
    const code = normalizeOfferCode('  premium-50 ')
    assert.equal(code, 'PREMIUM-50')
    assert.isTrue(OFFER_CODE_PATTERN.test(code))
  })

  test('refuse les codes trop courts ou avec espaces', ({ assert }) => {
    assert.isFalse(OFFER_CODE_PATTERN.test('A'))
    assert.isFalse(OFFER_CODE_PATTERN.test('OFFRE PRO'))
    assert.isFalse(OFFER_CODE_PATTERN.test('-PRO'))
  })
})

test.group('Offres | règles', () => {
  test('une offre active exige une date de commercialisation', ({ assert }) => {
    assert.isString(activationProblem({ status: 'active', launchedOn: null }))
    assert.isNull(activationProblem({ status: 'active', launchedOn: '2026-12-01' }))
    assert.isNull(activationProblem({ status: 'inactive', launchedOn: null }))
  })

  test('limite de véhicules : null = illimité', ({ assert }) => {
    assert.isFalse(vehicleQuotaReached(null, 10_000))
    assert.isFalse(vehicleQuotaReached(50, 49))
    assert.isTrue(vehicleQuotaReached(50, 50))
  })
})
