import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { TransactionScope } from '#application/ports'
import type {
  DeliveryStatus,
  NewSmsNotification,
  NotificationJournal,
  SmsBalanceLedger,
  SmsBalanceSnapshot,
  SmsReservation,
} from '#application/notification/ports'

/**
 * Adaptateurs de persistance du contexte Notification :
 *   `notifications` (journal par message) et `sms_balance` (solde global).
 */

const client = (tx?: TransactionScope) => (tx?.raw as TransactionClientContract | undefined) ?? db

/** `error_message` est un texte libre : borné pour ne pas gonfler la table. */
const borne = (s: string, max = 500) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

// ---------------------------------------------------------------------------
// Journal `notifications`
// ---------------------------------------------------------------------------

export class LucidNotificationJournal implements NotificationJournal {
  async reserve(entry: NewSmsNotification, tx?: TransactionScope): Promise<SmsReservation | null> {
    const c = client(tx)
    const insere = await c.rawQuery(
      `INSERT INTO notifications (organization_id, channel, subject, recipient_user_id,
                                  recipient_address, template_code, body, status, attempts,
                                  provider, segments, dedup_key, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?, ?, ?, ?::jsonb)
       ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        entry.organizationId,
        entry.channel ?? 'sms',
        entry.subject ?? null,
        entry.recipientUserId,
        entry.recipientAddress,
        entry.templateCode,
        entry.body,
        entry.provider,
        entry.segments,
        entry.dedupKey,
        JSON.stringify(entry.payload ?? {}),
      ]
    )
    if (insere.rows?.length) return { notificationId: insere.rows[0].id, retried: false }

    // Clé déjà vue : seul un échec antérieur justifie un nouvel essai.
    const repris = await c.rawQuery(
      `UPDATE notifications
          SET status = 'queued', attempts = least(attempts + 1, 10), failed_at = NULL,
              error_message = NULL, next_retry_at = NULL, queued_at = now(),
              provider = ?, segments = ?
        WHERE dedup_key = ? AND status = 'failed' AND attempts < 10
        RETURNING id`,
      [entry.provider, entry.segments, entry.dedupKey]
    )
    return repris.rows?.length ? { notificationId: repris.rows[0].id, retried: true } : null
  }

  async markSent(
    notificationId: string,
    sent: { providerMessageId: string; segments: number; at: Date },
    tx?: TransactionScope
  ): Promise<void> {
    await client(tx)
      .from('notifications')
      .where('id', notificationId)
      .update({
        status: 'sent',
        provider_message_id: sent.providerMessageId,
        segments: Math.max(sent.segments, 1),
        sent_at: sent.at,
      })
  }

  async markFailed(
    notificationId: string,
    failure: { errorCode: string; errorMessage: string; at: Date },
    tx?: TransactionScope
  ): Promise<void> {
    await client(tx)
      .from('notifications')
      .where('id', notificationId)
      .update({
        status: 'failed',
        failed_at: failure.at,
        error_message: borne(`${failure.errorCode} : ${failure.errorMessage}`),
      })
  }

  /**
   * Transitions permises : queued/sending → sent ; tout sauf delivered →
   * delivered ou failed. Un accusé `sent` arrivé APRÈS `delivered` (Twilio
   * ne garantit pas l'ordre des webhooks) est donc sans effet.
   */
  async applyDeliveryStatus(
    providerMessageId: string,
    status: DeliveryStatus,
    at: Date,
    error?: { errorCode: string; errorMessage: string }
  ): Promise<boolean> {
    const existe = await db
      .from('notifications')
      .where('provider_message_id', providerMessageId)
      .select('id')
      .first()
    if (!existe) return false

    const q = db.from('notifications').where('id', existe.id)
    if (status === 'sent') {
      await q.whereIn('status', ['queued', 'sending']).update({ status: 'sent', sent_at: at })
    } else if (status === 'delivered') {
      await q.whereNot('status', 'delivered').update({
        status: 'delivered',
        delivered_at: at,
        failed_at: null,
        error_message: null,
      })
    } else {
      await q.whereNot('status', 'delivered').update({
        status: 'failed',
        failed_at: at,
        error_message: error ? borne(`${error.errorCode} : ${error.errorMessage}`) : null,
      })
    }
    return true
  }
}

// ---------------------------------------------------------------------------
// Solde global `sms_balance` (ligne unique id = 1)
// ---------------------------------------------------------------------------

interface BalanceRow {
  provider: string
  balance_credits: number
  total_sent: string | number
  low_balance_threshold: number
  last_topup_at: Date | string | null
}

const toSnapshot = (r: BalanceRow): SmsBalanceSnapshot => ({
  provider: r.provider,
  balanceCredits: Number(r.balance_credits),
  totalSent: Number(r.total_sent),
  lowBalanceThreshold: Number(r.low_balance_threshold),
  lastTopupAt: r.last_topup_at ? new Date(r.last_topup_at) : null,
})

export class LucidSmsBalanceLedger implements SmsBalanceLedger {
  /** Requête atomique de la migration 015 : 0 ligne modifiée = solde insuffisant. */
  async debit(segments: number, tx?: TransactionScope) {
    const r = await client(tx).rawQuery(
      `UPDATE sms_balance
          SET balance_credits = balance_credits - ?, total_sent = total_sent + ?
        WHERE id = 1 AND balance_credits >= ?
        RETURNING balance_credits, low_balance_threshold`,
      [segments, segments, segments]
    )
    const ligne = r.rows?.[0]
    return ligne
      ? {
          balanceCredits: Number(ligne.balance_credits),
          lowBalanceThreshold: Number(ligne.low_balance_threshold),
        }
      : null
  }

  async refund(segments: number, tx?: TransactionScope): Promise<void> {
    await client(tx).rawQuery(
      `UPDATE sms_balance
          SET balance_credits = balance_credits + ?, total_sent = greatest(total_sent - ?, 0)
        WHERE id = 1`,
      [segments, segments]
    )
  }

  /** Jamais sous zéro : l'écart de comptage ne doit pas faire échouer un envoi déjà parti. */
  async adjust(delta: number, tx?: TransactionScope): Promise<void> {
    if (delta === 0) return
    await client(tx).rawQuery(
      `UPDATE sms_balance
          SET balance_credits = greatest(balance_credits - ?, 0),
              total_sent      = greatest(total_sent + ?, 0)
        WHERE id = 1`,
      [delta, delta]
    )
  }

  async read(tx?: TransactionScope): Promise<SmsBalanceSnapshot> {
    const ligne = (await client(tx).from('sms_balance').where('id', 1).first()) as BalanceRow | null
    if (!ligne) {
      throw new Error('sms_balance : ligne id = 1 absente (migration 015 non appliquée ?)')
    }
    return toSnapshot(ligne)
  }

  async topUp(credits: number, at: Date, tx?: TransactionScope): Promise<SmsBalanceSnapshot> {
    const r = await client(tx).rawQuery(
      `UPDATE sms_balance
          SET balance_credits = balance_credits + ?, last_topup_at = ?
        WHERE id = 1
        RETURNING provider, balance_credits, total_sent, low_balance_threshold, last_topup_at`,
      [credits, at]
    )
    return toSnapshot(r.rows[0] as BalanceRow)
  }
}
