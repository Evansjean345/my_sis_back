import { Err, Ok, type Result } from '#domain/kernel'
import type { Clock, UnitOfWork, UseCase } from '#application/ports'
import type { UserContactReader } from '#application/identity/ports'
import type { OtpCheckError, OtpVerifier } from '#application/identity/services/otp_verifier'
import { InvalidOtpError } from '#domain/identity/errors'

export interface VerifyPasswordResetCodeInput {
  phone: string
  code: string
}

export interface VerifyPasswordResetCodeOutput {
  valid: true
  expiresAt: Date
}

/**
 * =========================================================================
 *  CAS D'USAGE — Vérifier un code sans le consommer
 * =========================================================================
 *
 * Confort d'interface : l'application mobile ou le tableau de bord affiche
 * l'écran « nouveau mot de passe » seulement quand le code est bon. Le code
 * reste valable pour `/auth/password/reset`, mais chaque échec ici est
 * décompté sur le même plafond (cf. `OtpVerifier`).
 */
export class VerifyPasswordResetCode implements UseCase<
  VerifyPasswordResetCodeInput,
  VerifyPasswordResetCodeOutput,
  OtpCheckError
> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly users: UserContactReader,
    private readonly verifier: OtpVerifier,
    private readonly clock: Clock
  ) {}

  async execute(
    input: VerifyPasswordResetCodeInput
  ): Promise<Result<VerifyPasswordResetCodeOutput, OtpCheckError>> {
    const user = await this.users.findActiveByPhone(input.phone)
    if (!user) return Err(new InvalidOtpError())

    return this.unitOfWork.run(async (tx) => {
      const r = await this.verifier.check({
        userId: user.id,
        purpose: 'password_reset',
        code: input.code,
        now: this.clock.now(),
        tx,
      })
      if (!r.ok) return r
      return Ok({ valid: true as const, expiresAt: r.value.expiresAt })
    })
  }
}
