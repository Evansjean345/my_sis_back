import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import UserModel from '#infrastructure/persistence/models/user_model'
import RoleModel from '#infrastructure/persistence/models/role_model'
import OrganizationModel from '#infrastructure/persistence/models/organization_model'
import { isPlatformOperator } from '#domain/identity/role_policy'
import { unwrap } from '#domain/kernel'
import {
  forgotPasswordValidator,
  loginValidator,
  resetPasswordValidator,
  toAccountIdentifier,
  verifyResetCodeValidator,
} from '#presentation/http/validators/identity/auth_validators'
import { RequestPasswordReset } from '#application/identity/use_cases/request_password_reset'
import { VerifyPasswordResetCode } from '#application/identity/use_cases/verify_password_reset_code'
import { ResetPassword } from '#application/identity/use_cases/reset_password'

/**
 * Authentification.
 *
 * Le contexte Identity suit le style PRAGMATIQUE : contrôleur → Lucid, sans
 * agrégat ni cas d'usage. Il n'y a ici aucune règle métier complexe à protéger,
 * et l'abstraction n'apporterait que du bruit (cf. docs/03 §3).
 *
 * Exception : le mot de passe oublié passe par trois cas d'usage
 * (`/auth/password/*`). Il porte de vraies règles de sécurité — politique
 * OTP, tentatives sous verrou, non-divulgation — qui doivent se tester sans
 * base, comme la tranche `security`.
 */
@inject()
export default class AuthController {
  constructor(
    private readonly requestPasswordReset: RequestPasswordReset,
    private readonly verifyPasswordResetCode: VerifyPasswordResetCode,
    private readonly resetPasswordUseCase: ResetPassword
  ) {}

  /** POST /api/v1/auth/login */
  async login({ request, response }: HttpContext) {
    //methode de login ajouter numéro de téléphone et rendre télephone unique dans user model
    const { email, password } = await request.validateUsing(loginValidator)

    const user = await UserModel.query().where('email', email).whereNull('deleted_at').first()

    // Message identique que le compte existe ou non : ne pas révéler
    // quels e-mails sont enregistrés.
    const invalid = {
      error: { code: 'E_INVALID_CREDENTIALS', message: 'Identifiants invalides', details: {} },
    }

    if (!user) return response.unauthorized(invalid)

    //compte véroullé
    if (user.isLocked) {
      return response.status(423).send({
        error: {
          code: 'E_ACCOUNT_LOCKED',
          message: 'Compte temporairement verrouillé',
          details: { until: user.lockedUntil?.toISO() },
        },
      })
    }

    //5 echecs blocage de compte sur 15 minutes
    if (!(await user.verifyPassword(password))) {
      user.failedAttempts += 1
      // Verrouillage progressif : 5 échecs = 15 minutes.
      if (user.failedAttempts >= 5) {
        user.lockedUntil = DateTime.now().plus({ minutes: 15 })
        user.failedAttempts = 0
      }
      await user.save()
      return response.unauthorized(invalid)
    }

    if (!user.isActive) {
      return response.forbidden({
        error: { code: 'E_ACCOUNT_INACTIVE', message: 'Compte inactif', details: {} },
      })
    }

    user.failedAttempts = 0
    user.lastLoginAt = DateTime.now()
    user.lastLoginIp = request.ip()
    await user.save()

    const token = await UserModel.accessTokens.create(user, ['*'], { expiresIn: '7 days' })

    return response.ok({
      data: {
        token: token.value!.release(),
        expiresAt: token.expiresAt,
        user: { id: user.id, email: user.email, fullName: user.fullName },
      },
    })
  }

