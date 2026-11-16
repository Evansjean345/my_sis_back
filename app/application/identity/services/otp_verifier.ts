import { Err, Ok, type Result } from '#domain/kernel'
import type { TransactionScope } from '#application/ports'
import type { OtpCodeService, OtpRecord, OtpRepository } from '#application/identity/ports'
import {
  isWellFormedCode,
  remainingAfterFailure,
  usability,
  type OtpPolicyConfig,
  type OtpPurpose,
} from '#domain/identity/otp_policy'
import { InvalidOtpError, OtpAttemptsExceededError, OtpExpiredError } from '#domain/identity/errors'

export type OtpCheckError = InvalidOtpError | OtpExpiredError | OtpAttemptsExceededError

/**
 * Contrôle d'un code saisi — point UNIQUE de décision.
 *
 * Utilisé par la vérification préalable (`/auth/password/verify`) ET par la
 * réinitialisation (`/auth/password/reset`) : deux chemins, un seul compteur
 * de tentatives. Sans cela, `verify` deviendrait un oracle illimité.
 *
 * DOIT être appelé dans une transaction : le code est lu sous verrou de ligne
 * (FOR UPDATE), de sorte que cinq requêtes parallèles ne puissent pas
 * consommer chacune « la dernière tentative ».
 *
 * Un échec est ÉCRIT (tentative +1) : le cas d'usage renvoie un `Err` sans
 * lever d'exception, la transaction est donc validée avec le compteur à jour.
 */
export class OtpVerifier {
  constructor(
    private readonly otps: OtpRepository,
    private readonly codes: OtpCodeService,
    private readonly policy: OtpPolicyConfig
  ) {}

  async check(input: {
    userId: string
    purpose: OtpPurpose
    code: string
    now: Date
    tx: TransactionScope
  }): Promise<Result<OtpRecord, OtpCheckError>> {
    // Un code mal formé ne rapproche pas de la bonne valeur : pas de tentative décomptée.
    if (!isWellFormedCode(input.code, this.policy)) return Err(new InvalidOtpError())

    const otp = await this.otps.findActiveForUpdate(input.userId, input.purpose, input.tx)
    if (!otp) return Err(new InvalidOtpError())

    switch (usability(otp, input.now)) {
      case 'expired':
        await this.otps.invalidate(otp.id, input.now, input.tx)
        return Err(new OtpExpiredError())
      case 'exhausted':
        await this.otps.invalidate(otp.id, input.now, input.tx)
        return Err(new OtpAttemptsExceededError())
      case 'consumed':
      case 'invalidated':
        return Err(new InvalidOtpError())
      case 'usable':
        break
    }

    if (!this.codes.matches(input.code, otp.codeHash)) {
      const restantes = remainingAfterFailure(otp)
      await this.otps.registerFailedAttempt(otp.id, restantes === 0 ? input.now : null, input.tx)
      return restantes === 0
        ? Err(new OtpAttemptsExceededError())
        : Err(new InvalidOtpError(restantes))
    }

    return Ok(otp)
  }
}
