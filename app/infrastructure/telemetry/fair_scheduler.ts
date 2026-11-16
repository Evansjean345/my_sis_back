/**
 * =========================================================================
 *  ORDONNANCEUR ÉQUITABLE À CLÉS
 * =========================================================================
 *
 * Problème résolu — le blocage en tête de file (head-of-line blocking).
 *
 * MQTT.js ne lit le paquet suivant qu'une fois le callback du précédent
 * invoqué (`handleMessage` → `done` → PUBACK). Tout le pipeline est donc
 * SÉQUENTIEL : une rafale de 300 trames rejouées par un seul boîtier au
 * sortir d'une zone blanche fait attendre toutes les autres organisations,
 * et un réessai (jusqu'à 30 s de recul) les gèle complètement.
 *
 * Cet ordonnanceur découple le rythme de lecture du rythme de traitement :
 *
 *  ① SÉRIALISATION PAR CLÉ — une seule tâche à la fois par clé, dans l'ordre
 *    d'arrivée. La clé est le boîtier : la reconstitution des trajets exige
 *    que ses positions restent ordonnées (cf. Trip.addPosition).
 *
 *  ② TOURNIQUET ENTRE CLÉS — à chaque créneau libre, on sert la clé suivante
 *    qui attend, pas la plus bavarde. Un boîtier avec 300 trames en attente
 *    consomme UN créneau à son tour, exactement comme un boîtier qui en a
 *    une seule. C'est ce qui garantit qu'aucune organisation n'est bloquée
 *    par la rafale d'une autre.
 *
 *  ③ CONTRE-PRESSION BORNÉE — la file totale est plafonnée. Au-delà,
 *    `waitForSlot()` fait patienter l'appelant, qui diffère son
 *    acquittement : le broker cesse d'envoyer (fenêtre `receiveMaximum`) et
 *    retient la suite dans la session persistante. On ralentit, on ne perd
 *    rien et on ne gonfle pas la mémoire.
 *
 * Aucune dépendance : ni AdonisJS, ni base, ni réseau. Testable en mémoire.
 */
export interface FairSchedulerOptions {
  /** Tâches exécutées simultanément, toutes clés confondues. */
  concurrency: number
  /** Profondeur totale au-delà de laquelle `waitForSlot()` fait patienter. */
  maxQueueLength: number
  /**
   * Profondeur par clé. Une rafale plus longue est acceptée mais fait
   * patienter l'appelant POUR CETTE CLÉ : le boîtier bavard se régule
   * lui-même sans retarder les autres.
   */
  maxPerKey?: number
}

export interface FairSchedulerStats {
  /** Tâches en cours d'exécution. */
  running: number
  /** Tâches en attente, toutes clés confondues. */
  queued: number
  /** Clés ayant au moins une tâche en attente ou en cours. */
  keys: number
  /** Profondeur de la file la plus chargée, et sa clé. */
  deepestKey: string | null
  deepestQueue: number
  /** Attente maximale observée depuis le démarrage (ms). */
  maxWaitMs: number
  /** Tâches terminées (succès ou échec). */
  completed: number
}

interface Tache {
  readonly executer: () => Promise<unknown>
  readonly resolve: (valeur: unknown) => void
  readonly reject: (raison: unknown) => void
  readonly empileeA: number
}

export class FairScheduler {
  /** FIFO par clé : l'ordre d'arrivée d'un boîtier est préservé. */
  readonly #files = new Map<string, Tache[]>()
  /** Tourniquet : ordre de service des clés. */
  #tourniquet: string[] = []
  /** Clés dont une tâche est en cours — garantit la sérialisation par clé. */
  readonly #actives = new Set<string>()
  #enCours = 0
  #enAttente = 0
  #terminees = 0
  #attenteMaxMs = 0
  /** Réveils en attente d'un créneau (contre-pression). */
  #veilleurs: Array<() => void> = []

  constructor(private readonly options: FairSchedulerOptions) {
    if (options.concurrency < 1) throw new Error('concurrency doit être >= 1')
    if (options.maxQueueLength < 1) throw new Error('maxQueueLength doit être >= 1')
  }

