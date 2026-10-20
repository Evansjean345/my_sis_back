import { test } from '@japa/runner'
import { FairScheduler } from '#infrastructure/telemetry/fair_scheduler'

/**
 * =========================================================================
 *  ORDONNANCEUR ÉQUITABLE — ce que les rafales ne doivent plus pouvoir faire
 * =========================================================================
 *
 * Ces tests décrivent la propriété attendue en exploitation : la rafale d'un
 * boîtier (rejeu Store & Forward) ne doit retarder AUCUNE autre organisation,
 * tout en préservant l'ordre des positions de ce boîtier — ordre dont dépend
 * la reconstitution des trajets.
 */

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

test.group('Ordonnanceur — ordre et sérialisation par clé', () => {
  test("les tâches d'une même clé s'exécutent dans l'ordre, jamais en parallèle", async ({
    assert,
  }) => {
    const ordo = new FairScheduler({ concurrency: 4, maxQueueLength: 100 })
    const trace: string[] = []
    let simultanees = 0
    let maxSimultanees = 0

    const taches = [1, 2, 3, 4, 5].map((n) =>
      ordo.enqueue('boitier-A', async () => {
        simultanees += 1
        maxSimultanees = Math.max(maxSimultanees, simultanees)
        trace.push(`debut-${n}`)
        await attendre(5)
        trace.push(`fin-${n}`)
        simultanees -= 1
      })
    )
    await Promise.all(taches)

    assert.equal(maxSimultanees, 1, 'une seule tâche à la fois pour une clé')
    assert.deepEqual(trace, [
      'debut-1',
      'fin-1',
      'debut-2',
      'fin-2',
      'debut-3',
      'fin-3',
      'debut-4',
      'fin-4',
      'debut-5',
      'fin-5',
    ])
  })

  test('des clés différentes progressent en parallèle', async ({ assert }) => {
    const ordo = new FairScheduler({ concurrency: 4, maxQueueLength: 100 })
    let simultanees = 0
    let maxSimultanees = 0

    await Promise.all(
      ['a', 'b', 'c', 'd'].map((cle) =>
        ordo.enqueue(cle, async () => {
          simultanees += 1
          maxSimultanees = Math.max(maxSimultanees, simultanees)
          await attendre(20)
          simultanees -= 1
        })
      )
    )

    assert.equal(maxSimultanees, 4)
  })

  test('la concurrence globale est respectée', async ({ assert }) => {
    const ordo = new FairScheduler({ concurrency: 2, maxQueueLength: 100 })
    let simultanees = 0
    let maxSimultanees = 0

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        ordo.enqueue(`cle-${i}`, async () => {
          simultanees += 1
          maxSimultanees = Math.max(maxSimultanees, simultanees)
          await attendre(5)
          simultanees -= 1
        })
      )
    )

    assert.equal(maxSimultanees, 2)
  })
})

