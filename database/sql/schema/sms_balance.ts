/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class SmsBalanceSchema extends BaseModel {
  static $columns = [
    'balanceCredits',
    'id',
    'lastTopupAt',
    'lowBalanceThreshold',
    'provider',
    'totalSent',
    'updatedAt',
  ] as const
  $columns = SmsBalanceSchema.$columns
  @column()
  declare balanceCredits: number
  @column({ isPrimary: true })
  declare id: number
  @column.dateTime()
  declare lastTopupAt: DateTime | null
  @column()
  declare lowBalanceThreshold: number
  @column()
  declare provider: string
  @column()
  declare totalSent: bigint | number
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
