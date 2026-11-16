import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * =========================================================================
 *  node ace sisbm:outbox:dispatch — CONSOMMATION DE L'OUTBOX
 * =========================================================================
 *
 * Remet les événements de domaine validés (COMMIT) à leurs handlers. Premier
 * consommateur : les SMS du cycle de vie des comptes (Twilio).
 *
 *   node ace sisbm:outbox:dispatch --watch     # service (pm2 / systemd)
 *   node ace sisbm:outbox:dispatch             # un seul passage (cron)
 *
 * PROCESSUS SÉPARÉ de l'API, comme `sisbm:ingest` et `sisbm:schedules:enforce`.
 * Plusieurs instances peuvent tourner : la réservation `SKIP LOCKED` répartit
 * les messages sans doublon.
 */
export default class OutboxDispatch extends BaseCommand {
  static commandName = 'sisbm:outbox:dispatch'
  static description = 'Publie les événements de l’outbox vers leurs handlers (SMS des comptes…)'
  static options: CommandOptions = { startApp: true, staysAlive: true }

  @flags.boolean({ description: 'Boucle : un passage toutes les OUTBOX_POLL_INTERVAL_MS' })
  declare watch: boolean

  #arret = false

  async run() {
    const { default: sisbmConfig } = await import('#config/sisbm')
    const { OutboxDispatcher } = await import('#infrastructure/messaging/outbox_dispatcher')

    const dispatcher = await this.app.container.make(OutboxDispatcher)
    this.logger.info(`topics consommés : ${dispatcher.topics.join(', ')}`)

    const passage = async () => {
      const r = await dispatcher.dispatchOnce()
      if (r.claimed > 0) {
        this.logger.info(
          `${r.claimed} message(s) : ${r.published} publié(s), ${r.retried} reporté(s), ${r.failed} abandonné(s)`
        )
      }
      return r
    }

    if (!this.watch) {
      await passage()
      return this.terminate()
    }

    const arreter = () => {
      this.#arret = true
    }
    process.once('SIGINT', arreter)
    process.once('SIGTERM', arreter)

    const intervalle = sisbmConfig.outbox.pollIntervalMs
    while (!this.#arret) {
      try {
        const r = await passage()
        // Lot plein : il en reste probablement, on enchaîne sans attendre.
        if (r.claimed >= sisbmConfig.outbox.batchSize) continue
      } catch (err) {
        this.logger.error(`passage en échec : ${(err as Error).message}`)
      }
      await new Promise((resolve) => setTimeout(resolve, intervalle))
    }
    this.logger.info('arrêt demandé : dispatcher arrêté proprement')
    await this.terminate()
  }
}
