import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { OtpCodeService } from '#application/identity/ports'

/**
 * Codes OTP : tirage cryptographique, empreinte HMAC-SHA256.
 *
 * `randomInt` (CSPRNG, sans biais modulo) et non `Math.random` : un code
 * prévisible annule toute la politique de tentatives.
 *
 * L'empreinte est un HMAC et non un hachage lent (scrypt) : le secret est la
 * CLÉ, absente de la base, pas le code lui-même — 10⁶ valeurs se testeraient
 * de toute façon. La clé dérive d'`APP_KEY` avec un préfixe de domaine, pour
 * qu'aucune autre empreinte de l'application ne puisse lui être substituée.
 * Changer `APP_KEY` invalide les codes en cours (10 minutes de vie) : effet
 * acceptable.
 */
export class HmacOtpCodeService implements OtpCodeService {
  readonly #key: Buffer

  constructor(appKey: string) {
    if (!appKey) throw new Error('APP_KEY requis pour les codes OTP')
    this.#key = createHmac('sha256', appKey).update('sisbm:otp:v1').digest()
  }

  generate(length: number): string {
    let code = ''
    for (let i = 0; i < length; i++) code += String(randomInt(0, 10))
    return code
  }

  digest(code: string): string {
    return createHmac('sha256', this.#key).update(code).digest('hex')
  }

  matches(code: string, digest: string): boolean {
    const attendu = Buffer.from(this.digest(code), 'hex')
    const stocke = Buffer.from(digest, 'hex')
    return attendu.length === stocke.length && timingSafeEqual(attendu, stocke)
  }
}
