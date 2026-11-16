import logger from '@adonisjs/core/services/logger'

/**
 * =========================================================================
 *  CLIENT HTTP TWILIO — socle commun des passerelles Twilio
 * =========================================================================
 *
 * Reprend les requêtes validées sous Insomnia (Messages, Balance, Usage),
 * avec trois corrections :
 *
 *  ① L'URL porte le SID du COMPTE (`AC…`), pas celui de la clé d'API (`SK…`).
 *    `…/Accounts/SK…/Messages.json` a répondu 201 dans les essais, mais ce
 *    n'est pas la forme documentée : `/Accounts/{AccountSid}/…`. La clé
 *    d'API sert UNIQUEMENT à l'authentification.
 *
 *  ② Authentification Basic `base64(SID_CLÉ:SECRET)` dans l'en-tête
 *    `Authorization`. L'essai WhatsApp a reçu 401 / 20003 parce que la clé
 *    était envoyée comme NOM d'en-tête (`SKd5…: <secret>`).
 *
 *  ③ Corps en `application/x-www-form-urlencoded` (l'API 2010-04-01 n'accepte
 *    pas le JSON en entrée) ; réponses en JSON.
 *
 * Réessais : GET sur 429 / 5xx / coupure. Un POST n'est rejoué QUE sur 429 —
 * Twilio n'a alors pas créé le message. Sur 5xx ou coupure, le message a pu
 * partir : le rejouer enverrait le même code deux fois.
 */

/*
Interfacde de configuration du client Twilio. Les champs sont basés sur les besoins de l'API Twilio.
*/
export interface TwilioClientConfig {
  /** `AC…` — figure dans l'URL. */
  accountSid: string
  /** Clé d'API `SK…` (recommandé) ; à défaut, `accountSid` + `authToken`. */
  apiKeySid: string
  apiKeySecret: string
  authToken: string
  baseUrl: string
  timeoutMs: number
}

/*
Gestion des erreurs pour l'api de twilio . Les champs sont basé sur les réponses de l'api de twilio
*/
export class TwilioApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    /** Code Twilio (`21211` numéro invalide, `20003` authentification…). */
    readonly twilioCode: number | null,
    readonly twilioMessage: string,
    readonly moreInfo: string | null
  ) {
    super(
      `Twilio ${method} ${path} → HTTP ${status}${twilioCode ? ` (${twilioCode})` : ''} : ${twilioMessage}`
    )
  }

  /**
   * Le message n'a certainement PAS été créé ET un nouvel essai a une chance
   * d'aboutir : seul 429 (débit dépassé) remplit les deux conditions.
   */
  get safeToRetry(): boolean {
    return this.status === 429
  }

  /*
  Code de traitement pour status Http coté client 
  code 503 ---- > service indisponible
  code 502 ---- > erreur de passerelle
  code 422 ---- > erreur de validation
  code 401 ou 403 ---- > erreur d'authentification
  code 400 ---- > erreur de validation
  */
  get httpStatusForClient(): number {
    if (this.status === 0) return 503
    if (this.status === 401 || this.status === 403) return 502
    if (this.status >= 400 && this.status < 500) return 422
    return 502
  }
}

//type de méthode pour l'api de twilio
type Methode = 'GET' | 'POST'
type Formulaire = Record<string, string | undefined>

const TRANSITOIRES = new Set([429, 500, 502, 503, 504])

//Gestion des appels à l'api de twilio
export class TwilioClient {
  constructor(private readonly config: TwilioClientConfig) {}

  //Configuration de l'account et de l'api key pour l'api de twilio
  get configured(): boolean {
    const c = this.config
    return (
      c.accountSid.startsWith('AC') &&
      ((c.apiKeySid.startsWith('SK') && c.apiKeySecret.length > 0) || c.authToken.length > 0)
    )
  }

  // Récupération du SID du compte Twilio
  get accountSid(): string {
    return this.config.accountSid
  }

  /** Chemin relatif au compte : `/Messages.json` → `/2010-04-01/Accounts/AC…/Messages.json`. */
  /*
  Chemin relatif pour l'api de twilio pour les appels à l'api
  1. /Messages.json → /2010-04-01/Accounts/AC…/Messages.json
  2. /Balance.json → /2010-04-01/Accounts/AC…/Balance.json
  */
  accountPath(chemin: string): string {
    return `/2010-04-01/Accounts/${encodeURIComponent(this.config.accountSid)}${chemin}`
  }

  async request<T>(
    methode: Methode,
    chemin: string,
    opts: { form?: Formulaire; query?: Record<string, string> } = {}
  ): Promise<T> {
    if (!this.configured) {
      throw new TwilioApiError(
        0,
        methode,
        chemin,
        null,
        'Twilio non configuré : TWILIO_ACCOUNT_SID et TWILIO_API_KEY_SID/SECRET (ou TWILIO_AUTH_TOKEN)',
        null
      )
    }

    const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : ''
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}${chemin}${qs}`
    const tentativesMax = 3
    let derniere: unknown

    for (let tentative = 1; tentative <= tentativesMax; tentative++) {
      try {
        return await this.unAppel<T>(methode, chemin, url, opts.form)
      } catch (err) {
        derniere = err
        const statut = err instanceof TwilioApiError ? err.status : -1
        const coupure =
          (err as Error).name === 'TimeoutError' || (err as Error).name === 'TypeError'
        const rejouable = methode === 'GET' ? TRANSITOIRES.has(statut) || coupure : statut === 429
        if (!rejouable || tentative === tentativesMax) break
        const attente = 400 * 2 ** (tentative - 1)
        logger.warn(
          { methode, chemin, tentative, attente },
          '[twilio] appel transitoire, nouvel essai'
        )
        await new Promise((r) => setTimeout(r, attente))
      }
    }
    throw derniere
  }

  // -------------------------------------------------------------------------

  private authorization(): string {
    const c = this.config
    const [id, secret] =
      c.apiKeySid.startsWith('SK') && c.apiKeySecret
        ? [c.apiKeySid, c.apiKeySecret]
        : [c.accountSid, c.authToken]
    return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`
  }

  private async unAppel<T>(
    methode: Methode,
    chemin: string,
    url: string,
    form: Formulaire | undefined
  ): Promise<T> {
    const corps = form
      ? new URLSearchParams(
          Object.entries(form).filter(
            (e): e is [string, string] => e[1] !== undefined && e[1] !== ''
          )
        ).toString()
      : undefined

    const reponse = await fetch(url, {
      method: methode,
      headers: {
        Accept: 'application/json',
        Authorization: this.authorization(),
        ...(corps ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: corps,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    const texte = await reponse.text().catch(() => '')
    let json: Record<string, unknown> = {}
    try {
      json = texte ? (JSON.parse(texte) as Record<string, unknown>) : {}
    } catch {
      json = {}
    }

    if (!reponse.ok) {
      const erreur = new TwilioApiError(
        reponse.status,
        methode,
        chemin,
        typeof json.code === 'number' ? json.code : null,
        typeof json.message === 'string' ? json.message : texte.slice(0, 200),
        typeof json.more_info === 'string' ? json.more_info : null
      )
      // Jamais le corps de la requête dans les journaux : il porte le code OTP.
      logger.error(
        { methode, chemin, status: reponse.status, twilioCode: erreur.twilioCode },
        `[twilio] appel en échec : ${erreur.twilioMessage}`
      )
      throw erreur
    }
    return json as T
  }
}