test.group('Ordonnanceur — équité entre organisations', () => {
  test("une rafale de 300 trames d'un boîtier ne retarde pas les autres", async ({ assert }) => {
    const ordo = new FairScheduler({ concurrency: 2, maxQueueLength: 1000 })
    const DUREE = 2 // ms par trame, identique pour tous

    // Organisation A : un boîtier rejoue 300 trames d'un coup.
    const rafale = Array.from({ length: 300 }, () =>
      ordo.enqueue('orgA-boitier1', () => attendre(DUREE))
    )

    // Organisations B et C arrivent APRÈS, avec une trame chacune.
    const depart = Date.now()
    let rangB = -1
    let rangC = -1
    let servies = 0
    const compter = () => (servies += 1)

    const b = ordo.enqueue('orgB-boitier1', async () => {
      await attendre(DUREE)
      rangB = compter()
    })
    const c = ordo.enqueue('orgC-boitier1', async () => {
      await attendre(DUREE)
      rangC = compter()
    })

    await Promise.all([b, c])
    const attenteMs = Date.now() - depart

    // Sans tourniquet, B et C passeraient APRÈS les 300 trames de A.
    // Avec, ils sont servis dès les premiers tours.
    assert.isTrue(rangB > 0 && rangC > 0)
    assert.isBelow(
      attenteMs,
      300 * DUREE,
      `B et C servis en ${attenteMs} ms, bien avant la fin de la rafale`
    )

    await Promise.all(rafale)
  })

  test('trois organisations se partagent les créneaux, aucune ne monopolise', async ({
    assert,
  }) => {
    const ordo = new FairScheduler({ concurrency: 1, maxQueueLength: 1000 })
    const servi: string[] = []

    // Chaque organisation empile 3 tâches.
    for (const org of ['A', 'B', 'C']) {
      for (let i = 0; i < 3; i += 1) {
        void ordo.enqueue(`org${org}`, async () => {
          servi.push(org)
          await attendre(1)
        })
      }
    }
    await ordo.drain()

    // A prend le premier créneau : il est seul en file à cet instant. Le
    // tourniquet ne s'applique qu'ensuite — ce qui compte est qu'aucune
    // organisation n'attende la fin d'une autre.
    assert.equal(servi.length, 9)
    for (const org of ['A', 'B', 'C']) {
      assert.equal(servi.filter((x) => x === org).length, 3)
    }
    // B et C sont servis AVANT que A n'ait épuisé ses trois tâches.
    assert.isBelow(servi.indexOf('B'), servi.lastIndexOf('A'))
    assert.isBelow(servi.indexOf('C'), servi.lastIndexOf('A'))
    // Jamais trois passages consécutifs pour la même organisation.
    for (let i = 0; i + 2 < servi.length; i += 1) {
      assert.isFalse(
        servi[i] === servi[i + 1] && servi[i + 1] === servi[i + 2],
        `monopolisation détectée à l'index ${i} : ${servi.join(' ')}`
      )
    }
  })
})

test.group('Ordonnanceur — contre-pression', () => {
  test('`waitForSlot` fait patienter quand la file est pleine, puis repart', async ({ assert }) => {
    const ordo = new FairScheduler({ concurrency: 1, maxQueueLength: 3 })
    for (let i = 0; i < 5; i += 1) void ordo.enqueue('cle', () => attendre(2))

    assert.isTrue(ordo.saturated, 'file pleine : le lecteur doit patienter')
    await ordo.waitForSlot()
    assert.isFalse(ordo.saturated)

    await ordo.drain()
    assert.equal(ordo.stats.queued, 0)
    assert.equal(ordo.stats.running, 0)
  })

  test('un plafond par clé régule le boîtier bavard sans bloquer les autres', async ({
    assert,
  }) => {
    const ordo = new FairScheduler({ concurrency: 2, maxQueueLength: 1000, maxPerKey: 5 })
    for (let i = 0; i < 6; i += 1) void ordo.enqueue('bavard', () => attendre(2))

    // Le bavard est plafonné…
    let bavardLibere = false
    void ordo.waitForSlot('bavard').then(() => (bavardLibere = true))
    assert.isFalse(bavardLibere)

    // …mais une autre clé passe tout de suite.
    await ordo.waitForSlot('autre-boitier')
    assert.isFalse(ordo.saturated)

    await ordo.drain()
  })

  test("l'échec d'une tâche n'interrompt pas l'ordonnanceur", async ({ assert }) => {
    const ordo = new FairScheduler({ concurrency: 2, maxQueueLength: 100 })
    const echec = ordo.enqueue('a', async () => {
      throw new Error('base indisponible')
    })
    const succes = ordo.enqueue('b', async () => 'ok')

    await assert.rejects(() => echec, 'base indisponible')
    assert.equal(await succes, 'ok')
    assert.equal(ordo.stats.completed, 2)
  })

  test('les statistiques exposent la file la plus profonde', async ({ assert }) => {
    const ordo = new FairScheduler({ concurrency: 1, maxQueueLength: 1000 })
    for (let i = 0; i < 10; i += 1) void ordo.enqueue('gourmand', () => attendre(1))
    void ordo.enqueue('discret', () => attendre(1))

    const s = ordo.stats
    assert.equal(s.deepestKey, 'gourmand')
    assert.isAbove(s.deepestQueue, 1)
    assert.equal(s.keys, 2)

    await ordo.drain()
  })
})
