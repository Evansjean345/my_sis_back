import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import OrganizationModel from '#infrastructure/persistence/models/organization_model'
import RoleModel from '#infrastructure/persistence/models/role_model'
import UserModel from '#infrastructure/persistence/models/user_model'
import db from '@adonisjs/lucid/services/db'
import type { TransactionScope } from '#application/ports'
import type {
  OrganizationData,
  OrganizationRecord,
  OrganizationRepository,
  RoleCatalog,
  UserAccountData,
  UserAccountRecord,
  UserAccountRepository,
  UserAccountWriter,
  UserContact,
  UserContactReader,
  UserStatus,
} from '#application/identity/ports'
import type { AssignableRole } from '#domain/identity/role_policy'

/**
 * Adaptateurs de persistance du contexte Identité.
 *
 * Pure TRADUCTION entre les ports et les tables : aucune règle ici. Le
 * cloisonnement et la non-escalade vivent dans `domain/identity/role_policy`.
 */

const trx = (tx?: TransactionScope) => tx?.raw as TransactionClientContract | undefined

// ---------------------------------------------------------------------------
// Organisations
// ---------------------------------------------------------------------------

export class LucidOrganizationRepository implements OrganizationRepository {
  async codeExists(code: string, tx?: TransactionScope): Promise<boolean> {
    const row = await OrganizationModel.query({ client: trx(tx) })
      .where('code', code)
      .whereNull('deleted_at')
      .select('id')
      .first()
    return row !== null
  }

  async findById(id: string, tx?: TransactionScope): Promise<OrganizationRecord | null> {
    const row = await OrganizationModel.query({ client: trx(tx) })
      .where('id', id)
      .whereNull('deleted_at')
      .first()
    return row ? toOrganizationRecord(row) : null
  }

  async insert(
    id: string,
    data: OrganizationData,
    tx?: TransactionScope
  ): Promise<OrganizationRecord> {
    const row = await OrganizationModel.create({ id, ...data }, { client: trx(tx) })
    return toOrganizationRecord(row)
  }
}

function toOrganizationRecord(row: OrganizationModel): OrganizationRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    countryCode: row.countryCode,
    timezone: row.timezone,
    isActive: row.isActive,
    // À la création, Lucid garde la valeur JS fournie ; à la relecture, le
    // pilote pg rend déjà un objet. Le cas chaîne ne survient qu'en cas
    // de lecture brute — on le tolère sans planter.
    settings:
      typeof row.settings === 'string'
        ? (JSON.parse(row.settings) as Record<string, unknown>)
        : (row.settings ?? {}),
    createdAt: row.createdAt.toJSDate(),
  }
}

// ---------------------------------------------------------------------------
// Comptes utilisateurs
// ---------------------------------------------------------------------------

export class LucidUserAccountRepository
  implements UserAccountRepository, UserContactReader, UserAccountWriter
{
  async emailExists(email: string, tx?: TransactionScope): Promise<boolean> {
    // `email` est en citext : la comparaison est déjà insensible à la casse.
    const row = await UserModel.query({ client: trx(tx) })
      .where('email', email)
      .whereNull('deleted_at')
      .select('id')
      .first()
    return row !== null
  }

  async insert(
    id: string,
    data: UserAccountData,
    tx?: TransactionScope
  ): Promise<UserAccountRecord> {
    const row = await UserModel.create({ id, ...data, failedAttempts: 0 }, { client: trx(tx) })
    return {
      id: row.id,
      organizationId: row.organizationId,
      roleId: row.roleId,
      //type citext(convertit automatiquement en miniscule)
      email: row.email,
      fullName: row.fullName,
      phone: row.phone,
      status: row.status,
      locale: row.locale,
      timezone: row.timezone,
      createdAt: row.createdAt.toJSDate(),
    }
  }

  // ---------------------------------------------------------------- coordonnées

  async findContactById(userId: string, tx?: TransactionScope): Promise<UserContact | null> {
    const row = await UserModel.query({ client: trx(tx) })
      .where('id', userId)
      .whereNull('deleted_at')
      .first()
    return row ? toUserContact(row) : null
  }

  async findActiveByPhone(phone: string, tx?: TransactionScope): Promise<UserContact | null> {
    const row = await UserModel.query({ client: trx(tx) })
      .where('phone', phone)
      .where('status', 'active')
      .whereNull('deleted_at')
      .first()
    return row ? toUserContact(row) : null
  }

  async findActiveByEmail(email: string, tx?: TransactionScope): Promise<UserContact | null> {
    // `email` est citext : la comparaison ignore la casse.
    const row = await UserModel.query({ client: trx(tx) })
      .where('email', email)
      .where('status', 'active')
      .whereNull('deleted_at')
      .first()
    return row ? toUserContact(row) : null
  }

  // ---------------------------------------------------------------- cycle de vie

  async setStatus(userId: string, status: UserStatus, tx?: TransactionScope): Promise<void> {
    await UserModel.query({ client: trx(tx) })
      .where('id', userId)
      .update({ status })
  }

  async updatePassword(
    userId: string,
    passwordHash: string,
    changedAt: Date,
    tx?: TransactionScope
  ): Promise<void> {
    await UserModel.query({ client: trx(tx) })
      .where('id', userId)
      .update({
        password_hash: passwordHash,
        password_changed_at: changedAt,
        failed_attempts: 0,
        locked_until: null,
      })
  }

  async revokeAllTokens(userId: string, tx?: TransactionScope): Promise<void> {
    await (trx(tx) ?? db).from('auth_access_tokens').where('tokenable_id', userId).delete()
  }
}

function toUserContact(row: UserModel): UserContact {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone,
    status: row.status,
    locale: row.locale,
  }
}

// ---------------------------------------------------------------------------
// Rôles
// ---------------------------------------------------------------------------

export class LucidRoleCatalog implements RoleCatalog {
  async findById(roleId: string, tx?: TransactionScope): Promise<AssignableRole | null> {
    const row = await RoleModel.query({ client: trx(tx) })
      .where('id', roleId)
      .first()
    return row ? toAssignableRole(row) : null
  }

  async findSystemRole(code: string, tx?: TransactionScope): Promise<AssignableRole | null> {
    const row = await RoleModel.query({ client: trx(tx) })
      .where('code', code)
      .whereNull('organization_id')
      .first()
    return row ? toAssignableRole(row) : null
  }
}

function toAssignableRole(row: RoleModel): AssignableRole {
  return {
    id: row.id,
    code: row.code,
    organizationId: row.organizationId,
    permissions: row.permissions ?? [],
  }
}
