import type { OtpChannel } from '#domain/identity/otp_policy'
import { SmsTemplates } from '#domain/notification/sms_templates'
import { EmailTemplates } from '#domain/notification/email_templates'

/**
 * =========================================================================
 *  MESSAGES PAR CANAL
 * =========================================================================
 *
 * Un même fait métier (« voici votre code », « mot de passe modifié ») se
 * rédige différemment selon le canal : 160 caractères GSM-7 pour un SMS,
 * objet + HTML + texte pour un e-mail. Les cas d'usage demandent un message
 * pour UN canal ; c'est ici que le canal choisit son modèle.
 */

export type ChannelMessage =
  | { channel: 'sms'; templateCode: string; body: string; journalBody: string }
  | {
      channel: 'email'
      templateCode: string
      subject: string
      html: string
      text: string
      journalBody: string
    }

interface Destinataire {
  fullName: string
  locale?: string | null
}

export const ChannelMessages = {
  passwordResetCode(
    channel: OtpChannel,
    p: Destinataire & { brand: string; code: string; ttlMinutes: number }
  ): ChannelMessage {
    if (channel === 'email') return { channel, ...EmailTemplates.passwordResetCode(p) }
    return { channel, ...SmsTemplates.passwordResetCode(p) }
  },

  passwordChanged(channel: OtpChannel, p: Destinataire & { brand: string }): ChannelMessage {
    if (channel === 'email') return { channel, ...EmailTemplates.passwordChanged(p) }
    return { channel, ...SmsTemplates.passwordChanged(p) }
  },
} as const
