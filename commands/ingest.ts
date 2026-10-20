import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * =========================================================================
 *  node ace sisbm:ingest — worker d'ingestion télémétrie (broker flespi)
 * =========================================================================
 *
 * PROCESSUS SÉPARÉ de l'API. Une rafale de Store & Forward — un boîtier qui
 * rejoue deux heures de trames au sortir d'une zone blanche — ne doit pas
 * dégrader le temps de réponse des tableaux de bord.
 *
 * Source : mqtt.flespi.io, topic `flespi/message/gw/devices/+` (un message
 * par publication), authentification par jeton flespi.
 *
 *   node ace sisbm:ingest                  # écoute le broker flespi
 *   node ace sisbm:ingest --dry-run        # analyse et journalise, sans écrire en base
 *   node ace sisbm:ingest --worker=2       # 2e worker : clientId distinct, souscription partagée
 *   node ace sisbm:ingest --replay-pending # rejoue d'abord les trames restées « pending »
 *
 * DEUX ÉTAPES, et c'est ce qui empêche une rafale de bloquer une autre
 * organisation : le chemin d'acquittement ne contient qu'une écriture brève
 * (journalisation durable), le traitement complet partant à un ordonnanceur
 * équitable — sérialisé par boîtier, parallèle entre boîtiers.
 */
export default class Ingest extends BaseCommand {
  static commandName = 'sisbm:ingest'
  static description = 'Consomme le flux MQTT flespi et alimente la base'

  static options: CommandOptions = { startApp: true, staysAlive: true }

  @flags.boolean({ description: 'Analyse et journalise sans écrire en base' })
  declare dryRun: boolean

  @flags.number({
    description: 'Numéro du worker (clientId distinct, souscription partagée requise)',
  })
  declare worker: number

  @flags.boolean({
    description:
      'Rejoue les trames restées « pending » dans ingest_messages, puis écoute normalement',
  })
  declare replayPending: boolean