  get stats(): FairSchedulerStats {
    let deepestKey: string | null = null
    let deepestQueue = 0
    for (const [cle, file] of this.#files) {
      if (file.length > deepestQueue) {
        deepestQueue = file.length
        deepestKey = cle
      }
    }
    return {
      running: this.#enCours,
      queued: this.#enAttente,
      keys: new Set([...this.#files.keys(), ...this.#actives]).size,
      deepestKey,
      deepestQueue,
      maxWaitMs: this.#attenteMaxMs,
      completed: this.#terminees,
    }
  }

  /** Vrai quand la file globale a atteint son plafond. */
  get saturated(): boolean {
    return this.#enAttente >= this.options.maxQueueLength
  }

  /**
   * Empile une tâche pour cette clé et rend la main immédiatement.
   *
   * La promesse retournée se résout quand LA TÂCHE s'achève — l'appelant
   * peut donc l'ignorer (traitement différé) ou l'attendre (test, arrêt).
   */
  enqueue<T>(key: string, executer: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const file = this.#files.get(key)
      const tache: Tache = {
        executer: executer as () => Promise<unknown>,
        resolve: resolve as (valeur: unknown) => void,
        reject,
        empileeA: Date.now(),
      }

      if (file) {
        file.push(tache)
      } else {
        this.#files.set(key, [tache])
        this.#tourniquet.push(key)
      }
      this.#enAttente += 1
      this.#pomper()
    })
  }

  /**
   * Attend qu'un créneau se libère — pour la file globale, et pour CETTE clé
   * si un plafond par clé est configuré.
   *
   * À appeler avant d'acquitter un message : c'est le point où la
   * contre-pression remonte jusqu'au broker.
   */
  async waitForSlot(key?: string): Promise<void> {
    while (this.#satureePour(key)) {
      await new Promise<void>((resolve) => this.#veilleurs.push(resolve))
    }
  }

  /** Attend la fin de TOUTES les tâches (arrêt gracieux, tests). */
  async drain(): Promise<void> {
    while (this.#enAttente > 0 || this.#enCours > 0) {
      await new Promise<void>((resolve) => this.#veilleurs.push(resolve))
    }
  }

  // -------------------------------------------------------------------------

  #satureePour(key?: string): boolean {
    if (this.saturated) return true
    const plafond = this.options.maxPerKey
    if (!plafond || !key) return false
    return (this.#files.get(key)?.length ?? 0) >= plafond
  }

  /**
   * Sert les clés à tour de rôle, dans la limite de la concurrence.
   *
   * Le tourniquet est consommé par rotation : la clé servie repasse en fin
   * de liste si elle a encore des tâches. C'est ce qui empêche une file
   * profonde de monopoliser les créneaux.
   */
  #pomper(): void {
    while (this.#enCours < this.options.concurrency && this.#tourniquet.length > 0) {
      const cle = this.#prochaineCleServable()
      if (!cle) return // toutes les clés en attente sont déjà actives

      const file = this.#files.get(cle)!
      const tache = file.shift()!
      if (file.length === 0) this.#files.delete(cle)
      else this.#tourniquet.push(cle) // son tour revient après les autres

      this.#enAttente -= 1
      this.#enCours += 1
      this.#actives.add(cle)
      this.#attenteMaxMs = Math.max(this.#attenteMaxMs, Date.now() - tache.empileeA)

      void this.#executer(cle, tache)
    }
  }

  /** Prochaine clé en attente qui n'a pas déjà une tâche en cours. */
  #prochaineCleServable(): string | null {
    for (let i = 0; i < this.#tourniquet.length; i += 1) {
      const cle = this.#tourniquet.shift()!
      if (!this.#files.has(cle)) continue // file vidée entre-temps
      if (this.#actives.has(cle)) {
        this.#tourniquet.push(cle) // sérialisation : on la repousse
        continue
      }
      return cle
    }
    return null
  }

  async #executer(cle: string, tache: Tache): Promise<void> {
    try {
      tache.resolve(await tache.executer())
    } catch (err) {
      // L'échec d'une tâche ne doit JAMAIS interrompre l'ordonnanceur :
      // il est rendu à l'appelant, qui décide de réessayer ou d'abandonner.
      tache.reject(err)
    } finally {
      this.#enCours -= 1
      this.#terminees += 1
      this.#actives.delete(cle)
      this.#reveiller()
      this.#pomper()
    }
  }

  #reveiller(): void {
    const veilleurs = this.#veilleurs
    this.#veilleurs = []
    for (const reveil of veilleurs) reveil()
  }
}
