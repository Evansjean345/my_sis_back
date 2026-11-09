import vine from '@vinejs/vine'
import sisbmConfig from '#config/sisbm'

/* ajouter numéro de téléphone */
export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email().normalizeEmail(),
    password: vine.string().minLength(8).maxLength(128),
  })
)

// ---------------------------------------------------------------------------
// Mot de passe oublié — OTP par SMS
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

const phone = () =>
  vine
    .string()
    .trim()
    .regex(/^[+\d\s().-]{8,24}$/)
    .transform((v) => normalizePhone(v))

const code = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4,10}$/)

export const forgotPasswordValidator = vine.compile(vine.object({ phone: phone() }))

export const verifyResetCodeValidator = vine.compile(vine.object({ phone: phone(), code: code() }))

export const resetPasswordValidator = vine.compile(
  vine.object({
    phone: phone(),
    code: code(),
    // Même exigence qu'à la création et qu'au changement volontaire.
    password: vine.string().minLength(12).maxLength(128).confirmed(),
  })
)
