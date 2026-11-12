import type { TransactionScope } from '#application/ports'
import type { AssignableRole } from '#domain/identity/role_policy'
import type { OtpChannel, OtpIssuanceStats, OtpPurpose } from '#domain/identity/otp_policy'

/**
 * =========================================================================
 *  PORTS DU CONTEXTE IDENTITÉ
 * =========================================================================
 *
 * Le contexte Identité reste PRAGMATIQUE pour la lecture et le CRUD simple
 * (contrôleur → Lucid, cf. docs/03 §3). La CRÉATION d'une organisation et de
 * ses comptes est en revanche promue en cas d'usage, pour trois raisons :
 *
 *  - elle est transactionnelle (organisation + administrateur : tout ou rien) ;
 *  - elle porte une règle de sécurité (cloisonnement, non-escalade des rôles) ;
 *  - elle doit rester testable sans base, comme la tranche `security`.
 *
 * Tous les paramètres `tx` sont optionnels : hors transaction, l'adaptateur
 * utilise la connexion par défaut.
 */

// ---------------------------------------------------------------------------
// Données échangées
// ---------------------------------------------------------------------------

//interface liée aux données d'une organisation
export interface OrganizationData {
  code: string
  name: string
  contactEmail: string | null
  contactPhone: string | null
  countryCode: string
  timezone: string
  isActive: boolean
  settings: Record<string, unknown>
}

//interface renvoyée à la creation  d'une organisation
export interface OrganizationRecord extends OrganizationData {
  id: string
  createdAt: Date
}

//status d'un user
export type UserStatus = 'pending' | 'active' | 'suspended'

//interface lié aux données d'un user
export interface UserAccountData {
  organizationId: string
  roleId: string
  email: string
  passwordHash: string
  fullName: string
  phone: string | null
  status: UserStatus
  locale: string
  timezone: string
}

/** Vue d'un compte renvoyée par les cas d'usage — jamais l'empreinte du mot de passe. */
//interface renvoyée après la creation d'une organisation
export interface UserAccountRecord {
  id: string
  organizationId: string
  roleId: string
  email: string
  fullName: string
  phone: string | null
  status: UserStatus
  locale: string
  timezone: string
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------
export interface OrganizationRepository {
  /** Recherche parmi les organisations NON supprimées (index unique partiel). */
  codeExists(code: string, tx?: TransactionScope): Promise<boolean>
  findById(id: string, tx?: TransactionScope): Promise<OrganizationRecord | null>
  insert(id: string, data: OrganizationData, tx?: TransactionScope): Promise<OrganizationRecord>
}

export interface UserAccountRepository {
  /** Unicité GLOBALE de l'e-mail (l'identifiant de connexion ne porte pas l'organisation). */
  emailExists(email: string, tx?: TransactionScope): Promise<boolean>
  insert(id: string, data: UserAccountData, tx?: TransactionScope): Promise<UserAccountRecord>
}

export interface RoleCatalog {
  findById(roleId: string, tx?: TransactionScope): Promise<AssignableRole | null>
  /** Rôle système (global) par son code : `super_admin`, `admin`, `operator`. */
  findSystemRole(code: string, tx?: TransactionScope): Promise<AssignableRole | null>
}

/**
 * Hachage du mot de passe. Port dédié : le cas d'usage ne dépend pas de
 * l'algorithme (scrypt aujourd'hui, argon2 demain), et un test n'a pas à
 * payer 100 ms de dérivation de clé.
 */
export interface PasswordHasher {
  make(plain: string): Promise<string>
}

// ---------------------------------------------------------------------------
// Coordonnées et cycle de vie d'un compte (notifications, OTP, suspension)
// ---------------------------------------------------------------------------
/** Ce qu'il faut pour joindre un titulaire de compte — jamais l'empreinte du mot de passe. */
export interface UserContact {
  id: string
  organizationId: string
  email: string
  fullName: string
  phone: string | null
  status: UserStatus
  locale: string
}

export interface UserContactReader {
  /** Compte NON supprimé, quel que soit son statut. */
  findContactById(userId: string, tx?: TransactionScope): Promise<UserContact | null>
  /**
   * Compte ACTIF (statut `active`, non supprimé) portant ce numéro E.164.
   * L'index unique `uq_users_phone` garantit qu'il y en a au plus un.
   */
  findActiveByPhone(phone: string, tx?: TransactionScope): Promise<UserContact | null>
  /** Compte ACTIF portant cet e-mail (citext, index unique `uq_users_email`). */
  findActiveByEmail(email: string, tx?: TransactionScope): Promise<UserContact | null>
}

export interface UserAccountWriter {
  setStatus(userId: string, status: UserStatus, tx?: TransactionScope): Promise<void>
  /** Nouveau mot de passe + levée du verrouillage (compteur d'échecs, `locked_until`). */
  updatePassword(
    userId: string,
    passwordHash: string,
    changedAt: Date,
    tx?: TransactionScope
  ): Promise<void>
  /** Révoque toutes les sessions (jetons d'accès) du compte. */
  revokeAllTokens(userId: string, tx?: TransactionScope): Promise<void>
}

// ---------------------------------------------------------------------------
// OTP
// ---------------------------------------------------------------------------

export interface OtpRecord {
  id: string
  userId: string
  purpose: OtpPurpose
  /** Canal par lequel le code a été remis (sms | email). */
  channel: OtpChannel
  recipient: string
  codeHash: string
  attempts: number
  maxAttempts: number
  expiresAt: Date
  consumedAt: Date | null
  invalidatedAt: Date | null
  createdAt: Date
}

export interface NewOtp {
  id: string
  userId: string
  purpose: OtpPurpose
  channel: OtpChannel
  /** E.164 (sms) ou adresse e-mail (email) — `ck_otps_recipient`. */
  recipient: string
  codeHash: string
  maxAttempts: number
  expiresAt: Date
  createdAt: Date
  requestedIp: string | null
  userAgent: string | null
}

export interface OtpRepository {
  issuanceStats(
    userId: string,
    purpose: OtpPurpose,
    since: Date,
    tx?: TransactionScope
  ): Promise<OtpIssuanceStats>
  /** Invalide le code actif éventuel (un seul par compte et par usage). */
  invalidateActive(
    userId: string,
    purpose: OtpPurpose,
    at: Date,
    tx?: TransactionScope
  ): Promise<void>
  /** `false` : un code actif existe déjà (demande concurrente) — rien n'est écrit. */
  insert(otp: NewOtp, tx?: TransactionScope): Promise<boolean>
  /** Code actif, verrouillé (FOR UPDATE) jusqu'à la fin de la transaction. */
  findActiveForUpdate(
    userId: string,
    purpose: OtpPurpose,
    tx: TransactionScope
  ): Promise<OtpRecord | null>
  /** +1 tentative ; `invalidateAt` renseigné = le plafond est atteint. */
  registerFailedAttempt(id: string, invalidateAt: Date | null, tx: TransactionScope): Promise<void>
  consume(id: string, at: Date, tx: TransactionScope): Promise<void>
  invalidate(id: string, at: Date, tx?: TransactionScope): Promise<void>
  attachNotification(id: string, notificationId: string): Promise<void>
}

/**
 * Génération et empreinte des codes. Port dédié : le cas d'usage ignore
 * l'algorithme (HMAC-SHA256 avec la clé applicative) et un test peut fournir
 * un code déterministe.
 */
export interface OtpCodeService {
  generate(length: number): string
  digest(code: string): string
  /** Comparaison à temps constant. */
  matches(code: string, digest: string): boolean
}
