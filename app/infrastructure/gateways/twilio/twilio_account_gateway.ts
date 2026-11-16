import type { TwilioClient } from '#infrastructure/gateways/twilio/twilio_client'
import type {
  TwilioBalance,
  TwilioUsagePage,
  TwilioUsageRecord,
} from '#infrastructure/gateways/twilio/twilio_types'

export interface TwilioAccountStatus {
  balance: { amount: number; currency: string }
  smsThisMonth: {
    count: number
    price: number
    priceUnit: string
    startDate: string
    endDate: string
    asOf: string
  } | null
}

/**
 * Lecture du compte Twilio (requêtes `get_solde` et `get_usage`).
 *
 * Le solde Twilio est en DOLLARS et couvre tout le compte ; `sms_balance` est
 * le solde de CRÉDITS de la plateforme. Les deux sont affichés côte à côte
 * au tableau de bord : le premier dit si Twilio acceptera d'envoyer, le
 * second ce que SISBM a prévu de consommer.
 */
export class TwilioAccountGateway {
  constructor(private readonly client: TwilioClient) {}

  get configured(): boolean {
    return this.client.configured
  }

  async status(): Promise<TwilioAccountStatus> {
    const [balance, usage] = await Promise.all([
      this.client.request<TwilioBalance>('GET', this.client.accountPath('/Balance.json')),
      this.client.request<TwilioUsagePage>(
        'GET',
        this.client.accountPath('/Usage/Records/ThisMonth.json'),
        { query: { Category: 'sms' } }
      ),
    ])
    const record: TwilioUsageRecord | undefined = usage.usage_records?.[0]
    return {
      balance: { amount: Number(balance.balance), currency: balance.currency },
      smsThisMonth: record
        ? {
            count: Number(record.count),
            price: Number(record.price),
            priceUnit: record.price_unit,
            startDate: record.start_date,
            endDate: record.end_date,
            asOf: record.as_of,
          }
        : null,
    }
  }
}
