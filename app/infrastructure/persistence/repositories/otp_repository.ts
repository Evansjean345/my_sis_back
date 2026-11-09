import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { TransactionScope } from '#application/ports'
import type { NewOtp, OtpRecord, OtpRepository } from '#application/identity/ports'
import type { OtpIssuanceStats, OtpPurpose } from '#domain/identity/otp_policy'

/**
 * Adaptateur de la table `otps` (migration 021). Traduction pure : la
 * politique (expiration, plafond, délai de renvoi) vit dans
 * `domain/identity/otp_policy.ts`.
 */

const client = (tx?: TransactionScope) => (tx?.raw as TransactionClientContract | undefined) ?? db

const date = (v: unknown): Date | null =>
  v === null || v === undefined ? null : new Date(v as string)

interface OtpRow {
  id: string
  user_id: string
  purpose: OtpPurpose
  recipient: string
  code_hash: string
  attempts: number
  max_attempts: number
  expires_at: Date | string
  consumed_at: Date | string | null
  invalidated_at: Date | string | null
  created_at: Date | string
}

const toRecord = (r: OtpRow): OtpRecord => ({
  id: r.id,
  userId: r.user_id,
  purpose: r.purpose,
  recipient: r.recipient,
  codeHash: r.code_hash,
  attempts: Number(r.attempts),
  maxAttempts: Number(r.max_attempts),
  expiresAt: new Date(r.expires_at),
  consumedAt: date(r.consumed_at),
  invalidatedAt: date(r.invalidated_at),
  createdAt: new Date(r.created_at),
})

export class LucidOtpRepository implements OtpRepository {
  async issuanceStats(
    userId: string,
    purpose: OtpPurpose,
    since: Date,
    tx?: TransactionScope
  ): Promise<OtpIssuanceStats> {
    const ligne = await client(tx)
      .from('otps')
      .where('user_id', userId)
      .where('purpose', purpose)
      .where('created_at', '>=', since)
      .select(client(tx).raw('max(created_at) as last_issued_at'))
      .select(client(tx).raw('count(*)::int as issued'))
      .first()
    return {
      lastIssuedAt: date(ligne?.last_issued_at),
      issuedLastHour: Number(ligne?.issued ?? 0),
    }
  }

  async invalidateActive(
    userId: string,
    purpose: OtpPurpose,
    at: Date,
    tx?: TransactionScope
  ): Promise<void> {
    await client(tx)
      .from('otps')
      .where('user_id', userId)
      .where('purpose', purpose)
      .whereNull('consumed_at')
      .whereNull('invalidated_at')
      .update({ invalidated_at: at })
  }

  /**
   * `ON CONFLICT … DO NOTHING` sur l'index partiel `uq_otps_active` : une
   * demande concurrente qui a déjà inséré son code fait renvoyer `false`
   * au lieu de lever une violation d'unicité.
   */
  async insert(otp: NewOtp, tx?: TransactionScope): Promise<boolean> {
    const r = await client(tx).rawQuery(
      `INSERT INTO otps (id, user_id, purpose, channel, recipient, code_hash, max_attempts,
                         expires_at, created_at, requested_ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::inet, ?)
       ON CONFLICT (user_id, purpose) WHERE consumed_at IS NULL AND invalidated_at IS NULL
       DO NOTHING
       RETURNING id`,
      [
        otp.id,
        otp.userId,
        otp.purpose,
        otp.channel,
        otp.recipient,
        otp.codeHash,
        otp.maxAttempts,
        otp.expiresAt,
        otp.createdAt,
        otp.requestedIp,
        otp.userAgent?.slice(0, 500) ?? null,
      ]
    )
    return (r.rows?.length ?? 0) > 0
  }

  async findActiveForUpdate(
    userId: string,
    purpose: OtpPurpose,
    tx: TransactionScope
  ): Promise<OtpRecord | null> {
    const ligne = (await client(tx)
      .from('otps')
      .where('user_id', userId)
      .where('purpose', purpose)
      .whereNull('consumed_at')
      .whereNull('invalidated_at')
      .orderBy('created_at', 'desc')
      .forUpdate()
      .first()) as OtpRow | null
    return ligne ? toRecord(ligne) : null
  }

  async registerFailedAttempt(
    id: string,
    invalidateAt: Date | null,
    tx: TransactionScope
  ): Promise<void> {
    await client(tx)
      .from('otps')
      .where('id', id)
      .update({
        attempts: client(tx).raw('attempts + 1'),
        ...(invalidateAt ? { invalidated_at: invalidateAt } : {}),
      })
  }

  async consume(id: string, at: Date, tx: TransactionScope): Promise<void> {
    await client(tx)
      .from('otps')
      .where('id', id)
      .whereNull('consumed_at')
      .update({ consumed_at: at })
  }

  async invalidate(id: string, at: Date, tx?: TransactionScope): Promise<void> {
    await client(tx)
      .from('otps')
      .where('id', id)
      .whereNull('consumed_at')
      .whereNull('invalidated_at')
      .update({ invalidated_at: at })
  }

  async attachNotification(id: string, notificationId: string): Promise<void> {
    await db.from('otps').where('id', id).update({ notification_id: notificationId })
  }
}
