import vine, { errors } from '@vinejs/vine'
import { OTP_CHANNELS, type AccountIdentifier } from '#domain/identity/otp_policy'
import { isEmailAddress } from '#domain/notification/email_message'
import sisbmConfig from '#config/sisbm'

/* ajouter numéro de téléphone */
export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email().normalizeEmail(),
    password: vine.string().minLength(8).maxLength(128),
  })
)

// ---------------------------------------------------------------------------
// Mot de passe oublié — OTP par SMS (Twilio) ou e-mail (Brevo)
// ---------------------------------------------------------------------------

/**
 * Normalise un numéro saisi à la main vers E.164, le seul format stocké :
 *
 *   +225 01 61 89 99 90   → +2250161899990
 *   00225 0161899990      → +2250161899990
 *   01 61 89 99 90        → +2250161899990   (indicatif SMS_DEFAULT_DIAL_CODE)
 *
 * Un numéro qui ne se normalise pas reste tel quel : le cas d'usage ne
 * trouvera aucun compte, et la réponse sera la même que pour un numéro inconnu.
 */
export function normalizePhone(
  saisie: string,
  indicatif = sisbmConfig.sms.defaultDialCode
): string {
  const brut = saisie.replace(/[\s().-]/g, '')
  if (brut.startsWith('+')) return brut
  if (brut.startsWith('00')) return `+${brut.slice(2)}`
  if (/^0\d{7,13}$/.test(brut) && indicatif) return `+${indicatif}${brut}`
  return brut
}

/**
 * Identifiant du compte : UN champ au choix. `identifier` accepte un e-mail
 * ou un téléphone (« E-mail ou téléphone » dans le formulaire) ; `email` et
 * `phone` restent acceptés — `phone` est le format de la première version.
 */
const identite = {
  identifier: vine.string().trim().maxLength(254).optional(),
  email: vine.string().trim().maxLength(254).optional(),
  phone: vine.string().trim().maxLength(24).optional(),
}

const code = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4,10}$/)

const invalide = (message: string, rule: string) =>
  new errors.E_VALIDATION_ERROR([{ field: 'identifier', message, rule }])

/**
 * `{ identifier | email | phone }` → identifiant normalisé. Le FORMAT peut
 * être refusé (422) : il ne révèle rien sur l'existence d'un compte.
 */
export function toAccountIdentifier(p: {
  identifier?: string
  email?: string
  phone?: string
}): AccountIdentifier {
  const brut = p.identifier || p.email || p.phone
  if (!brut) throw invalide('Saisissez votre e-mail ou votre numéro de téléphone', 'required')

  if (brut.includes('@')) {
    const email = brut.toLowerCase()
    if (!isEmailAddress(email)) throw invalide('Adresse e-mail invalide', 'email')
    return { kind: 'email', value: email }
  }
  if (!/^[+\d\s().-]{8,24}$/.test(brut)) throw invalide('Numéro de téléphone invalide', 'mobile')
  return { kind: 'phone', value: normalizePhone(brut) }
}

/** `channel` : canal de remise choisi (`sms` | `email`) ; défaut = celui de l'identifiant. */
export const forgotPasswordValidator = vine.compile(
  vine.object({ ...identite, channel: vine.enum(OTP_CHANNELS).optional() })
)

export const verifyResetCodeValidator = vine.compile(vine.object({ ...identite, code: code() }))

export const resetPasswordValidator = vine.compile(
  vine.object({
    ...identite,
    code: code(),
    // Même exigence qu'à la création et qu'au changement volontaire.
    password: vine.string().minLength(12).maxLength(128).confirmed(),
  })
)
