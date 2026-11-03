import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import { ForbiddenError } from '#domain/kernel'
import { covers } from '#domain/identity/role_policy'
import type { PermissionReader } from '#application/ports'
import { LucidPermissionReader } from '#infrastructure/persistence/readers/permission_reader'
import type UserModel from '#infrastructure/persistence/models/user_model'

/**
 * Contrôle d'habilitation.
 *
 * Bouncer 4 n'expose plus `ctx.bouncer` ; les habilitations s'évaluent
 * explicitement. Centraliser ici donne deux avantages : un point unique de
 * décision, et une `ForbiddenError` du domaine plutôt qu'une exception de
 * framework — la réponse garde ainsi le format d'erreur unique de l'API.
 *
 * La lecture passe par un port : la présentation ne touche jamais la base.
 */

export type Permission =
  | 'immobilizeVehicles'
  | 'sendSensitiveCommands'
  | 'viewVehicles'
  | 'manageVehicles'
  | 'manageUsers'
  | 'viewDevices'
  | 'manageDevices'
  | 'viewAuditLogs'
  | 'viewOrganizations'
  | 'manageOrganizations'

/**
 * Matrice des rôles système : migration 016 (super_admin `*`, admin
 * `command:*`, operator `command:immobilize`).
 */
const PERMISSION_MAP: Record<Permission, string> = {
  /** Couper / rétablir un moteur (`/security/*`) : les trois rôles. */
  immobilizeVehicles: 'command:immobilize',
  /**
   * Commandes boîtier sensibles (mot de passe, APN, numéro admin, sortie)
   * et commande flespi brute : une erreur peut rendre le boîtier injoignable.
   * Réservées à l'administrateur et au super administrateur.
   */
  sendSensitiveCommands: 'command:sensitive',
  viewVehicles: 'vehicle:read',
  manageVehicles: 'vehicle:write',
  manageUsers: 'user:write',
  viewDevices: 'device:read',
  manageDevices: 'device:write',
  /**
   * Journal d'audit : lecture seule, et cloisonnée à l'organisation de
   * l'acteur (seul le joker `*` voit le journal des autres clients).
   * Ajoutée au rôle système `admin` par la migration 013.
   */
  viewAuditLogs: 'audit:read',
  // Niveau PLATEFORME : aucun rôle d'organisation ne les porte, seul le
  // joker `*` (super_admin) les couvre. Un administrateur client ne voit ni
  // ne crée d'autres organisations.
  viewOrganizations: 'organization:read',
  manageOrganizations: 'organization:write',
}

/** Cache par instance d'utilisateur, donc par requête. */
const cache = new WeakMap<object, string[]>()

export async function authorize(ctx: HttpContext, permission: Permission): Promise<void> {
  const granted = await permissionsOf(ctx)

  const required = PERMISSION_MAP[permission]
  // Même règle de couverture que la non-escalade des rôles : une seule définition.
  if (!covers(granted, required)) {
    throw new ForbiddenError("Vous n'avez pas l'habilitation requise", { required })
  }
}

/**
 * Habilitations de l'utilisateur courant (mises en cache pour la requête).
 *
 * Exposé pour les cas d'usage qui raisonnent sur les habilitations de
 * l'acteur — typiquement la règle de non-escalade à l'attribution d'un rôle.
 */
export async function permissionsOf(ctx: HttpContext): Promise<string[]> {
  const user = ctx.auth.user as UserModel | undefined
  if (!user) throw new ForbiddenError('Authentification requise')
  if (!user.isActive || user.isLocked) {
    throw new ForbiddenError('Compte inactif ou verrouillé')
  }

  let granted = cache.get(user)
  if (!granted) {
    const reader = (await app.container.make(LucidPermissionReader)) as PermissionReader
    granted = await reader.readPermissions(user.roleId)
    cache.set(user, granted)
  }
  return granted
}
