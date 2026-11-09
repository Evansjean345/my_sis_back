import { BaseDomainEvent } from '#domain/kernel'

/**
 * Événements du contexte Identité.
 *
 * Écrits dans `outbox_messages` DANS la transaction de création, publiés après
 * le commit. Ils permettront au Jalon suivant (notification) d'envoyer le
 * courriel de bienvenue sans risque de l'envoyer pour un compte dont la
 * création a finalement échoué.
 *
 * Aucune donnée secrète dans la charge utile : ni mot de passe, ni empreinte.
 */
//1 - organisation  crée (entreprise crée)
export class OrganizationCreated extends BaseDomainEvent {
  constructor(organizationId: string, payload: { code: string; name: string }) {
    super('identity.organization.created', organizationId, payload)
  }
}
//2- - Utilisateur crée
export class UserAccountCreated extends BaseDomainEvent {
  constructor(
    userId: string,
    payload: { organizationId: string; email: string; roleCode: string; status: string }
  ) {
    super('identity.user.created', userId, payload)
  }
}

/**
 * 3 - Compte suspendu. Déclenche le SMS d'information (handler outbox
 * `identity_notifications`) : jamais pour une suspension qui n'a pas été
 * validée par le COMMIT.
 */
export class UserAccountSuspended extends BaseDomainEvent {
  constructor(
    userId: string,
    payload: { organizationId: string; previousStatus: string; suspendedBy: string | null }
  ) {
    super('identity.user.suspended', userId, payload)
  }
}

/**
 * 4 - Mot de passe réinitialisé par OTP. Le SMS d'alerte qui en découle est
 * une mesure de sécurité : si quelqu'un d'autre a pris la main sur le numéro,
 * le titulaire est prévenu par le canal qu'il consulte.
 */
export class UserPasswordReset extends BaseDomainEvent {
  constructor(userId: string, payload: { organizationId: string; method: 'otp_sms' }) {
    super('identity.user.password_reset', userId, payload)
  }
}
