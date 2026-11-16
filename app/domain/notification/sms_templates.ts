import { isGsm7 } from '#domain/notification/sms_message'

/**
 * =========================================================================
 *  MODÈLES DE SMS — contenu métier, sans I/O
 * =========================================================================
 *
 * Règles de rédaction, vérifiées par les tests unitaires :
 *
 *  ① Alphabet GSM-7 uniquement (cf. `sms_message.ts`) : pas de « ê », « ç »,
 *    « ô », guillemets français ni apostrophe typographique. « é è à ù » sont
 *    autorisés. Un écart fait passer le message en UCS-2 (70 caractères).
 *  ② Jamais de mot de passe dans un SMS. Le compte créé reçoit son
 *    identifiant, et la piste du « mot de passe oublié » pour choisir le sien.
 *  ③ Le code OTP n'apparaît QUE dans le corps envoyé ; le journal
 *    (`notifications.body`) reçoit la version masquée (`journalBody`).
 *
 * Les codes (`templateCode`) alimentent `notifications.template_code` : ils
 * restent compatibles avec une future surcharge par `notification_templates`.
 */

/*
Langue de support pour les sms soit en français ou en anglais 
*/
export type SmsLocale = 'fr' | 'en'

//interface de lecture pour le rendu des SMS
export interface RenderedSms {
  templateCode: string
  body: string
  /** Version archivée dans `notifications.body` — sans secret. */
  journalBody: string
}

const locale = (l: string | null | undefined): SmsLocale => (l === 'en' ? 'en' : 'fr')

/** Le nom affiché est tronqué : il ne doit pas faire déborder sur un 2e segment. */
const court = (s: string, max = 30) => (s.length > max ? `${s.slice(0, max - 1)}.` : s)

export const SmsTemplates = {
  /*
  Methode de creation pour les sms
  */
  accountCreated(p: { brand: string; fullName: string; email: string; locale?: string | null }) {
    const body =
      locale(p.locale) === 'en'
        ? `hello ${court(p.fullName)}, your account has been created. Welcome to the SISBM CORE platform!`
        : `bonjour ${court(p.fullName)}, votre compte a ete cree. Bienvenue sur la plateforme SISBM CORE!`
    return { templateCode: 'identity.account_created', body, journalBody: body }
  },

  /*
  Methode de creation pour les sms de compte suspendu
  */
  accountSuspended(p: { brand: string; email: string; locale?: string | null }) {
    const body =
      locale(p.locale) === 'en'
        ? `your account ${p.email} has been suspended. Please contact your administrator.`
        : `votre compte ${p.email} a été suspendu. Contactez votre administrateur pour plus d'informations.`
    return { templateCode: 'identity.account_suspended', body, journalBody: body }
  },

  /*
  Methode de creation pour les sms de code de reinitialisation de mot de passe
  */
  passwordResetCode(p: {
    brand: string
    code: string
    ttlMinutes: number
    locale?: string | null
  }): RenderedSms {
    const texte = (code: string) =>
      locale(p.locale) === 'en'
        ? ` your password reset code is ${code}. Valid for ${p.ttlMinutes} min. Never share it.`
        : ` votre code de reinitialisation est ${code}. Valable ${p.ttlMinutes} min. Ne le communiquez a personne.`
    return {
      templateCode: 'identity.password_reset_code',
      body: texte(p.code),
      journalBody: texte('*'.repeat(p.code.length)),
    }
  },

  /*
  Methode de creation pour les sms de confirmation de changement de mot de passe
  */
  passwordChanged(p: { brand: string; locale?: string | null }): RenderedSms {
    const body =
      locale(p.locale) === 'en'
        ? `the password of your account has just been changed. If this was not you, contact your administrator immediately.`
        : `le mot de passe de votre compte a ete modifie. Si ce n'est pas vous, contactez immediatement votre administrateur.`
    return { templateCode: 'identity.password_changed', body, journalBody: body }
  },
} as const

/** Garde-fou d'exploitation : un modèle hors GSM-7 coûte jusqu'à 3x plus cher. */
export function isCostEfficient(sms: RenderedSms): boolean {
  return isGsm7(sms.body)
}
