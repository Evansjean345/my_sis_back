import type { TransactionScope } from '#application/ports'

/**
 * =========================================================================
 *  PORTS DU CONTEXTE NOTIFICATION
 * =========================================================================
 *
 * Trois responsabilités, trois ports — chacun remplaçable seul :
 *
 *   SmsGateway           l'opérateur (Twilio aujourd'hui, un agrégateur local demain)
 *   SmsBalanceLedger     le solde GLOBAL de la plateforme (`sms_balance`, migration 015)
 *   NotificationJournal  le détail par message (`notifications`, canal `sms`)
 *
 * Le journal est la source des rapports de consommation par organisation et
 * par mois (`mv_sms_monthly_usage`, TDR §II.4 et §II.6).
 */

// ---------------------------------------------------------------------------
// Passerelle
// ---------------------------------------------------------------------------

export interface OutgoingSms {
  /** E.164 — `+2250161899990`. */
  to: string
  body: string
}

export type SmsGatewayResult =
  | {
      ok: true
      providerMessageId: string
      /** Statut renvoyé à l'acceptation (`queued`, `accepted`…). */
      providerStatus: string
      /** Segments réellement comptés par l'opérateur, si connus. */
      segments: number | null
    }
  | {
      ok: false
      errorCode: string
      errorMessage: string
      /**
       * Vrai uniquement si le message n'a CERTAINEMENT pas été accepté
       * (429, coupure avant envoi) : un nouvel essai ne crée pas de doublon.
       */
      retryable: boolean
    }

export interface SmsGateway {
  /** Nom stocké dans `notifications.provider` (`twilio`, `log`). */
  readonly provider: string
  send(sms: OutgoingSms): Promise<SmsGatewayResult>
}

// ---------------------------------------------------------------------------
// Solde global
// ---------------------------------------------------------------------------
/*
Solde global de la plateforme pour le compte Twilio (ou un agrégateur local).
*/
export interface SmsBalanceSnapshot {
  provider: string
  balanceCredits: number
  totalSent: number
  lowBalanceThreshold: number
  lastTopupAt: Date | null
}

/*
Port applicatifs pour le grand livbre de solde SMS
Ports applicatifs et ses fonctions pour le solde SMS
*/
export interface SmsBalanceLedger {
  /**
   * Débit ATOMIQUE de `segments` crédits (UPDATE … WHERE balance >= n).
   * Renvoie le solde restant et le seuil d'alerte, ou `null` si le solde
   * est insuffisant (aucune ligne modifiée : jamais de solde négatif).
   */
  debit(
    segments: number,
    tx?: TransactionScope
  ): Promise<{ balanceCredits: number; lowBalanceThreshold: number } | null>
  /** Recrédite un envoi refusé par l'opérateur. */
  refund(segments: number, tx?: TransactionScope): Promise<void>
  /** Correction après comptage réel de l'opérateur (`delta` > 0 = débit supplémentaire). */
  adjust(delta: number, tx?: TransactionScope): Promise<void>
  read(tx?: TransactionScope): Promise<SmsBalanceSnapshot>
  topUp(credits: number, at: Date, tx?: TransactionScope): Promise<SmsBalanceSnapshot>
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------
/*
Interface de notification pour les sms 
organisation recevant le sms
id de l'utilisateur recevant le sms
adresse du destinataire
code du template utilisé pour le sms
corps du sms archivé sans secret
nombre de segments du sms
fournisseur du sms
clé d'idempotence pour éviter les doublons
payload optionnel pour des données supplémentaires
*/
export interface NewSmsNotification {
  organizationId: string
  recipientUserId: string | null
  recipientAddress: string
  templateCode: string
  /** Corps ARCHIVÉ — sans secret (le code OTP y est masqué). */
  body: string
  segments: number
  provider: string
  /** Clé d'idempotence : un même événement ne produit jamais deux SMS. */
  dedupKey: string | null
  payload?: Record<string, unknown>
}

/*
Reseerve pour les sms avant de les envoyer pour éviter les doublons
*/
export interface SmsReservation {
  notificationId: string
  /** Une ligne `failed` existante a été remise en file (nouvel essai). */
  retried: boolean
}

export type DeliveryStatus = 'sent' | 'delivered' | 'failed'

/*
Notification du journal pour les sms envoyés
*/
export interface NotificationJournal {
  /**
   * Écrit la ligne `queued`. Si `dedupKey` existe déjà :
   *  - ligne `failed`  → remise en file, renvoyée avec `retried: true` ;
   *  - toute autre     → `null` (déjà envoyé, ou envoi en cours : ne rien faire).
   */
  reserve(entry: NewSmsNotification, tx?: TransactionScope): Promise<SmsReservation | null>
  /*
  Methode de marquage pour les sms envoyés avec succès 
  */
  markSent(
    notificationId: string,
    sent: { providerMessageId: string; segments: number; at: Date },
    tx?: TransactionScope
  ): Promise<void>
  /*
  Methode de marquage pour les qui n'ont pas été envoyés
  */
  markFailed(
    notificationId: string,
    failure: { errorCode: string; errorMessage: string; at: Date },
    tx?: TransactionScope
  ): Promise<void>
  /**
   * Accusé de l'opérateur (webhook). Jamais de retour en arrière : un
   * `delivered` n'est pas écrasé par un `sent` arrivé en retard.
   * Renvoie `false` si aucun message ne porte cet identifiant.
   */
  /*
  Accusé un envoi de sms 
  */
  applyDeliveryStatus(
    providerMessageId: string,
    status: DeliveryStatus,
    at: Date,
    error?: { errorCode: string; errorMessage: string }
  ): Promise<boolean>
}
