import { Secret } from '@adonisjs/core/helpers'
import UserModel from '#infrastructure/persistence/models/user_model'
import { LucidPermissionReader } from '#infrastructure/persistence/readers/permission_reader'

/** Le compte derrière une connexion Socket.IO. */
export interface SocketActor {
  readonly userId: string
  readonly organizationId: string
  readonly permissions: readonly string[]
  /** Fin de validité du jeton : la connexion est fermée à cette date. */
  readonly expiresAt: Date | null
}

/**
 * Authentification d'une connexion Socket.IO par le jeton d'accès de l'API.
 *
 * Mêmes règles que les routes HTTP : jeton valide et non expiré, compte
 * actif et non verrouillé, habilitations lues depuis le rôle. Utilisée à la
 * connexion, puis périodiquement (un jeton révoqué par une déconnexion ou
 * une suspension ferme la connexion persistante).
 */
export class SocketAuthenticator {
  readonly #permissions = new LucidPermissionReader()

  async authenticate(raw: unknown): Promise<SocketActor | null> {
    if (typeof raw !== 'string') return null
    const valeur = raw.replace(/^Bearer\s+/i, '').trim()
    if (!valeur) return null

    const jeton = await UserModel.accessTokens.verify(new Secret(valeur))
    if (!jeton) return null

    const compte = await UserModel.find(jeton.tokenableId)
    if (!compte || compte.deletedAt || !compte.isActive || compte.isLocked) return null

    return {
      userId: compte.id,
      organizationId: compte.organizationId,
      permissions: await this.#permissions.readPermissions(compte.roleId),
      expiresAt: jeton.expiresAt ?? null,
    }
  }
}
