import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Vérification de `X-Twilio-Signature` sur les webhooks entrants.
 *
 *   signature = base64( HMAC-SHA1( AUTH_TOKEN, URL + Σ(clé + valeur) ) )
 *
 * avec les paramètres POST triés par clé. L'URL est celle que Twilio a
 * appelée, EXACTEMENT (schéma, hôte, chemin, query) : derrière un proxy
 * TLS, on utilise donc `TWILIO_STATUS_CALLBACK_URL` et non l'URL reçue.
 *
 * Seul l'Auth Token PRINCIPAL du compte signe : une clé d'API (`SK…`) ne le
 * peut pas. Sans `TWILIO_AUTH_TOKEN`, le webhook est refusé.
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>
): string {
  const donnees = Object.keys(params)
    .sort()
    .reduce((acc, cle) => acc + cle + String(params[cle] ?? ''), url)
  return createHmac('sha1', authToken).update(Buffer.from(donnees, 'utf-8')).digest('base64')
}

export function isValidTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>,
  signature: string | undefined | null
): boolean {
  if (!authToken || !signature) return false
  const attendue = Buffer.from(computeTwilioSignature(authToken, url, params))
  const recue = Buffer.from(signature)
  return attendue.length === recue.length && timingSafeEqual(attendue, recue)
}
