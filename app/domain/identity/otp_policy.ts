/**
 * =========================================================================
 *  POLITIQUE OTP — règles pures, sans I/O
 * =========================================================================
 *
 * Un OTP de réinitialisation est un MOT DE PASSE TEMPORAIRE à 6 chiffres :
 * sa sécurité tient uniquement à trois bornes, toutes appliquées ici.
 *
 *  ① Durée de vie courte (10 min par défaut).
 *  ② Tentatives limitées par code (5) : 5 essais sur 10⁶ valeurs, soit une
 *    chance sur 200 000 de deviner — à condition que ② soit tenu SOUS VERROU.
 *  ③ Émission limitée : 60 s entre deux envois, 5 codes par heure et par
 *    compte. Sans ③, ② se contourne en redemandant un code à chaque échec, et
 *    chaque demande coûte un SMS à la plateforme.
 *
 * Les limites d'adresse IP (start/limiter.ts) s'ajoutent à ③ : elles
 * protègent le solde SMS contre une campagne visant de nombreux numéros.
 */

/*
Destructuration du type OTP pour identifier les règles de sécurité :
  - length : longueur du code (6 chiffres)
  - ttlSeconds : durée de vie du code (10 min)
  - maxAttempts : nombre d'essais autorisés par code (5)
  - resendCooldownSeconds : délai minimum entre deux envois (60 s)
  - maxPerHour : nombre maximum de codes émis par heure (5)

  Le but OTP_PURPOSES est de définir les usages autorisés pour les OTP, actuellement limité à 'password_reset'.
  créer une autre code legacy pour l'usage des OTP pour d'autres usages si nécessaire.
*/
export const OTP_PURPOSES = ['password_reset'] as const //password reset
export type OtpPurpose = (typeof OTP_PURPOSES)[number]

//Otp policy configuration
export interface OtpPolicyConfig {
  /** Nombre de chiffres du code. */
  length: number
  ttlSeconds: number
  maxAttempts: number
  resendCooldownSeconds: number
  maxPerHour: number
}

/** Valeurs par défaut de la politique OTP. 
 six chiffres 
 time to live 10 minutes / 600 seconds
 nombres d'attentes par code 5
 délai minimum entre deux envois 60 secondes
 nombre maximum de codes émis par heure 5
*/
export const DEFAULT_OTP_POLICY: OtpPolicyConfig = Object.freeze({
  length: 6,
  ttlSeconds: 600,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  maxPerHour: 5,
})

/** Vue minimale d'un code, telle que la politique en a besoin. */
export interface OtpState {
  attempts: number
  maxAttempts: number
  expiresAt: Date
  consumedAt: Date | null
  invalidatedAt: Date | null
}

/*
Valuer d'utilisation d'un code OTP : utilisable, expiré, épuisé, consommé ou invalidé.
  - usable : le code est valide et peut être utilisé.
  - expired : le code a dépassé sa durée de vie.
  - exhausted : le nombre maximum de tentatives a été atteint.
  - consumed : le code a déjà été utilisé avec succès.
  - invalidated : le code a été invalidé par l'utilisateur ou par le système.
*/
export type OtpUsability = 'usable' | 'expired' | 'exhausted' | 'consumed' | 'invalidated'

/*
Fonction de calcul de l'état d'utilisation d'un code OTP. Elle prend en entrée l'état du code et la date actuelle, et renvoie l'état d'utilisation correspondant.
  - Si le code a été consommé, renvoie 'consumed'.
  - Si le code a été invalidé, renvoie 'invalidated'.
  - Si le nombre de tentatives a été atteint, renvoie 'exhausted'.
  - Si le code a expiré, renvoie 'expired'.
  - Sinon, renvoie 'usable'.
*/
export function usability(otp: OtpState, now: Date): OtpUsability {
  if (otp.consumedAt) return 'consumed'
  if (otp.invalidatedAt) return 'invalidated'
  if (otp.attempts >= otp.maxAttempts) return 'exhausted'
  if (otp.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'usable'
}

/** Historique d'émission d'un compte sur la dernière heure. */
export interface OtpIssuanceStats {
  lastIssuedAt: Date | null
  issuedLastHour: number
}

export type IssueDecision =
  | { allowed: true }
  | { allowed: false; reason: 'cooldown' | 'hourly_quota'; retryAfterSeconds: number }

/*
Vérification si un code otp peut emettre
*/
export function canIssue(stats: OtpIssuanceStats, now: Date, cfg: OtpPolicyConfig): IssueDecision {
  if (stats.lastIssuedAt) {
    const ecoule = (now.getTime() - stats.lastIssuedAt.getTime()) / 1000
    if (ecoule < cfg.resendCooldownSeconds) {
      return {
        allowed: false,
        reason: 'cooldown',
        retryAfterSeconds: Math.ceil(cfg.resendCooldownSeconds - ecoule),
      }
    }
  }
  if (stats.issuedLastHour >= cfg.maxPerHour) {
    return { allowed: false, reason: 'hourly_quota', retryAfterSeconds: 3600 }
  }
  return { allowed: true }
}

/** Format d'un code saisi : uniquement des chiffres, longueur exacte. */
export function isWellFormedCode(code: string, cfg: Pick<OtpPolicyConfig, 'length'>): boolean {
  return new RegExp(`^\\d{${cfg.length}}$`).test(code)
}

/** Tentatives restantes APRÈS un échec supplémentaire. */
export function remainingAfterFailure(otp: Pick<OtpState, 'attempts' | 'maxAttempts'>): number {
  return Math.max(otp.maxAttempts - (otp.attempts + 1), 0)
}
