import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Calendrier d'utilisation d'une organisation (table `usage_schedules`, migration 005). */
export default class UsageScheduleModel extends BaseModel {
  static table = 'usage_schedules'

  @column({ isPrimary: true }) declare id: string
  @column({ columnName: 'organization_id' }) declare organizationId: string
  @column() declare name: string
  @column() declare description: string | null
  /** Fuseau IANA dans lequel les plages sont lues (défaut `Africa/Abidjan`). */
  @column() declare timezone: string
  @column({ columnName: 'is_active' }) declare isActive: boolean
  @column.dateTime({ autoCreate: true, columnName: 'created_at' }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime
  @column.dateTime({ columnName: 'deleted_at', serializeAs: null })
  declare deletedAt: DateTime | null
}
