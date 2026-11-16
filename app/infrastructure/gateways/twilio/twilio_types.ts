/**
 * Réponses Twilio utilisées — sous-ensemble des champs, tels que constatés
 * dans les essais Insomnia (8 novembre 2026).
 */

/** POST /Accounts/{AC}/Messages.json → 201 */
/*
Interface de type pour envoyer un SMS via Twilio. Les champs sont basés sur la réponse de l'API Twilio.
*/
export interface TwilioMessage {
  sid: string
  account_sid: string
  status:
    'accepted' | 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed' | string
  to: string
  from: string | null
  messaging_service_sid: string | null
  num_segments: string
  price: string | null
  price_unit: string
  error_code: number | null
  error_message: string | null
  date_created: string
}

/** GET /Accounts/{AC}/Balance.json */
/*
Interface de type pour obtenir le solde du compte Twilio. Les champs sont basés sur la réponse de l'API Twilio.
*/
export interface TwilioBalance {
  account_sid: string
  balance: string
  currency: string
}

/*
Interface de type pour obtenir les enregistrements d'utilisation de Twilio. Les champs sont basés sur la réponse de l'API Twilio.
*/
export interface TwilioUsageRecord {
  category: string
  description: string
  count: string
  count_unit: string
  usage: string
  usage_unit: string
  price: string
  price_unit: string
  start_date: string
  end_date: string
  as_of: string
}

/** GET /Accounts/{AC}/Usage/Records/ThisMonth.json?Category=sms */
/*
Interface pour obtenir les usages mensuels de l'api
*/
export interface TwilioUsagePage {
  usage_records: TwilioUsageRecord[]
}
