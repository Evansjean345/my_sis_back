import { DomainError } from '#domain/kernel'

/**
 * Erreurs du contexte Identité (organisations, comptes, rôles).
 *
 * Chaque `code` est un contrat d'API : le front et les systèmes tiers s'en
 * servent comme clé. On n'en change jamais un sans le traiter comme une
 * rupture de contrat.
 */

//1 - Erreur Code organisation déjà prise
export class OrganizationCodeTakenError extends DomainError {
  readonly code = 'E_ORGANIZATION_CODE_TAKEN'
  readonly httpStatus = 409

  constructor(code: string) {
    super(`Le code d'organisation « ${code} » est déjà utilisé`, { code })
  }
}

//2 - Erreur organisation Id non trouvée
export class OrganizationNotFoundError extends DomainError {
  readonly code = 'E_ORGANIZATION_NOT_FOUND'
  readonly httpStatus = 404

  constructor(organizationId: string) {
    super('Organisation introuvable', { organizationId })
  }
}

/**
 * Une organisation désactivée ne reçoit plus de nouveaux comptes : c'est la
 * première mesure prise lors d'une résiliation ou d'un impayé, elle doit
 * geler le périmètre, pas seulement le masquer.
 */
//3 - organisation désactivée ne reçoit plus de nouveaux comptes
export class OrganizationInactiveError extends DomainError {
  readonly code = 'E_ORGANIZATION_INACTIVE'
  readonly httpStatus = 409

  constructor(organizationId: string) {
    super("L'organisation est désactivée : aucun compte ne peut y être créé", {
      organizationId,
    })
  }
}

//4 - Email déjà associée à un compte
export class EmailTakenError extends DomainError {
  readonly code = 'E_EMAIL_TAKEN'
  readonly httpStatus = 409

  constructor(email: string) {
    super('Cette adresse e-mail est déjà associée à un compte', { email })
  }
}

/** Rôle inexistant, ou appartenant à une AUTRE organisation. */
//5- Rôle inexistant ou appartient à une autre organisation
export class InvalidRoleError extends DomainError {
  readonly code = 'E_INVALID_ROLE'
  readonly httpStatus = 422

  constructor(roleId: string) {
    super('Rôle inconnu ou hors périmètre', { roleId })
  }
}

/**
 * Tentative d'attribuer un rôle plus puissant que celui de l'acteur.
 *
 * C'est la faille classique d'un RBAC : un administrateur d'organisation qui
 * se crée un complice `super_admin`, et franchit ainsi la frontière de
 * cloisonnement entre clients.
 */
//6 - Ne peut pas attribuer un rôle plus élevé que celui de l'utilisateur connecté
export class RoleEscalationError extends DomainError {
  readonly code = 'E_ROLE_ESCALATION'
  readonly httpStatus = 403

  constructor(roleCode: string, missing: string[]) {
    super(
      `Vous ne pouvez pas attribuer le rôle « ${roleCode} » : il accorde des ` +
        `habilitations que vous ne détenez pas vous-même`,
      { roleCode, missing }
    )
  }
}

/*
<-------------------------------------------------------------------------------------------------------------------------------------------------------------------------->
Tentative de réinitialisation de mot de passe par OTP --- GESTION des erreurs
<-------------------------------------------------------------------------------------------------------------------------------------------------------------------------->
*/

// ---------------------------------------------------------------------------
// Réinitialisation du mot de passe par OTP
// ---------------------------------------------------------------------------

/**
 * Code faux, inconnu, ou compte introuvable : MÊME réponse. Distinguer « ce
 * numéro n'a pas de compte » de « code faux » ferait du point d'entrée public
 * un annuaire des numéros enregistrés.
 */
//7 - code OTP invalide
export class InvalidOtpError extends DomainError {
  readonly code = 'E_OTP_INVALID'
  readonly httpStatus = 422

  constructor(remainingAttempts?: number) {
    super('Code invalide', remainingAttempts === undefined ? {} : { remainingAttempts })
  }
}

//8 - code OTP expiré
export class OtpExpiredError extends DomainError {
  readonly code = 'E_OTP_EXPIRED'
  readonly httpStatus = 422

  constructor() {
    super('Code expiré : demandez un nouveau code')
  }
}

/** Plafond de tentatives atteint : le code est invalidé, il faut en redemander un. */
//9 - trop de tentatives sur un code
export class OtpAttemptsExceededError extends DomainError {
  readonly code = 'E_OTP_ATTEMPTS_EXCEEDED'
  readonly httpStatus = 429

  constructor() {
    super('Trop de tentatives : demandez un nouveau code')
  }
}

//10 - suspension de son propre compte
export class SelfSuspendError extends DomainError {
  readonly code = 'E_SELF_SUSPEND'
  readonly httpStatus = 409

  constructor() {
    super('Un utilisateur ne peut pas suspendre son propre compte')
  }
}

//11 - compte introuvable (périmètre de l'acteur)
export class UserAccountNotFoundError extends DomainError {
  readonly code = 'E_NOT_FOUND'
  readonly httpStatus = 404

  constructor(userId: string) {
    super('Utilisateur introuvable', { userId })
  }
}
