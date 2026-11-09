import { Ok, type Result } from '#domain/kernel'
import type {
  AuditLogger,
  Clock,
  ExecutionContext,
  IdGenerator,
  UnitOfWork,
  UseCase,
} from '#application/ports'
import type {
  OtpCodeService,
  OtpRepository,
  UserContact,
  UserContactReader,
} from '#application/identity/ports'
import type { SmsSender } from '#application/notification/services/sms_sender'
import { canIssue, type OtpPolicyConfig } from '#domain/identity/otp_policy'
import { SmsTemplates } from '#domain/notification/sms_templates'
import { maskPhone } from '#domain/notification/sms_message'

export interface RequestPasswordResetInput {
  /** E.164, déjà validé par la présentation. */
  phone: string
  ip?: string | null
  userAgent?: string | null
  requestId?: string
}

/** Réponse IDENTIQUE que le compte existe ou non. */
export interface RequestPasswordResetOutput {
  expiresInSeconds: number
  resendAfterSeconds: number
}

export interface PasswordResetConfig {
  policy: OtpPolicyConfig
  /** Préfixe des SMS (« SISBM CORE »). */
  brand: string
}

const PURPOSE = 'password_reset' as const

/**
 * =========================================================================
 *  CAS D'USAGE — Demander un code de réinitialisation par SMS
 * =========================================================================
 *
 * Point d'entrée PUBLIC (aucune session) : il ne doit rien révéler. Numéro
 * inconnu, compte suspendu, délai de renvoi non écoulé, quota horaire
 * atteint, échec d'envoi : la réponse est toujours la même. Le détail part
 * dans le journal d'audit et dans `notifications`, pas dans la réponse.
 *
 *   ① compte ACTIF portant ce numéro (index unique `uq_users_phone`) ;
 *   ② politique d'émission : 60 s entre deux codes, 5 par heure ;
 *   ③ transaction : invalidation du code précédent + nouveau code (haché) ;
 *   ④ SMS, hors transaction, par le service d'envoi unique (solde + journal).
 *
 * Un code dont le SMS n'est pas parti est invalidé aussitôt : il ne pourrait
 * servir qu'à quelqu'un qui l'aurait obtenu autrement.
 */
export class RequestPasswordReset implements UseCase<
  RequestPasswordResetInput,
  RequestPasswordResetOutput
> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly users: UserContactReader,
    private readonly otps: OtpRepository,
    private readonly codes: OtpCodeService,
    private readonly sms: SmsSender,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly audit: AuditLogger,
    private readonly config: PasswordResetConfig
  ) {}

  async execute(
    input: RequestPasswordResetInput
  ): Promise<Result<RequestPasswordResetOutput, never>> {
    const policy = this.config.policy
    const sortie = {
      expiresInSeconds: policy.ttlSeconds,
      resendAfterSeconds: policy.resendCooldownSeconds,
    }

    // ---- ① compte actif
    const user = await this.users.findActiveByPhone(input.phone)
    if (!user?.phone) return Ok(sortie)

    // ---- ② politique d'émission
    const now = this.clock.now()
    const stats = await this.otps.issuanceStats(
      user.id,
      PURPOSE,
      new Date(now.getTime() - 3600_000)
    )
    const decision = canIssue(stats, now, policy)
    if (!decision.allowed) {
      await this.audit.record({
        context: this.contexte(user, input),
        action: 'identity.password_reset.throttled',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { reason: decision.reason, retryAfterSeconds: decision.retryAfterSeconds },
      })
      return Ok(sortie)
    }

    // ---- ③ nouveau code
    const code = this.codes.generate(policy.length)
    const otpId = this.ids.generate()
    const insere = await this.unitOfWork.run(async (tx) => {
      await this.otps.invalidateActive(user.id, PURPOSE, now, tx)
      return this.otps.insert(
        {
          id: otpId,
          userId: user.id,
          purpose: PURPOSE,
          channel: 'sms',
          recipient: user.phone!,
          codeHash: this.codes.digest(code),
          maxAttempts: policy.maxAttempts,
          expiresAt: new Date(now.getTime() + policy.ttlSeconds * 1000),
          createdAt: now,
          requestedIp: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx
      )
    })
    // Demande concurrente pour le même compte : l'autre a gagné, son SMS part.
    if (!insere) return Ok(sortie)

    // ---- ④ SMS
    const message = SmsTemplates.passwordResetCode({
      brand: this.config.brand,
      code,
      ttlMinutes: Math.ceil(policy.ttlSeconds / 60),
      locale: user.locale,
    })
    const issue = await this.sms.send({
      organizationId: user.organizationId,
      recipientUserId: user.id,
      to: user.phone,
      body: message.body,
      journalBody: message.journalBody,
      templateCode: message.templateCode,
      dedupKey: `otp:${otpId}`,
      payload: { otpId, purpose: PURPOSE },
    })

    if (issue.status === 'sent') {
      await this.otps.attachNotification(otpId, issue.notificationId)
    } else {
      await this.otps.invalidate(otpId, this.clock.now())
      if (issue.status === 'failed' && issue.notificationId) {
        await this.otps.attachNotification(otpId, issue.notificationId)
      }
    }

    await this.audit.record({
      context: this.contexte(user, input),
      action: 'identity.password_reset.requested',
      resourceType: 'user',
      resourceId: user.id,
      metadata: {
        otpId,
        recipient: maskPhone(user.phone),
        sms: issue.status,
        ...(issue.status === 'failed' ? { errorCode: issue.errorCode } : {}),
      },
    })

    return Ok(sortie)
  }

  private contexte(user: UserContact, input: RequestPasswordResetInput): ExecutionContext {
    return {
      actorId: user.id,
      actorType: 'user',
      organizationId: user.organizationId,
      ip: input.ip ?? undefined,
      userAgent: input.userAgent ?? undefined,
      requestId: input.requestId,
    }
  }
}
