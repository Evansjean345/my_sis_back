/**
 * =========================================================================
 *  MESSAGE SMS — règles pures, sans I/O
 * =========================================================================
 *
 * Le solde SMS de la plateforme se compte en SEGMENTS, pas en messages
 * (migration 015 : `balance_credits`, `total_sent`). Le nombre de segments
 * dépend de l'encodage que choisira l'opérateur :
 *
 *   GSM-7  (alphabet GSM 03.38)  160 caractères, 153 par segment au-delà
 *   UCS-2  (tout le reste)        70 caractères,  67 par segment au-delà
 *
 * Un seul caractère hors alphabet GSM (ê, ç minuscule, ô, « », emoji…) fait
 * basculer TOUT le message en UCS-2 et peut tripler son coût. Les modèles de
 * `sms_templates.ts` sont écrits pour rester en GSM-7.
 *
 * Le décompte sert à RÉSERVER le crédit avant l'envoi ; le nombre réel
 * renvoyé par Twilio (`num_segments`) corrige ensuite l'écart éventuel.
 */

//Global standard enconding for SMS is GSM-7
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'

/** Table d'extension : chaque caractère coûte DEUX septets (échappement ESC). */
const GSM7_EXTENDED = '^{}\\[~]|€\f'

const BASIC = new Set(GSM7_BASIC)
const EXTENDED = new Set(GSM7_EXTENDED)

export type SmsEncoding = 'GSM-7' | 'UCS-2'

export interface SmsSegmentation {
  encoding: SmsEncoding
  /** Unités consommées : septets (GSM-7) ou unités UTF-16 (UCS-2). */
  units: number
  segments: number
}

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!BASIC.has(ch) && !EXTENDED.has(ch)) return false
  }
  return true
}

/** Nombre de segments facturés pour `text`. Un message vide compte pour 1. */
export function segmentSms(text: string): SmsSegmentation {
  if (isGsm7(text)) {
    let units = 0
    for (const ch of text) units += EXTENDED.has(ch) ? 2 : 1
    return { encoding: 'GSM-7', units, segments: units <= 160 ? 1 : Math.ceil(units / 153) }
  }
  // UCS-2 : Twilio compte en unités UTF-16 (un emoji = 2 unités).
  const units = text.length
  return { encoding: 'UCS-2', units, segments: units <= 70 ? 1 : Math.ceil(units / 67) }
}

/** Numéro au format E.164, seul format accepté par `notifications` et `otps`. */
export const E164 = /^\+[1-9]\d{7,14}$/

export function isE164(phone: string): boolean {
  return E164.test(phone)
}

/** `+2250161899990` → `+225******9990` (journaux, réponses API). */
export function maskPhone(phone: string): string {
  if (phone.length <= 8) return phone.replace(/\d(?=\d{2})/g, '*')
  return `${phone.slice(0, 4)}${'*'.repeat(phone.length - 8)}${phone.slice(-4)}`
}
