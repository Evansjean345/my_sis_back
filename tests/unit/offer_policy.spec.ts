import { test } from '@japa/runner'
import {
  activationProblem,
  normalizeOfferCode,
  OFFER_CODE_PATTERN,
  SUB_FEATURE_KEY_PATTERN,
  vehicleQuotaReached,
} from '#domain/billing/offer_policy'
import {
  canTransition,
  grantsAccess,
  subscriptionAmount,
  SUBSCRIPTION_REFERENCE_PATTERN,
} from '#domain/billing/subscription_policy'
import {
  type Feature,
  pathsOf,
  restrictCatalogue,
} from '#infrastructure/persistence/feature_catalogue'

/**
 * =========================================================================
 *  OFFRES ET SOUSCRIPTIONS — règles pures (sans base)
 * =========================================================================
 */

/** Extrait du catalogue de la migration 026. */
const CATALOGUE: Feature[] = [
  {
    id: 1,
    name: 'Supervision',
    subFeatures: [{ id: 1, key: 'fleet', label: 'Supervision', path: '/dashboard/fleet' }],
  },
  {
    id: 4,
    name: 'Contrôle de vitesse',
    subFeatures: [
      { id: 4, key: 'speed_alerts', label: 'Alertes de vitesse', path: '/dashboard/speed' },
      { id: 5, key: 'speed_limiter', label: 'Limiteur de vitesse', path: '/dashboard/speed' },
    ],
  },
  {
    id: 10,
    name: 'Support',
    subFeatures: [
      {
        id: 14,
        key: 'support_technician',
        label: 'Technicien dédié',
        path: '/dashboard/support-tech',
      },
    ],
  },
]

test.group('Catalogue | fonctionnalités et sous-fonctionnalités', () => {
  test('restreint aux sous-fonctionnalités incluses, fonctionnalités vides retirées', ({
    assert,
  }) => {
    const vue = restrictCatalogue(CATALOGUE, ['speed_limiter', 'fleet'])
    assert.deepEqual(
      vue.map((f) => `${f.name}:${f.subFeatures.map((s) => s.key).join('+')}`),
      ['Supervision:fleet', 'Contrôle de vitesse:speed_limiter']
    )
  })

  test('une page partagée par deux sous-fonctionnalités n’apparaît qu’une fois', ({ assert }) => {
    assert.deepEqual(pathsOf(CATALOGUE), [
      '/dashboard/fleet',
      '/dashboard/speed',
      '/dashboard/support-tech',
    ])
    assert.deepEqual(pathsOf(CATALOGUE, ['speed_alerts', 'speed_limiter']), ['/dashboard/speed'])
    assert.deepEqual(pathsOf(CATALOGUE, []), [])
  })

  test('clés de sous-fonctionnalités', ({ assert }) => {
    assert.isTrue(SUB_FEATURE_KEY_PATTERN.test('reports_custom'))
    assert.isFalse(SUB_FEATURE_KEY_PATTERN.test('Rapports-Perso'))
  })
})

test.group('Offres | règles', () => {
  test('code saisi librement, stocké en majuscules', ({ assert }) => {
    const code = normalizeOfferCode('  premium-50 ')
    assert.equal(code, 'PREMIUM-50')
    assert.isTrue(OFFER_CODE_PATTERN.test(code))
    assert.isFalse(OFFER_CODE_PATTERN.test('OFFRE PRO'))
  })

  test('une offre active exige une date de commercialisation', ({ assert }) => {
    assert.isString(activationProblem({ status: 'active', launchedOn: null }))
    assert.isNull(activationProblem({ status: 'active', launchedOn: '2026-12-01' }))
    assert.isNull(activationProblem({ status: 'inactive', launchedOn: null }))
  })

  test('limite de véhicules : null = illimité', ({ assert }) => {
    assert.isFalse(vehicleQuotaReached(null, 10_000))
    assert.isTrue(vehicleQuotaReached(50, 50))
  })
})

test.group('Souscriptions | règles', () => {
  test('cycle de vie : brouillon → active ⇄ suspendue → résiliée (définitif)', ({ assert }) => {
    assert.isTrue(canTransition('draft', 'active'))
    assert.isTrue(canTransition('active', 'suspended'))
    assert.isTrue(canTransition('suspended', 'active'))
    assert.isTrue(canTransition('suspended', 'terminated'))
    assert.isFalse(canTransition('draft', 'suspended'))
    assert.isFalse(canTransition('terminated', 'active'))
  })

  test('seules les souscriptions actives ouvrent des pages', ({ assert }) => {
    assert.isTrue(grantsAccess('active'))
    for (const s of ['draft', 'suspended', 'terminated']) assert.isFalse(grantsAccess(s))
  })

  test('montant = tarif appliqué × véhicules, au centime, sans flottant', ({ assert }) => {
    assert.equal(subscriptionAmount('15000.00', 3), '45000.00')
    assert.equal(subscriptionAmount('0.10', 3), '0.30')
    assert.equal(subscriptionAmount('12500.5', 2), '25001.00')
    assert.equal(subscriptionAmount(9999.99, 0), '0.00')
    assert.equal(subscriptionAmount('999999999999.99', 1000), '999999999999990.00')
  })

  test('référence saisie', ({ assert }) => {
    assert.isTrue(SUBSCRIPTION_REFERENCE_PATTERN.test('SUB-2026-00001'))
    assert.isFalse(SUBSCRIPTION_REFERENCE_PATTERN.test('A'))
  })
})
