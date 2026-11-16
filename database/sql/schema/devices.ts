/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class DeviceSchema extends BaseModel {
  static $columns = [
    'commissionedOn',
    'createdAt',
    'deletedAt',
    'firmwareVersion',
    'flespiChannelId',
    'flespiDeviceId',
    'flespiIdent',
    'hasRelay',
    'id',
    'imei',
    'lastBatteryPct',
    'lastGsmSignal',
    'lastSeenAt',
    'manufacturer',
    'model',
    'notes',
    'organizationId',
    'protocol',
    'serialNumber',
    'simIccid',
    'simMsisdn',
    'simOperator',
    'status',
    'updatedAt',
  ] as const
  $columns = DeviceSchema.$columns
  @column.date()
  declare commissionedOn: DateTime | null
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column.dateTime()
  declare deletedAt: DateTime | null
  @column()
  declare firmwareVersion: string | null
  @column()
  declare flespiChannelId: bigint | number | null
  @column()
  declare flespiDeviceId: bigint | number | null
  @column()
  declare flespiIdent: string | null
  @column()
  declare hasRelay: boolean
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare imei: string
  @column()
  declare lastBatteryPct: string | null
  @column()
  declare lastGsmSignal: number | null
  @column.dateTime()
  declare lastSeenAt: DateTime | null
  @column()
  declare manufacturer: string
  @column()
  declare model: string
  @column()
  declare notes: string | null
  @column()
  declare organizationId: string
  @column()
  declare protocol: string | null
  @column()
  declare serialNumber: string | null
  @column()
  declare simIccid: string | null
  @column()
  declare simMsisdn: string | null
  @column()
  declare simOperator: string | null
  @column()
  declare status: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
