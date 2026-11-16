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
import type { NotificationDispatcher } from '#application/notification/services/notification_dispatcher'
import { addressFor, findActiveAccount } from '#application/identity/services/account_lookup'
import {
  canIssue,
  defaultChannelFor,
  type AccountIdentifier,
  type OtpChannel,
  type OtpPolicyConfig,
} from '#domain/identity/otp_policy'
import { ChannelMessages } from '#domain/notification/channel_messages'
import { maskPhone } from '#domain/notification/sms_message'
import { maskEmail } from '#domain/notification/email_message'

export interface RequestPasswordResetInput {
  /** E-mail ou téléphone E.164, déjà normalisé par la présentation. */
  identifier: AccountIdentifier
  /** Canal CHOISI pour recevoir le code ; par défaut celui de l'identifiant. */
  channel?: OtpChannel
  ip?: string | null
  userAgent?: string | null
  requestId?: string
}

/** Réponse IDENTIQUE que le compte existe ou non. */
export interface RequestPasswordResetOutput {
  channel: OtpChannel
  expiresInSeconds: number
  resendAfterSeconds: number
}

export interface PasswordResetConfig {
  policy: OtpPolicyConfig
  /** Nom de la plateforme dans les messages (« SISBM CORE »). */
  brand: string
}

const PURPOSE = 'password_reset' as const

/**
 * =========================================================================
 *  CAS D'USAGE — Demander un code de réinitialisation (SMS ou e-mail)
 * =========================================================================
 *
 * L'utilisateur saisit son e-mail OU son téléphone, et choisit le canal de
 * remise : SMS (Twilio) ou e-mail (Brevo). On peut saisir son e-mail et
 * recevoir le code par SMS : l'identifiant retrouve le compte, le canal
 * choisit l'adresse de remise parmi celles DU COMPTE — jamais une adresse
 * fournie dans la requête.
 *
 * Point d'entrée PUBLIC : il ne doit rien révéler. Compte inconnu ou
 * suspendu, canal SMS sur un compte sans téléphone, délai de renvoi, quota,
 * échec d'envoi : la réponse est toujours la même. Le détail part dans
 * l'audit et dans `notifications`.
 *
 *   ① compte ACTIF par l'identifiant, adresse de remise pour le canal ;
 *   ② politique d'émission : 60 s entre deux codes, 5 par heure — TOUS
 *     canaux confondus (changer de canal ne contourne pas le quota) ;
 *   ③ transaction : invalidation du code précédent + nouveau code (haché) ;
 *   ④ remise, hors transaction, par le répartiteur de canal.
 *
 * Un code qui n'a pas pu partir est invalidé aussitôt.
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
    private readonly notifier: NotificationDispatcher,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly audit: AuditLogger,
    private readonly config: PasswordResetConfig
  ) {}

  async execute(
    input: RequestPasswordResetInput
  ): Promise<Result<RequestPasswordResetOutput, never>> {
    const policy = this.config.policy
    const channel = input.channel ?? defaultChannelFor(input.identifier)
    const sortie = {
      channel,
      expiresInSeconds: policy.ttlSeconds,
      resendAfterSeconds: policy.resendCooldownSeconds,
    }

    // ---- ① compte actif et adresse de remise
    const user = await findActiveAccount(this.users, input.identifier)
    if (!user) return Ok(sortie)
    const recipient = addressFor(user, channel)
    if (!recipient) {
      await this.audit.record({
        context: this.contexte(user, input),
        action: 'identity.password_reset.no_recipient',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { channel },
      })
      return Ok(sortie)
    }

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
        metadata: {
          channel,
          reason: decision.reason,
          retryAfterSeconds: decision.retryAfterSeconds,
        },
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
          channel,
          recipient,
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
    // Demande concurrente pour le même compte : l'autre a gagné, son message part.
    if (!insere) return Ok(sortie)

    // ---- ④ remise par le canal choisi
    const issue = await this.notifier.deliver({
      organizationId: user.organizationId,
      recipientUserId: user.id,
      to: recipient,
      toName: user.fullName,
      message: ChannelMessages.passwordResetCode(channel, {
        brand: this.config.brand,
        fullName: user.fullName,
        code,
        ttlMinutes: Math.ceil(policy.ttlSeconds / 60),
        locale: user.locale,
      }),
      dedupKey: `otp:${otpId}`,
      payload: { otpId, purpose: PURPOSE, channel },
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
        channel,
        recipient: channel === 'email' ? maskEmail(recipient) : maskPhone(recipient),
        delivery: issue.status,
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
