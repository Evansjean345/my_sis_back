import { escapeHtml } from '#domain/notification/email_message'

/**
 * =========================================================================
 *  MODÈLES D'E-MAIL — contenu métier, sans I/O
 * =========================================================================
 *
 * Chaque e-mail a DEUX corps : HTML (affichage) et texte (clients sans HTML,
 * filtres anti-spam — un e-mail sans version texte est plus souvent classé
 * indésirable). Le journal (`notifications.body`) reçoit la version texte,
 * code OTP masqué.
 *
 * HTML volontairement sobre, styles en ligne : les clients de messagerie
 * ignorent la plupart des feuilles de style.
 */

export interface RenderedEmail {
  templateCode: string
  subject: string
  html: string
  text: string
  /** Version archivée dans `notifications.body` — sans secret. */
  journalBody: string
}

type Locale = 'fr' | 'en'
const locale = (l: string | null | undefined): Locale => (l === 'en' ? 'en' : 'fr')

function gabarit(brand: string, titre: string, contenu: string, pied: string): string {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(titre)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#0b3d63;color:#ffffff;padding:18px 28px;font-size:18px;font-weight:bold">${escapeHtml(brand)}</td></tr>
<tr><td style="padding:28px">${contenu}</td></tr>
<tr><td style="padding:16px 28px;background:#f9fafb;color:#6b7280;font-size:12px">${pied}</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

export const EmailTemplates = {
  passwordResetCode(p: {
    brand: string
    fullName: string
    code: string
    ttlMinutes: number
    locale?: string | null
  }): RenderedEmail {
    const en = locale(p.locale) === 'en'
    const nom = escapeHtml(p.fullName)
    const subject = en
      ? `${p.brand} - Your password reset code`
      : `${p.brand} - Votre code de réinitialisation`

    const texte = (code: string) =>
      en
        ? `Hello ${p.fullName},\n\nYour password reset code is: ${code}\nIt is valid for ${p.ttlMinutes} minutes.\n\nIf you did not request it, ignore this email: your password stays unchanged. Never share this code.\n\n${p.brand}`
        : `Bonjour ${p.fullName},\n\nVotre code de réinitialisation est : ${code}\nIl est valable ${p.ttlMinutes} minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé. Ne communiquez jamais ce code.\n\n${p.brand}`

    const contenu = en
      ? `<p style="margin:0 0 16px">Hello ${nom},</p>
<p style="margin:0 0 16px">Use this code to reset your password:</p>
<p style="margin:0 0 16px;font-size:32px;letter-spacing:8px;font-weight:bold;color:#0b3d63">${escapeHtml(p.code)}</p>
<p style="margin:0 0 16px">It is valid for <strong>${p.ttlMinutes} minutes</strong>.</p>
<p style="margin:0;color:#6b7280">If you did not request it, ignore this email: your password stays unchanged.</p>`
      : `<p style="margin:0 0 16px">Bonjour ${nom},</p>
<p style="margin:0 0 16px">Saisissez ce code pour réinitialiser votre mot de passe :</p>
<p style="margin:0 0 16px;font-size:32px;letter-spacing:8px;font-weight:bold;color:#0b3d63">${escapeHtml(p.code)}</p>
<p style="margin:0 0 16px">Il est valable <strong>${p.ttlMinutes} minutes</strong>.</p>
<p style="margin:0;color:#6b7280">Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.</p>`

    const pied = en
      ? 'Never share this code. Our team will never ask you for it.'
      : 'Ne communiquez jamais ce code. Notre équipe ne vous le demandera jamais.'

    return {
      templateCode: 'identity.password_reset_code',
      subject,
      html: gabarit(p.brand, subject, contenu, pied),
      text: texte(p.code),
      journalBody: texte('*'.repeat(p.code.length)),
    }
  },

  passwordChanged(p: { brand: string; fullName: string; locale?: string | null }): RenderedEmail {
    const en = locale(p.locale) === 'en'
    const nom = escapeHtml(p.fullName)
    const subject = en
      ? `${p.brand} - Your password has been changed`
      : `${p.brand} - Votre mot de passe a été modifié`
    const text = en
      ? `Hello ${p.fullName},\n\nThe password of your account has just been changed and all your sessions have been signed out.\n\nIf this was not you, contact your administrator immediately.\n\n${p.brand}`
      : `Bonjour ${p.fullName},\n\nLe mot de passe de votre compte vient d'être modifié et toutes vos sessions ont été fermées.\n\nSi vous n'êtes pas à l'origine de cette action, contactez immédiatement votre administrateur.\n\n${p.brand}`
    const contenu = en
      ? `<p style="margin:0 0 16px">Hello ${nom},</p>
<p style="margin:0 0 16px">The password of your account has just been changed and all your sessions have been signed out.</p>
<p style="margin:0;font-weight:bold;color:#b42318">If this was not you, contact your administrator immediately.</p>`
      : `<p style="margin:0 0 16px">Bonjour ${nom},</p>
<p style="margin:0 0 16px">Le mot de passe de votre compte vient d'être modifié et toutes vos sessions ont été fermées.</p>
<p style="margin:0;font-weight:bold;color:#b42318">Si vous n'êtes pas à l'origine de cette action, contactez immédiatement votre administrateur.</p>`
    const pied = en ? 'Security notification.' : 'Notification de sécurité.'
    return {
      templateCode: 'identity.password_changed',
      subject,
      html: gabarit(p.brand, subject, contenu, pied),
      text,
      journalBody: text,
    }
  },
} as const
