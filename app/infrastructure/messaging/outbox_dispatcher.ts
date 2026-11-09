import db from '@adonisjs/lucid/services/db'
import type { OutboxHandler, OutboxMessage } from '#application/ports'

export interface OutboxDispatcherConfig {
  batchSize: number
  maxAttempts: number
  /** Délai de base du nouvel essai ; doublé à chaque tentative, plafonné à 1 h. */
  retryBaseSeconds: number
  /** Un message `processing` plus vieux est réputé abandonné (worker tombé). */
  staleLockSeconds: number
}

export interface DispatchReport {
  claimed: number
  published: number
  retried: number
  failed: number
}

export type DispatchLogger = (
  level: 'info' | 'warn' | 'error',
  message: string,
  meta: Record<string, unknown>
) => void

/**
 * =========================================================================
 *  DISPATCHER OUTBOX — consommation de `outbox_messages`
 * =========================================================================
 *
 * Moitié manquante du Transactional Outbox : les cas d'usage ÉCRIVENT leurs
 * événements dans la transaction métier (LucidUnitOfWork) ; ce dispatcher
 * les LIT après COMMIT et les remet aux handlers.
 *
 *   ① Réservation : `FOR UPDATE SKIP LOCKED` — plusieurs workers se
 *     partagent la file sans se marcher dessus ni se bloquer.
 *   ② Seuls les topics d'un handler enregistré sont réservés : les
 *     événements de télémétrie restent `pending` pour leur futur consommateur.
 *   ③ Issue : `published`, ou nouvel essai à délai exponentiel, puis
 *     `failed` après `maxAttempts`.
 *   ④ Un message resté `processing` (worker arrêté net) est remis en file
 *     après `staleLockSeconds`. D'où l'exigence d'idempotence des handlers.
 */
export class OutboxDispatcher {
  readonly #parTopic = new Map<string, OutboxHandler>()

  constructor(
    handlers: OutboxHandler[],
    private readonly config: OutboxDispatcherConfig,
    private readonly workerId: string,
    private readonly log: DispatchLogger = () => {}
  ) {
    for (const h of handlers) {
      for (const topic of h.topics) {
        const deja = this.#parTopic.get(topic)
        if (deja) throw new Error(`Topic ${topic} géré par ${deja.name} ET ${h.name}`)
        this.#parTopic.set(topic, h)
      }
    }
  }

  get topics(): string[] {
    return [...this.#parTopic.keys()]
  }

  /** Un passage : réserve un lot, le traite, rend compte. */
  async dispatchOnce(): Promise<DispatchReport> {
    const rapport: DispatchReport = { claimed: 0, published: 0, retried: 0, failed: 0 }
    if (this.#parTopic.size === 0) return rapport

    await this.libererVerrousPerimes()
    const lot = await this.reserver()
    rapport.claimed = lot.length

    for (const message of lot) {
      const handler = this.#parTopic.get(message.topic)!
      let issue: Awaited<ReturnType<OutboxHandler['handle']>>
      try {
        issue = await handler.handle(message)
      } catch (err) {
        issue = { status: 'retry', reason: (err as Error).message }
      }

      if (issue.status === 'done') {
        await this.publier(message.id)
        rapport.published++
        continue
      }

      if (message.attempts >= this.config.maxAttempts) {
        await this.echouer(message.id, issue.reason)
        rapport.failed++
        this.log('error', '[outbox] message abandonné après le dernier essai', {
          id: message.id,
          topic: message.topic,
          attempts: message.attempts,
          reason: issue.reason,
        })
      } else {
        const delai = Math.min(this.config.retryBaseSeconds * 2 ** (message.attempts - 1), 3600)
        await this.reporter(message.id, delai, issue.reason)
        rapport.retried++
        this.log('warn', '[outbox] nouvel essai programmé', {
          id: message.id,
          topic: message.topic,
          attempts: message.attempts,
          inSeconds: delai,
          reason: issue.reason,
        })
      }
    }
    return rapport
  }

  // -------------------------------------------------------------------------

  private async reserver(): Promise<OutboxMessage[]> {
    const r = await db.rawQuery(
      `UPDATE outbox_messages o
          SET status = 'processing', locked_by = ?, locked_at = now(), attempts = o.attempts + 1
        WHERE o.id IN (
              SELECT id FROM outbox_messages
               WHERE status = 'pending' AND available_at <= now() AND topic = ANY(?)
               ORDER BY available_at, id
               LIMIT ?
               FOR UPDATE SKIP LOCKED)
        RETURNING o.id, o.topic, o.aggregate_id, o.payload, o.attempts`,
      [this.workerId, this.topics, this.config.batchSize]
    )
    return (r.rows ?? [])
      .map((l: Record<string, unknown>) => ({
        id: String(l.id),
        topic: String(l.topic),
        aggregateId: (l.aggregate_id as string | null) ?? null,
        payload:
          typeof l.payload === 'string'
            ? (JSON.parse(l.payload) as Record<string, unknown>)
            : ((l.payload as Record<string, unknown>) ?? {}),
        attempts: Number(l.attempts),
      }))
      .sort((a: OutboxMessage, b: OutboxMessage) => Number(a.id) - Number(b.id))
  }

  private async publier(id: string) {
    await db
      .from('outbox_messages')
      .where('id', id)
      .update({
        status: 'published',
        published_at: db.raw('now()'),
        locked_by: null,
        locked_at: null,
        last_error: null,
      })
  }

  private async reporter(id: string, delaiSecondes: number, raison: string) {
    await db.rawQuery(
      `UPDATE outbox_messages
          SET status = 'pending', locked_by = NULL, locked_at = NULL,
              available_at = now() + (? * interval '1 second'), last_error = ?
        WHERE id = ?`,
      [delaiSecondes, raison.slice(0, 1000), id]
    )
  }

  private async echouer(id: string, raison: string) {
    await db
      .from('outbox_messages')
      .where('id', id)
      .update({
        status: 'failed',
        locked_by: null,
        locked_at: null,
        last_error: raison.slice(0, 1000),
      })
  }

  private async libererVerrousPerimes() {
    const r = await db.rawQuery(
      `UPDATE outbox_messages
          SET status = 'pending', locked_by = NULL, locked_at = NULL
        WHERE status = 'processing' AND topic = ANY(?)
          AND locked_at < now() - (? * interval '1 second')
        RETURNING id`,
      [this.topics, this.config.staleLockSeconds]
    )
    if (r.rows?.length) {
      this.log('warn', '[outbox] messages repris après un arrêt de worker', {
        ids: r.rows.map((l: { id: string }) => l.id),
      })
    }
  }
}
