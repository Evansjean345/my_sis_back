import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * =========================================================================
 *  node ace sisbm:schedules:enforce — IMMOBILISATION PLANIFIÉE
 * =========================================================================
 *
 * Applique les calendriers d'utilisation (`usage_schedules`) aux véhicules
 * qui les suivent, directement (`vehicle_schedules`) ou par leur groupe
 * (`vehicle_schedule_groups`) : coupe le moteur hors des plages autorisées
 * (ou pendant les plages interdites), le rétablit à la réouverture.
 *
 *   node ace sisbm:schedules:enforce --watch          # service : un passage par minute
 *   node ace sisbm:schedules:enforce                  # un seul passage (cron, systemd timer)
 *   node ace sisbm:schedules:enforce --dry-run        # ce qui serait fait, sans rien émettre
 *   node ace sisbm:schedules:enforce --dry-run --at=2026-11-03T22:30:00Z
 *   node ace sisbm:schedules:enforce --vehicle=<uuid> # un seul véhicule
 *
 * PROCESSUS SÉPARÉ de l'API, comme `sisbm:ingest`. Une SEULE instance agit à
 * la fois : un verrou Redis l'impose (une deuxième instance passe son tour).
 * CM-09 empêcherait de toute façon deux commandes simultanées sur un même
 * boîtier, mais deux moteurs concurrents produiraient des refus inutiles.
 *
 * Toutes les coupures passent par les cas d'usage de l'opérateur : garde-fou
 * de vitesse (CM-07), une commande en vol par boîtier (CM-09), relais
 * présent, `immobilization_enabled` du véhicule et IMMOBILIZATION_ENABLED.
 */
export default class SchedulesEnforce extends BaseCommand {
  static commandName = 'sisbm:schedules:enforce'
  static description =
    'Applique les calendriers d’utilisation : immobilisation et rétablissement planifiés'
  static options: CommandOptions = { startApp: true, staysAlive: true }

  @flags.boolean({
    description: 'Boucle : un passage toutes les SCHEDULE_ENFORCE_INTERVAL_SECONDS',
  })
  declare watch: boolean

  @flags.boolean({ description: 'Simulation : affiche les décisions, n’émet et n’écrit rien' })
  declare dryRun: boolean

  @flags.string({ description: 'Instant simulé (ISO 8601) — avec --dry-run uniquement' })
  declare at: string

  @flags.string({ description: 'Limite le passage à un véhicule (uuid)' })
  declare vehicle: string

  @flags.string({ description: 'Limite le passage à une organisation (uuid)' })
  declare organization: string

  #arret = false
  #jeton = `${process.pid}-${Math.random().toString(36).slice(2)}`

  async run() {
    const { default: sisbmConfig } = await import('#config/sisbm')
    const { EnforceUsageSchedules } =
      await import('#application/scheduling/use_cases/enforce_usage_schedules')
    const { default: redis } = await import('@adonisjs/redis/services/main')

    const planif = sisbmConfig.schedules
    if (!this.dryRun && !planif.enabled) {
      this.logger.error(
        'SCHEDULE_ENFORCEMENT_ENABLED=false : moteur planifié désactivé (--dry-run reste possible)'
      )
      this.exitCode = 1
      return this.terminate()
    }
    if (!this.dryRun && !sisbmConfig.immobilization.enabled) {
      this.logger.error(
        'IMMOBILIZATION_ENABLED=false : aucune coupure ne peut partir. Moteur planifié non démarré.'
      )
      this.exitCode = 1
      return this.terminate()
    }
    if (this.at && !this.dryRun) {
      this.logger.error('--at n’a de sens qu’en simulation : ajouter --dry-run')
      this.exitCode = 1
      return this.terminate()
    }
    const at = this.at ? new Date(this.at) : undefined
    if (at && Number.isNaN(at.getTime())) {
      this.logger.error(`--at illisible : ${this.at}`)
      this.exitCode = 1
      return this.terminate()
    }

    const enforcer = await this.app.container.make(EnforceUsageSchedules)
    const cleVerrou = 'sisbm:schedules:enforce:lock'
    const dureeVerrouMs = Math.max(planif.intervalSeconds * 3, 120) * 1000

    const passage = async () => {
      if (!this.dryRun) {
        const pris = await this.prendreVerrou(redis, cleVerrou, dureeVerrouMs)
        if (!pris) {
          this.logger.warning('une autre instance du moteur détient le verrou : passage ignoré')
          return
        }
      }
      const debut = Date.now()
      const r = await enforcer.execute({
        dryRun: this.dryRun,
        at,
        vehicleIds: this.vehicle ? [this.vehicle] : undefined,
        organizationId: this.organization || undefined,
      })
      if (!r.ok) {
        this.logger.error(`${r.error.code} : ${r.error.message}`)
        return
      }
      const rapport = r.value
      for (const e of rapport.entries) {
        if (!this.dryRun && e.outcome === 'idle') continue
        const cal = e.schedule ? ` « ${e.schedule.name} » (${e.schedule.source})` : ''
        const issue = e.errorCode
          ? ` → refus ${e.errorCode}`
          : e.commandId
            ? ` → commande ${e.commandId} ${e.commandStatus}`
            : ''
        this.logger.info(
          `${e.registration} : ${e.desired} [${e.cause}]${cal} — ${e.outcome}` +
            `${e.action ? ` (${e.action})` : ''}${issue}`
        )
      }
      this.logger.info(
        `${this.dryRun ? '[simulation] ' : ''}${rapport.evaluated} véhicule(s) évalué(s), ` +
          `${rapport.dispatched} commande(s) émise(s), ${rapport.refused} refus — ${Date.now() - debut} ms`
      )
    }

    const arreter = async () => {
      if (this.#arret) return
      this.#arret = true
      await this.libererVerrou(redis, cleVerrou).catch(() => undefined)
      this.logger.info('moteur planifié arrêté')
      await this.terminate()
    }
    process.on('SIGINT', () => void arreter())
    process.on('SIGTERM', () => void arreter())

    if (!this.watch) {
      await passage().catch((err) => {
        this.logger.error(`passage interrompu : ${(err as Error).message}`)
        this.exitCode = 1
      })
      return arreter()
    }

    this.logger.info(
      `moteur planifié démarré : un passage toutes les ${planif.intervalSeconds} s${this.dryRun ? ' (simulation)' : ''}`
    )
    while (!this.#arret) {
      await passage().catch((err) =>
        this.logger.error(`passage interrompu : ${(err as Error).message}`)
      )
      await new Promise((r) => setTimeout(r, planif.intervalSeconds * 1000))
    }
  }

  /** SET NX PX, renouvelé à chaque passage par son détenteur. */
  private async prendreVerrou(
    redis: {
      set: (...args: any[]) => Promise<unknown>
      get: (k: string) => Promise<string | null>
      pexpire: (k: string, ms: number) => Promise<unknown>
    },
    cle: string,
    dureeMs: number
  ): Promise<boolean> {
    const pris = await redis.set(cle, this.#jeton, 'PX', dureeMs, 'NX')
    if (pris === 'OK') return true
    if ((await redis.get(cle)) === this.#jeton) {
      await redis.pexpire(cle, dureeMs)
      return true
    }
    return false
  }

  private async libererVerrou(
    redis: { get: (k: string) => Promise<string | null>; del: (k: string) => Promise<unknown> },
    cle: string
  ) {
    if ((await redis.get(cle)) === this.#jeton) await redis.del(cle)
  }
}
