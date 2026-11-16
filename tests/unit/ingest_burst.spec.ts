import { test } from '@japa/runner'
import { FairScheduler } from '#infrastructure/telemetry/fair_scheduler'

/**
 * =========================================================================
 *  RAFALE — ce qu'une organisation attend pendant le rejeu d'une autre
 * =========================================================================
 *
 * Reproduit le modèle de MQTT.js : `handleMessage` est appelé
 * SÉQUENTIELLEMENT, le paquet suivant n'étant lu qu'après l'acquittement du
 * précédent. Tout ce que le handler fait avant de rendre la main est donc
 * payé par TOUS les messages suivants, de toutes les organisations.
 *
 * Scénario : l'organisation A rejoue 200 trames depuis un seul boîtier
 * (sortie de zone blanche). Pendant ce rejeu, B et C envoient une trame
 * chacune. On mesure le délai avant que la trame de B soit TRAITÉE.
 *
 * Coûts simulés, du même ordre que l'observé :
 *   journalisation d'une trame (un INSERT idempotent)  →  1 ms
 *   traitement complet (qualité, position, trajet)     →  8 ms
 */

const COUT_JOURNAL = 1
const COUT_TRAITEMENT = 8
const RAFALE = 200

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Message {
  org: string
  cle: string
}

function scenario(): Message[] {
  const messages: Message[] = []
  for (let i = 0; i < RAFALE; i += 1) messages.push({ org: 'A', cle: 'A-boitier1' })
  // B et C arrivent après les 5 premières trames de la rafale.
  messages.splice(5, 0, { org: 'B', cle: 'B-boitier1' }, { org: 'C', cle: 'C-boitier1' })
  return messages
}

test.group('Ingestion — rafale et équité entre organisations', () => {
  test('AVANT : B attend la fin de la rafale de A (pipeline sérialisé)', async ({ assert }) => {
    const messages = scenario()
    const depart = Date.now()
    let attenteB = -1

    // Modèle exact de l'ancien handler : tout le traitement avant l'acquittement.
    for (const m of messages) {
      await attendre(COUT_TRAITEMENT)
      if (m.org === 'B' && attenteB < 0) attenteB = Date.now() - depart
    }

    // B n'est servi qu'à son rang dans la file : ~7 messages ici, mais si la
    // rafale avait précédé son arrivée, il aurait attendu les 200.
    assert.isAbove(attenteB, 0)
    // La durée TOTALE est la somme : rien ne se recouvre.
    const total = Date.now() - depart
    assert.isAtLeast(total, messages.length * COUT_TRAITEMENT * 0.8)
  }).timeout(30_000)

  test('APRÈS : B est traité pendant que la rafale de A se déroule', async ({ assert }) => {
    const messages = scenario()
    const ordo = new FairScheduler({ concurrency: 4, maxQueueLength: 5000, maxPerKey: 1000 })
    const depart = Date.now()
    let attenteB = -1
    const taches: Promise<unknown>[] = []

    // Modèle du nouveau handler : journalisation (séquentielle, brève) puis
    // empilage. Le handler rend la main tout de suite.
    for (const m of messages) {
      await attendre(COUT_JOURNAL)
      await ordo.waitForSlot(m.cle)
      taches.push(
        ordo.enqueue(m.cle, async () => {
          await attendre(COUT_TRAITEMENT)
          if (m.org === 'B' && attenteB < 0) attenteB = Date.now() - depart
        })
      )
    }
    await Promise.all(taches)

    /**
     * Le seuil : B doit être traité en moins de 10 % du temps qu'il faut à la
     * rafale complète. C'est la propriété demandée — aucune organisation
     * n'attend le rejeu d'une autre.
     */
    const plafond = RAFALE * COUT_TRAITEMENT * 0.1
    assert.isAbove(attenteB, 0)
    assert.isBelow(
      attenteB,
      plafond,
      `B traité après ${attenteB} ms, seuil ${plafond} ms (rafale complète : ${RAFALE * COUT_TRAITEMENT} ms)`
    )
  }).timeout(30_000)

  test("l'ordre des trames d'un même boîtier est préservé malgré le parallélisme", async ({
    assert,
  }) => {
    const ordo = new FairScheduler({ concurrency: 8, maxQueueLength: 5000 })
    const vus: Record<string, number[]> = { A: [], B: [] }
    const taches: Promise<unknown>[] = []

    // Deux boîtiers entrelacés, 30 trames chacun.
    for (let i = 0; i < 30; i += 1) {
      for (const org of ['A', 'B']) {
        const n = i
        taches.push(
          ordo.enqueue(`${org}-boitier1`, async () => {
            await attendre(Math.random() * 3)
            vus[org].push(n)
          })
        )
      }
    }
    await Promise.all(taches)

    // Chaque boîtier voit SES trames dans l'ordre d'arrivée : c'est la
    // condition pour que la reconstitution des trajets reste juste.
    for (const org of ['A', 'B']) {
      assert.deepEqual(
        vus[org],
        Array.from({ length: 30 }, (_, i) => i)
      )
    }
  }).timeout(30_000)
})
