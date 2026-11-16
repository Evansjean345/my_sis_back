import type { Clock, UnitOfWork } from '#application/ports'
import type {
  NotificationJournal,
  SmsBalanceLedger,
  SmsGateway,
} from '#application/notification/ports'
import { isE164, maskPhone, segmentSms } from '#domain/notification/sms_message'

/*
Requête d'envoi de SMS
*/
export interface SmsRequest {
  organizationId: string
  recipientUserId: string | null
  to: string
  /** Corps ENVOYÉ. */
  body: string
  /** Corps ARCHIVÉ (par défaut : `body`). Obligatoire dès que `body` porte un secret. */
  journalBody?: string
  templateCode: string
  dedupKey: string | null
  payload?: Record<string, unknown>
}

/*
Sortie du statut SMS
*/
export type SmsOutcome =
  | { status: 'sent'; notificationId: string; providerMessageId: string; segments: number }
  /** Déjà envoyé (ou en cours) pour cette clé d'idempotence : rien n'a été fait. */
  | { status: 'duplicate' }
  | {
      status: 'failed'
      notificationId: string | null
      errorCode: string
      errorMessage: string
      /** Un nouvel essai a un sens (solde rechargé, opérateur saturé…). */
      retryable: boolean
    }

/*
Option pour l'envoi de sms , debiter le sms_balance à true et à false si le solde est insuffisant
*/
export interface SmsSenderOptions {
  /** Débiter `sms_balance` et refuser l'envoi si le solde est insuffisant. */
  enforceBalance: boolean
}

export type SmsWarning = (message: string, meta: Record<string, unknown>) => void

/**
 * =========================================================================
 *  SERVICE APPLICATIF — Envoyer un SMS
 * =========================================================================
 *
 * Point de passage UNIQUE de tout SMS de la plateforme (OTP, comptes,
 * alertes à venir) : un seul endroit tient le solde et le journal.
 *
 *   ① Réservation, en UNE transaction courte :
 *        ligne `notifications` (queued) + débit atomique de `sms_balance`.
 *      Solde insuffisant → la ligne passe `failed`, rien ne part.
 *   ② Appel opérateur, HORS transaction (aucun appel réseau sous verrou).
 *   ③ Issue : `sent` + identifiant opérateur, ou `failed` + recrédit.
 *      Si l'opérateur compte un autre nombre de segments, le solde est corrigé.
 *
 * Idempotence : `dedupKey` (index unique `uq_notifications_dedup`). Un
 * événement rejoué par l'outbox ne produit pas un second SMS.
 */
export class SmsSender {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly gateway: SmsGateway,
    private readonly journal: NotificationJournal,
    private readonly balance: SmsBalanceLedger,
    private readonly clock: Clock,
    private readonly options: SmsSenderOptions,
    private readonly warn: SmsWarning = () => {}
  ) {}

  /*
  Fonctios pour envoyer les sms 
  !isE164(req.to) : le numéro n'est pas au format E.164
  à définir , supprimer ou ne pas supprimer
  */
  async send(req: SmsRequest): Promise<SmsOutcome> {
    if (!isE164(req.to)) {
      return {
        status: 'failed',
        notificationId: null,
        errorCode: 'E_SMS_INVALID_RECIPIENT',
        errorMessage: 'Numéro hors format E.164',
        retryable: false,
      }
    }

    const { segments, encoding } = segmentSms(req.body)
    if (encoding !== 'GSM-7') {
      this.warn('[sms] message en UCS-2 : coût multiplié', {
        templateCode: req.templateCode,
        segments,
      })
    }

    // ---- ① réservation
    const reservation = await this.unitOfWork.run(async (tx) => {
      const r = await this.journal.reserve(
        {
          organizationId: req.organizationId,
          recipientUserId: req.recipientUserId,
          recipientAddress: req.to,
          templateCode: req.templateCode,
          body: req.journalBody ?? req.body,
          segments,
          provider: this.gateway.provider,
          dedupKey: req.dedupKey,
          payload: req.payload,
        },
        tx
      )
      if (!r) return null
      if (!this.options.enforceBalance) return { ...r, funded: true, remaining: null }

      const remaining = await this.balance.debit(segments, tx)
      if (remaining === null) {
        await this.journal.markFailed(
          r.notificationId,
          {
            errorCode: 'E_SMS_INSUFFICIENT_BALANCE',
            errorMessage: `Solde SMS insuffisant (${segments} crédit(s) requis)`,
            at: this.clock.now(),
          },
          tx
        )
        return { ...r, funded: false, remaining: null }
      }
      return { ...r, funded: true, remaining }
    })

    if (!reservation) return { status: 'duplicate' }
    if (!reservation.funded) {
      this.warn('[sms] solde insuffisant : SMS non envoyé', {
        templateCode: req.templateCode,
        to: maskPhone(req.to),
      })
      return {
        status: 'failed',
        notificationId: reservation.notificationId,
        errorCode: 'E_SMS_INSUFFICIENT_BALANCE',
        errorMessage: 'Solde SMS insuffisant',
        // Une recharge rend l'envoi possible : l'outbox réessaiera.
        retryable: true,
      }
    }

    // ---- ② opérateur, hors transaction
    let result: Awaited<ReturnType<SmsGateway['send']>>
    try {
      result = await this.gateway.send({ to: req.to, body: req.body })
    } catch (err) {
      // Issue INCONNUE (exception inattendue de l'adaptateur) : l'opérateur a
      // peut-être accepté le message. Pas de nouvel essai automatique — un
      // doublon coûte un SMS et brouille le journal ; l'incident doit être vu.
      result = {
        ok: false,
        errorCode: 'E_SMS_GATEWAY_EXCEPTION',
        errorMessage: (err as Error).message,
        retryable: false,
      }
    }

    // ---- ③ issue
    const now = this.clock.now()
    if (result.ok) {
      const reels = result.segments ?? segments
      await this.journal.markSent(reservation.notificationId, {
        providerMessageId: result.providerMessageId,
        segments: reels,
        at: now,
      })
      if (this.options.enforceBalance && reels !== segments) {
        await this.balance.adjust(reels - segments)
      }
      if (reservation.remaining) this.alerterSoldeBas(reservation.remaining)
      return {
        status: 'sent',
        notificationId: reservation.notificationId,
        providerMessageId: result.providerMessageId,
        segments: reels,
      }
    }

    await this.journal.markFailed(reservation.notificationId, {
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      at: now,
    })
    if (this.options.enforceBalance) await this.balance.refund(segments)
    this.warn('[sms] envoi refusé par la passerelle', {
      provider: this.gateway.provider,
      templateCode: req.templateCode,
      to: maskPhone(req.to),
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    })
    return {
      status: 'failed',
      notificationId: reservation.notificationId,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      retryable: result.retryable,
    }
  }

  /** Signal d'exploitation ; le tableau de bord lit le même seuil (`GET /admin/sms/balance`). */
  private alerterSoldeBas(solde: { balanceCredits: number; lowBalanceThreshold: number }) {
    if (solde.balanceCredits <= solde.lowBalanceThreshold) {
      this.warn('[sms] solde SMS sous le seuil d’alerte', solde)
    }
  }
}
