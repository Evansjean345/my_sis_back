/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class DeviceAssignmentSchema extends BaseModel {
  static $columns = [
    'createdAt',
    'deviceId',
    'id',
    'installNotes',
    'installedBy',
    'period',
    'removedBy',
    'updatedAt',
    'vehicleId',
  ] as const
  $columns = DeviceAssignmentSchema.$columns
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare deviceId: string
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare installNotes: string | null
  @column()
  declare installedBy: string | null
  @column()
  declare period: any
  @column()
  declare removedBy: string | null
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column()
  declare vehicleId: string
}
