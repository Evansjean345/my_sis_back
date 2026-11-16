/**
 * Mesure du blocage en tête de file, avant / après l'ordonnanceur.
 *
 * Reproduit le modèle de MQTT.js (handleMessage séquentiel) avec des coûts
 * simulés du même ordre que l'observé : 1 ms de journalisation, 8 ms de
 * traitement complet. À lancer : node bench_rafale.mjs
 */
import { FairScheduler } from './app/infrastructure/telemetry/fair_scheduler.ts'

const COUT_JOURNAL = 1
const COUT_TRAITEMENT = 8
const RAFALE = 200

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Scénario 1 — RÉALISTE : le broker livre la rafale d'un bloc (fenêtre
 * receiveMaximum), la trame vivante de B arrive DERRIÈRE. C'est le blocage en
 * tête de file tel qu'il se produit.
 */
function scenarioRafaleUnBoitier() {
  const msgs = Array.from({ length: RAFALE }, () => ({ org: 'A', cle: 'A-b1' }))
  msgs.push({ org: 'B', cle: 'B-b1' }, { org: 'C', cle: 'C-b1' })
  return msgs
}

/**
 * Scénario 2 — la rafale est répartie sur 20 boîtiers (sortie de zone blanche
 * d'une flotte entière). Ici la sérialisation par clé ne bride plus rien :
 * c'est le débit qui doit progresser.
 */
function scenarioFlotte() {
  const msgs = []
  for (let i = 0; i < RAFALE; i += 1) {
    const b = i % 20
    msgs.push({ org: b < 10 ? 'A' : 'B', cle: `boitier-${b}` })
  }
  msgs.push({ org: 'C', cle: 'C-b1' })
  return msgs
}

async function avant(scenario) {
  const msgs = scenario()
  const t0 = Date.now()
  const latence = {}
  for (const m of msgs) {
    await attendre(COUT_TRAITEMENT) // tout dans le chemin d'acquittement
    latence[m.org] ??= Date.now() - t0
  }
  return { latence, total: Date.now() - t0 }
}

async function apres(scenario, concurrency) {
  const msgs = scenario()
  const ordo = new FairScheduler({ concurrency, maxQueueLength: 5000, maxPerKey: 1000 })
  const t0 = Date.now()
  const latence = {}
  const taches = []
  for (const m of msgs) {
    await attendre(COUT_JOURNAL) // seul coût sérialisé
    await ordo.waitForSlot(m.cle)
    taches.push(
      ordo.enqueue(m.cle, async () => {
        await attendre(COUT_TRAITEMENT)
        latence[m.org] ??= Date.now() - t0
      })
    )
  }
  await Promise.all(taches)
  return { latence, total: Date.now() - t0, stats: ordo.stats }
}

const ligne = (nom, r, org) =>
  `${nom.padEnd(26)} ${org}=${String(r.latence[org] ?? -1).padStart(5)} ms   ` +
  `débit total=${String(r.total).padStart(5)} ms`

console.log(`\n═══ Scénario 1 : ${RAFALE} trames rejouées par UN SEUL boîtier (org A)`)
console.log('    La trame vivante de B arrive derrière la rafale.\n')
let a = await avant(scenarioRafaleUnBoitier)
let b = await apres(scenarioRafaleUnBoitier, 4)
console.log(ligne('AVANT (sérialisé)', a, 'B'))
console.log(ligne('APRÈS (ordonnanceur, 4)', b, 'B'))
console.log(`    → latence de B divisée par ${(a.latence.B / b.latence.B).toFixed(1)}`)
console.log(
  `    → débit inchangé (${(a.total / b.total).toFixed(2)}×) : les trames d'un même` +
    ' boîtier restent ordonnées, donc sérialisées. Attendu.'
)

console.log(`\n═══ Scénario 2 : ${RAFALE} trames réparties sur 20 boîtiers (2 organisations)`)
console.log("    Sortie de zone blanche d'une flotte entière.\n")
a = await avant(scenarioFlotte)
b = await apres(scenarioFlotte, 4)
console.log(ligne('AVANT (sérialisé)', a, 'C'))
console.log(ligne('APRÈS (ordonnanceur, 4)', b, 'C'))
console.log(`    → latence de C divisée par ${(a.latence.C / b.latence.C).toFixed(1)}`)
console.log(`    → débit multiplié par ${(a.total / b.total).toFixed(1)}`)
const c = await apres(scenarioFlotte, 8)
console.log(`    → avec concurrency=8 : ${c.total} ms (×${(a.total / c.total).toFixed(1)})`)
