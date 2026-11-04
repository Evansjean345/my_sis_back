import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Conducteur (table `drivers`, migration 018).
 *
 * `fullName` est une colonne GÉNÉRÉE par PostgreSQL : jamais écrite par
 * l'application (`serializeAs` conservé, mais exclue des écritures par
 * le contrôleur, qui ne la passe jamais à `merge`).
 */
export default class DriverModel extends BaseModel {
  static table = 'drivers'

  @column({ isPrimary: true }) declare id: string
  @column({ columnName: 'organization_id' }) declare organizationId: string
  @column({ columnName: 'vehicle_id' }) declare vehicleId: string | null
  @column({ columnName: 'first_name' }) declare firstName: string
  @column({ columnName: 'last_name' }) declare lastName: string
  @column({ columnName: 'full_name' }) declare fullName: string
  @column() declare phone: string | null
  @column() declare email: string | null
  @column({ columnName: 'employee_code' }) declare employeeCode: string | null
  @column({ columnName: 'license_number' }) declare licenseNumber: string | null
  @column({ columnName: 'license_categories' }) declare licenseCategories: string[]
  @column.date({ columnName: 'license_expires_on' }) declare licenseExpiresOn: DateTime | null
  @column() declare status: string
  @column() declare notes: string | null
  @column.dateTime({ autoCreate: true, columnName: 'created_at' }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true, columnName: 'updated_at' })
  declare updatedAt: DateTime
  @column.dateTime({ columnName: 'deleted_at', serializeAs: null })
  declare deletedAt: DateTime | null
}
