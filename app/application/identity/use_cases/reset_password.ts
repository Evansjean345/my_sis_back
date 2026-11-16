import { Err, Ok, type Result } from '#domain/kernel'
import type { AuditLogger, Clock, UnitOfWork, UseCase } from '#application/ports'
import type {
  OtpRepository,
  PasswordHasher,
  UserAccountWriter,
  UserContactReader,
} from '#application/identity/ports'
import type { OtpCheckError, OtpVerifier } from '#application/identity/services/otp_verifier'
import { InvalidOtpError } from '#domain/identity/errors'
import { UserPasswordReset } from '#domain/identity/events'
import type { AccountIdentifier } from '#domain/identity/otp_policy'
import { findActiveAccount } from '#application/identity/services/account_lookup'

export interface ResetPasswordInput {
  /** E-mail ou téléphone du compte. */
  identifier: AccountIdentifier
  code: string
  /** Déjà validé par la présentation (12 caractères minimum, confirmé). */
  newPassword: string
  ip?: string | null
  userAgent?: string | null
  requestId?: string
}

/**
 * =========================================================================
 *  CAS D'USAGE — Réinitialiser le mot de passe avec le code reçu (SMS ou e-mail)
 * =========================================================================
 *
 * TOUT OU RIEN, en une transaction :
 *   code consommé + nouveau mot de passe + verrouillage levé + sessions
 *   révoquées + événement `identity.user.password_reset` (outbox).
 *
 * Les sessions sont révoquées comme pour un changement volontaire
 * (`POST /users/me/password`) : une réinitialisation fait souvent suite à
 * une suspicion de compromission. L'événement déclenche un SMS d'alerte au
 * titulaire.
 *
 * Le hachage (~100 ms) est fait AVANT la transaction et AVANT la recherche
 * du compte : le temps de réponse ne trahit pas l'existence du numéro, et la
 * transaction ne garde pas un verrou pendant la dérivation de clé.
 *
 * Un compte suspendu n'est PAS réactivé : réinitialiser un mot de passe ne
 * contourne pas une décision d'administrateur (`findActiveByPhone`).
 */
export class ResetPassword implements UseCase<
  ResetPasswordInput,
  { userId: string },
  OtpCheckError
> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly users: UserContactReader,
    private readonly accounts: UserAccountWriter,
    private readonly otps: OtpRepository,
    private readonly verifier: OtpVerifier,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
    private readonly audit: AuditLogger
  ) {}

  async execute(input: ResetPasswordInput): Promise<Result<{ userId: string }, OtpCheckError>> {
    const passwordHash = await this.hasher.make(input.newPassword)

    const user = await findActiveAccount(this.users, input.identifier)
    if (!user) return Err(new InvalidOtpError())

    const now = this.clock.now()
    const result = await this.unitOfWork.run(async (tx) => {
      const r = await this.verifier.check({
        userId: user.id,
        purpose: 'password_reset',
        code: input.code,
        now,
        tx,
      })
      if (!r.ok) return r

      await this.accounts.updatePassword(user.id, passwordHash, now, tx)
      await this.accounts.revokeAllTokens(user.id, tx)
      // Consommé EN DERNIER : si une écriture précédente échoue, le ROLLBACK
      // rend le code de nouveau utilisable.
      await this.otps.consume(r.value.id, now, tx)
      tx.collect([
        // Le canal du code décide du canal de l'alerte « mot de passe modifié ».
        new UserPasswordReset(user.id, {
          organizationId: user.organizationId,
          method: r.value.channel === 'email' ? 'otp_email' : 'otp_sms',
        }),
      ])
      return Ok({ userId: user.id, otpId: r.value.id, channel: r.value.channel })
    })

    if (!result.ok) return result

    await this.audit.record({
      context: {
        actorId: user.id,
        actorType: 'user',
        organizationId: user.organizationId,
        ip: input.ip ?? undefined,
        userAgent: input.userAgent ?? undefined,
        requestId: input.requestId,
      },
      action: 'identity.password_reset.completed',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { otpId: result.value.otpId, channel: result.value.channel },
    })

    return Ok({ userId: user.id })
  }
}
