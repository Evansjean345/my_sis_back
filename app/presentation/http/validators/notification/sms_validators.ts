import vine from '@vinejs/vine'

export const smsTopUpValidator = vine.compile(
  vine.object({
    /** Crédits = segments SMS (un SMS de 160 caractères GSM-7 = 1 crédit). */
    credits: vine.number().withoutDecimals().min(1).max(1_000_000),
    /** Référence d'achat (facture Twilio, bon de commande…). */
    reference: vine.string().trim().maxLength(120).optional(),
    note: vine.string().trim().maxLength(500).optional(),
  })
)

/**
 * Accusé de remise Twilio (`StatusCallback`), en x-www-form-urlencoded.
 * Seuls les champs exploités sont validés ; la signature porte sur TOUS
 * les champs reçus, elle est donc vérifiée sur le corps brut.
 */
export const twilioStatusValidator = vine.compile(
  vine.object({
    MessageSid: vine
      .string()
      .trim()
      .regex(/^(SM|MM)[0-9a-f]{32}$/),
    MessageStatus: vine.string().trim().maxLength(30),
    ErrorCode: vine.string().trim().maxLength(10).optional(),
    ErrorMessage: vine.string().trim().maxLength(300).optional(),
  })
)