  /**
   * GET /api/v1/auth/me
   *
   * Enrichi de l'organisation et du rôle (avec ses habilitations) : le
   * tableau de bord client masque les actions que l'API refuserait, sans
   * deviner. L'API reste seule juge — masquer n'est pas autoriser.
   * Champs historiques (`organizationId`, `roleId`) inchangés.
   */
  //utilisateur courant et ses permissions
  async me({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as UserModel
    const [role, organisation] = await Promise.all([
      RoleModel.query()
        .where('id', user.roleId)
        .select('id', 'code', 'name', 'permissions')
        .first(),
      OrganizationModel.query()
        .where('id', user.organizationId)
        .select('id', 'code', 'name', 'is_active')
        .first(),
    ])
    const permissions = role?.permissions ?? []

    return response.ok({
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone ?? null,
        organizationId: user.organizationId,
        roleId: user.roleId,
        lastLoginAt: user.lastLoginAt?.toISO() ?? null,
        organization: organisation
          ? {
              id: organisation.id,
              code: organisation.code,
              name: organisation.name,
              isActive: organisation.isActive,
            }
          : null,
        role: role ? { id: role.id, code: role.code, name: role.name } : null,
        permissions,
        isPlatform: isPlatformOperator(permissions),
      },
    })
  }

  /** POST /api/v1/auth/logout */
  async logout({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as UserModel
    await UserModel.accessTokens.delete(user, auth.user!.currentAccessToken.identifier)
    return response.noContent()
  }

  // =========================================================================
  //  MOT DE PASSE OUBLIÉ — code par SMS (Twilio) ou e-mail (Brevo)
  // =========================================================================

  /**
   * POST /api/v1/auth/password/forgot
   * body : { identifier: "<e-mail ou téléphone>", channel?: "sms" | "email" }
   *        (`{ phone }` de la première version reste accepté)
   *
   * Le canal choisit l'adresse de remise PARMI CELLES DU COMPTE : saisir son
   * e-mail et demander `channel: "sms"` envoie le code au téléphone du compte.
   *
   * Toujours 202, avec le même corps : la réponse ne dit jamais si
   * l'identifiant correspond à un compte. Le front propose le renvoi après
   * `resendAfterSeconds`.
   */
  async forgotPassword({ request, response }: HttpContext) {
    const payload = await request.validateUsing(forgotPasswordValidator)
    const identifier = toAccountIdentifier(payload)
    // Le cas d'usage ne renvoie jamais d'erreur métier (non-divulgation).
    const delais = unwrap(
      await this.requestPasswordReset.execute({
        identifier,
        channel: payload.channel,
        ip: request.ip(),
        userAgent: request.header('user-agent') ?? null,
        requestId: request.id(),
      })
    )
    const par = delais.channel === 'email' ? 'par e-mail' : 'par SMS'
    return response.accepted({
      data: {
        message: `Si un compte actif correspond, un code vient de lui être envoyé ${par}.`,
        ...delais,
      },
    })
  }

  /**
   * POST /api/v1/auth/password/verify — body : { identifier, code }
   *
   * Vérifie le code SANS le consommer (écran suivant : nouveau mot de passe).
   * Chaque échec est décompté : 422 E_OTP_INVALID { remainingAttempts },
   * 422 E_OTP_EXPIRED, 429 E_OTP_ATTEMPTS_EXCEEDED.
   */
  async verifyResetCode({ request, response }: HttpContext) {
    const payload = await request.validateUsing(verifyResetCodeValidator)
    const r = await this.verifyPasswordResetCode.execute({
      identifier: toAccountIdentifier(payload),
      code: payload.code,
    })
    if (!r.ok) return response.status(r.error.httpStatus).send({ error: r.error.toJSON() })
    return response.ok({ data: { valid: true, expiresAt: r.value.expiresAt.toISOString() } })
  }

  /**
   * POST /api/v1/auth/password/reset
   * body : { identifier, code, password, password_confirmation }
   *
   * 204 : mot de passe changé, verrouillage levé, TOUTES les sessions
   * révoquées — l'utilisateur se reconnecte par `/auth/login`.
   */
  async resetPassword({ request, response }: HttpContext) {
    const payload = await request.validateUsing(resetPasswordValidator)
    const r = await this.resetPasswordUseCase.execute({
      identifier: toAccountIdentifier(payload),
      code: payload.code,
      newPassword: payload.password,
      ip: request.ip(),
      userAgent: request.header('user-agent') ?? null,
      requestId: request.id(),
    })
    if (!r.ok) return response.status(r.error.httpStatus).send({ error: r.error.toJSON() })
    return response.noContent()
  }
}
