/**
 * Fichier généré par `node ace schema:generate` — NE PAS MODIFIER À LA MAIN.
 * Régénéré à chaque `node ace migration:run` / `migration:rollback`.
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class PolicySchema extends BaseModel {
  static $columns = [
    'conditions',
    'cooldownSeconds',
    'createdAt',
    'createdBy',
    'deletedAt',
    'description',
    'id',
    'isActive',
    'name',
    'organizationId',
    'priority',
    'requiresHumanValidation',
    'severity',
    'triggerType',
    'updatedAt',
    'usageScheduleId',
    'version',
  ] as const
  $columns = PolicySchema.$columns
  @column()
  declare conditions: any
  @column()
  declare cooldownSeconds: number
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @column()
  declare createdBy: string | null
  @column.dateTime()
  declare deletedAt: DateTime | null
  @column()
  declare description: string | null
  @column({ isPrimary: true })
  declare id: string
  @column()
  declare isActive: boolean
  @column()
  declare name: string
  @column()
  declare organizationId: string
  @column()
  declare priority: number
  @column()
  declare requiresHumanValidation: boolean
  @column()
  declare severity: string
  @column()
  declare triggerType: string
  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
  @column()
  declare usageScheduleId: string | null
  @column()
  declare version: number
}