  async run() {
    const { default: sisbmConfig } = await import('#config/sisbm')
    const { MqttTelemetryTransport } =
      await import('#infrastructure/gateways/flespi/mqtt_transport')
    const { FlespiFrameParser, FlespiParseError } =
      await import('#infrastructure/gateways/flespi/flespi_frame_parser')
    const { IngestTelemetryFrames } =
      await import('#application/telemetry/use_cases/ingest_telemetry_frames')
    const { LucidUnitOfWork } = await import('#infrastructure/persistence/unit_of_work')
    const {
      LucidPositionRepository,
      LucidVehicleLastPositionRepository,
      LucidIngestMessageRepository,
    } = await import('#infrastructure/persistence/repositories/telemetry_repositories')
    const { LucidTripRepository } =
      await import('#infrastructure/persistence/repositories/trip_repository')
    const { CachedDeviceResolver } =
      await import('#infrastructure/persistence/readers/device_resolver')
    const { TransmitBroadcaster } = await import('#infrastructure/realtime/transmit_broadcaster')
    const { SystemClock } = await import('#infrastructure/services/clock')
    const { UuidGenerator } = await import('#infrastructure/services/id_generator')
    const { FairScheduler } = await import('#infrastructure/telemetry/fair_scheduler')

    const flespi = sisbmConfig.flespi
    if (!flespi.mqttToken) {
      this.logger.error(
        'FLESPI_MQTT_TOKEN (ou FLESPI_TOKEN) absent : impossible de se connecter au broker flespi'
      )
      this.exitCode = 1
      return await this.terminate()
    }
    if (this.worker && !flespi.shareGroup) {
      this.logger.warning(
        'Plusieurs workers sans FLESPI_MQTT_SHARE_GROUP : chacun recevra TOUS les messages (doublons).'
      )
    }

    const parser = new FlespiFrameParser()
    /**
     * Journal des trames BRUTES, écrit AVANT tout acquittement : c'est lui qui
     * autorise le traitement différé sans rien perdre. Une trame journalisée
     * mais pas encore traitée reste `pending` dans `ingest_messages` — visible
     * et rejouable.
     */
    const journal = new LucidIngestMessageRepository()
    /**
     * Ordonnanceur équitable : sérialisé PAR BOÎTIER (l'ordre des positions
     * fait les trajets), parallèle ENTRE boîtiers. Une rafale de Store &
     * Forward consomme un créneau à son tour, jamais toute la capacité.
     */
    const ordonnanceur = new FairScheduler({
      concurrency: sisbmConfig.ingestion.concurrency,
      maxQueueLength: sisbmConfig.ingestion.queueMaxLength,
      maxPerKey: sisbmConfig.ingestion.queueMaxPerDevice,
    })
    const ingestion = new IngestTelemetryFrames(
      new LucidUnitOfWork(),
      new LucidIngestMessageRepository(),
      new LucidPositionRepository(),
      new LucidVehicleLastPositionRepository(),
      new LucidTripRepository(),
      new CachedDeviceResolver(),
      new TransmitBroadcaster(),
      new SystemClock(),
      new UuidGenerator(),
      {
        maxHdop: sisbmConfig.ingestion.maxHdop,
        minSatellites: sisbmConfig.ingestion.minSatellites,
        maxPlausibleSpeedKph: sisbmConfig.ingestion.maxPlausibleSpeedKph,
        maxClockSkewSeconds: 300,
        backlogThresholdSeconds: sisbmConfig.ingestion.backlogThresholdSeconds,
        tripIdleTimeoutSeconds: sisbmConfig.trips.idleTimeoutSeconds,
        tripMaxDurationHours: sisbmConfig.trips.maxDurationHours,
        tripMinDistanceMeters: sisbmConfig.trips.minDistanceMeters,
        idleSpeedThresholdKph: 3,
      }
    )

    const transport = new MqttTelemetryTransport({
      host: flespi.mqttHost,
      port: flespi.mqttPort,
      tls: flespi.mqttTls,
      // STABLE : c'est lui qui retrouve la session persistante au redémarrage.
      clientId: this.worker ? `${flespi.clientId}-${this.worker}` : flespi.clientId,
      username: flespi.mqttToken,
      password: '',
      topics: flespi.topics,
      //à definir pour plusieurs trackers
      shareGroup: flespi.shareGroup || undefined,
      qos: 1,
      reconnectPeriodMs: sisbmConfig.mqtt.reconnectPeriodMs,
      connectTimeoutMs: sisbmConfig.mqtt.connectTimeoutMs,
      receiveMaximum: sisbmConfig.mqtt.maxInflightQueue,
      sessionExpirySeconds: flespi.sessionExpirySeconds,
      //definir pour une flotte
      maxAttempts: 20,
    })

    let traitees = 0
    let persistees = 0
    let rejetees = 0
    let doublons = 0
    /** Rejeux Store & Forward écartés des agrégats, et trajets expirés. */
    let desordre = 0
    let expires = 0
    /** Cumul des motifs de rejet sur la durée de vie du worker. */
    const motifs: Record<string, number> = {}

    /**
     * Un message MQTT = une transaction. Contrat avec le transport :
     *  - rendre la main  → message acquitté (y compris trame illisible, déjà journalisée) ;
     *  - lever           → erreur transitoire (base…), le transport réessaie sans acquitter.
     */
    /**
     * REJEU DES TRAMES EN ATTENTE.
     *
     * Une trame acquittée auprès du broker puis perdue par un incident (base
     * indisponible, arrêt brutal) reste « pending » : le broker ne la renverra
     * plus, c'est donc ici qu'on la récupère. Rejouée par l'ordonnanceur, elle
     * ne retarde aucune organisation.
     */
    const rejouerEnAttente = async () => {
      const lots = await journal.findPending({
        limit: 5000,
        // Marge : on ne rejoue pas ce qui est peut-être en cours de traitement.
        olderThan: new Date(Date.now() - 60_000),
      })
      if (lots.length === 0) {
        this.logger.info('aucune trame en attente à rejouer')
        return
      }
      this.logger.info(`${lots.length} trame(s) en attente — rejeu en cours`)
      let rejouees = 0
      for (const ligne of lots) {
        let frames: Awaited<ReturnType<typeof parser.parse>>
        try {
          frames = parser.parse(JSON.stringify(ligne.payload))
        } catch {
          this.logger.warning(`trame ${ligne.externalId} illisible — ignorée`)
          continue
        }
        const ident = frames[0]?.ident ?? ligne.deviceIdent ?? 'inconnu'
        await ordonnanceur.waitForSlot(ident)
        void ordonnanceur.enqueue(ident, () => traiterLot(frames, ident))
        rejouees += 1
      }
      await ordonnanceur.drain()
      this.logger.success(`${rejouees} trame(s) rejouée(s)`)
    }

    /**
     * Traitement d'un lot — exécuté PAR L'ORDONNANCEUR, hors du chemin
     * d'acquittement. Ses réessais sont donc locaux à ce boîtier : une base
     * lente sur un tracker ne gèle plus les autres organisations.
     */
    const traiterLot = async (
      frames: Awaited<ReturnType<typeof parser.parse>>,
      ident: string
    ): Promise<void> => {
      const maxEssais = 5
      let attente = 250
      for (let essai = 1; ; essai += 1) {
        try {
          const r = await ingestion.execute({ frames })
          if (r.ok) {
            traitees += r.value.received
            persistees += r.value.persisted
            rejetees += r.value.rejected
            doublons += r.value.duplicates
            desordre += r.value.tripOutOfOrder
            expires += r.value.tripsExpired
            for (const [motif, n] of Object.entries(r.value.rejectedReasons)) {
              motifs[motif] = (motifs[motif] ?? 0) + n
            }
            if (r.value.unknownDevices > 0) {
              this.logger.warning(
                `trame d'un boîtier inconnu (${ident}) — enregistrer le boîtier avec cet ident`
              )
            }
            const detailRejets = Object.entries(r.value.rejectedReasons)
              .map(([m, n]) => `${m}×${n}`)
              .join(', ')
            if (detailRejets) {
              this.logger.warning(
                `${ident} : ${r.value.rejected} trame(s) rejetée(s) — ${detailRejets}`
              )
            }
            if (r.value.duplicates > 0) {
              this.logger.info(`${r.value.duplicates} trame(s) déjà connue(s) — ignorée(s)`)
            }
            if (r.value.tripOutOfOrder > 0) {
              this.logger.info(
                `${ident} : ${r.value.tripOutOfOrder} point(s) hors ordre — écartés des agrégats`
              )
            }
          } else {
            rejetees += frames.length
            this.logger.error(`ingestion refusée (${ident}) : ${r.error.code} — ${r.error.message}`)
          }
          return
        } catch (err) {
          const code = String((err as { code?: unknown }).code ?? '')
          const donneeInvalide = ['22', '23'].includes(code.slice(0, 2))

          if (donneeInvalide || essai >= maxEssais) {
            /**
             * On n'interrompt PAS le worker. Les trames restent `pending` dans
             * `ingest_messages` — durables, donc rejouables — et les autres
             * organisations continuent d'être servies. C'était l'inverse
             * auparavant : une seule trame arrêtait toute la flotte.
             */
            rejetees += frames.length
            this.logger.error(
              `${ident} : lot abandonné après ${essai} tentative(s)` +
                (code ? ` (SQLSTATE ${code})` : '') +
                ' — trames conservées en « pending », rejouables après correction'
            )
            return
          }

          this.logger.warning(
            `${ident} : échec de traitement (essai ${essai}/${maxEssais}) — ` +
              `nouvel essai dans ${attente} ms`
          )
          await new Promise((r) => setTimeout(r, attente))
          attente = Math.min(attente * 2, 4000)
        }
      }
    }

    if (this.replayPending && !this.dryRun) await rejouerEnAttente()

    await transport.subscribe(
      async (raw, topic) => {
        let frames: Awaited<ReturnType<typeof parser.parse>>
        try {
          frames = parser.parse(raw, topic)
        } catch (err) {
          rejetees += 1
          motifs.illisible = (motifs.illisible ?? 0) + 1
          const detail = err instanceof FlespiParseError ? err.detail : (err as Error).message
          this.logger.warning(`trame ignorée sur ${topic} : ${detail}`)
          return
        }

        if (this.dryRun) {
          for (const f of frames) {
            this.logger.info(
              `[dry-run] ${f.ident} ${f.recordedAt.toISOString()} ${f.latitude},${f.longitude} ` +
                `${f.speedKph} km/h ign=${f.ignition} sat=${f.satellites}`
            )
          }
          traitees += frames.length
          return
        }

        const ident = frames[0]?.ident ?? topic

        /**
         * ÉTAPE 1 — durabilité, PUIS acquittement.
         *
         * Une petite écriture idempotente par trame : c'est tout ce qui reste
         * dans le chemin séquentiel de MQTT.js. Le traitement complet
         * (qualité, positions, trajets, diffusion) part à l'étape 2.
         */
        for (const f of frames) {
          await journal.record({
            source: 'flespi',
            externalId: f.externalId,
            deviceIdent: f.ident,
            deviceId: null,
            payload: f.raw,
            receivedAt: f.receivedAt,
          })
        }

        /**
         * ÉTAPE 2 — contre-pression, puis empilage.
         *
         * `waitForSlot` diffère l'acquittement quand la file est pleine : le
         * broker retient la suite dans sa session persistante plutôt que de
         * laisser le process gonfler en mémoire. L'empilage rend la main
         * immédiatement — c'est ce qui débloque les autres organisations.
         */
        await ordonnanceur.waitForSlot(ident)
        void ordonnanceur.enqueue(ident, () => traiterLot(frames, ident))
      },
      /**
       * Panne définitive (schéma de base incompatible, privilèges manquants,
       * tentatives épuisées) : on sort en erreur au lieu de boucler. Les
       * messages restent dans la session flespi et seront rejoués au
       * redémarrage — aucune trame n'est perdue, mais le superviseur voit
       * l'échec au lieu d'un worker « vivant » qui ne persiste plus rien.
       */
      (err) => {
        this.logger.error(`ingestion arrêtée : ${err.message}`)
        this.exitCode = 1
        void this.terminate()
      }
    )

    this.logger.success(
      `écoute de ${transport.subscriptions.join(', ')} sur ${flespi.mqttHost}:${flespi.mqttPort} (QoS 1)`
    )
    if (this.dryRun) this.logger.warning('mode dry-run : aucune écriture en base')

    const resume = () => {
      const parMotif = Object.entries(motifs)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${m}×${n}`)
        .join(', ')
      const o = ordonnanceur.stats
      return (
        `${transport.received} reçue(s) · ${persistees} persistée(s) · ` +
        `${doublons} doublon(s) · ${rejetees} rejetée(s)` +
        (desordre ? ` · ${desordre} hors ordre` : '') +
        (expires ? ` · ${expires} trajet(s) expiré(s)` : '') +
        (parMotif ? ` [${parMotif}]` : '') +
        // L'état de l'ordonnanceur : c'est lui qui dit si une rafale est en
        // cours d'absorption, et sur quel boîtier.
        ` · file=${o.queued}/${o.running} clés=${o.keys}` +
        (o.deepestKey ? ` (plus chargée : ${o.deepestKey}×${o.deepestQueue})` : '') +
        (ordonnanceur.saturated ? ' · CONTRE-PRESSION' : '')
      )
    }

    const bilan = setInterval(() => {
      this.logger.info(`bilan : ${resume()} · connecté=${transport.isConnected}`)
    }, 60_000)
    bilan.unref()

    /**
     * Arrêt gracieux : on vide le lot en cours, on laisse les transactions se
     * terminer, puis on ferme. `tini` en PID 1 dans le Dockerfile est ce qui
     * rend le SIGTERM recevable par Node.
     */
    const arreter = async (signal: string) => {
      this.logger.info(`${signal} reçu — arrêt en cours`)
      clearInterval(bilan)
      await transport.disconnect()

      /**
       * On vide l'ordonnanceur AVANT de rendre la main : les lots déjà
       * acquittés ne reviendront pas par le broker. Ils sont durables
       * (`ingest_messages` en « pending »), mais les terminer ici évite un
       * rattrapage inutile au redémarrage. Borné : un arrêt ne doit pas
       * traîner si une base ne répond plus.
       */
      const videe = ordonnanceur.drain()
      const delai = new Promise<void>((r) => setTimeout(r, 15_000).unref?.())
      await Promise.race([videe, delai])
      const restant = ordonnanceur.stats
      if (restant.queued + restant.running > 0) {
        this.logger.warning(
          `${restant.queued + restant.running} lot(s) non terminé(s) — conservés en ` +
            '« pending » dans ingest_messages, repris au redémarrage'
        )
      }

      this.logger.success(`arrêté. Bilan : ${resume()} · ${traitees} trame(s) analysée(s)`)
      await this.terminate()
    }

    process.on('SIGTERM', () => void arreter('SIGTERM'))
    process.on('SIGINT', () => void arreter('SIGINT'))
  }
}
