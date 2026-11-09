import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { authorizePlatform } from '#presentation/http/support/platform_scope'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import { smsTopUpValidator } from '#presentation/http/validators/notification/sms_validators'
import { LucidSmsBalanceLedger } from '#infrastructure/persistence/repositories/notification_repositories'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { TwilioAccountGateway } from '#infrastructure/gateways/twilio/twilio_account_gateway'
import sisbmConfig from '#config/sisbm'

/**
 * =========================================================================
 *  SOLDE SMS — tableau de bord d'administration (joker `*` exigé)
 * =========================================================================
 *
 * Style PRAGMATIQUE (contrôleur → adaptateurs) : une lecture et un crédit,
 * aucune règle métier à protéger au-delà de l'habilitation plateforme.
 */
@inject()
export default class SmsController {
  constructor(
    private readonly ledger: LucidSmsBalanceLedger,
    private readonly twilio: TwilioAccountGateway,
    private readonly audit: LucidAuditLogger
  ) {}

  /**
   * GET /api/v1/admin/sms/balance
   *
   * `platform` : crédits SISBM (`sms_balance`) — ce que la plateforme s'autorise.
   * `provider` : compte Twilio (dollars) et consommation SMS du mois — ce que
   * Twilio acceptera. Twilio injoignable : `provider.error`, la page reste lisible.
   */
  async balance(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const platform = await this.ledger.read()

    let provider: Record<string, unknown> = {
      name: sisbmConfig.sms.provider,
      configured: this.twilio.configured,
    }
    if (sisbmConfig.sms.provider === 'twilio' && this.twilio.configured) {
      try {
        provider = { ...provider, ...(await this.twilio.status()) }
      } catch (err) {
        provider = { ...provider, error: (err as Error).message }
      }
    }

    return ctx.response.ok({
      data: {
        platform: {
          ...platform,
          lastTopupAt: platform.lastTopupAt?.toISOString() ?? null,
          isLow: platform.balanceCredits <= platform.lowBalanceThreshold,
          enforced: sisbmConfig.sms.enforceBalance,
        },
        provider,
      },
    })
  }

  /**
   * POST /api/v1/admin/sms/topup — body : { credits, reference?, note? }
   * Tracé dans `audit_logs` (action `sms.topup`), conformément à la migration 015.
   */
  async topUp(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const payload = await ctx.request.validateUsing(smsTopUpValidator)
    const avant = await this.ledger.read()
    const apres = await this.ledger.topUp(payload.credits, new Date())

    await this.audit.record({
      context: toExecutionContext(ctx),
      action: 'sms.topup',
      resourceType: 'sms_balance',
      before: { balanceCredits: avant.balanceCredits },
      after: { balanceCredits: apres.balanceCredits },
      metadata: { credits: payload.credits, reference: payload.reference, note: payload.note },
    })

    return ctx.response.ok({
      data: { ...apres, lastTopupAt: apres.lastTopupAt?.toISOString() ?? null },
    })
  }
}
