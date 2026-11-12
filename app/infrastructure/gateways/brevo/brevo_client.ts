import logger from '@adonisjs/core/services/logger'

/**
 * =========================================================================
 *  CLIENT HTTP BREVO — API v3 (https://api.brevo.com/v3)
 * =========================================================================
 *
 * Authentification par l'en-tête `api-key` (clé « API v3 » de la console
 * Brevo, `xkeysib-…`). Corps et réponses en JSON.
 *
 * Réessais, même règle que Twilio : GET sur 429 / 5xx / coupure ; un POST
 * n'est rejoué QUE sur 429 (rien n'a été créé). Sur 5xx ou délai dépassé,
 * l'e-mail a pu partir : le rejouer enverrait le code deux fois.
 */

export interface BrevoClientConfig {
  apiKey: string
  baseUrl: string
  timeoutMs: number
}

export class BrevoApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    /** Code Brevo (`unauthorized`, `invalid_parameter`, `missing_parameter`…). */
    readonly brevoCode: string | null,
    readonly brevoMessage: string
  ) {
    super(
      `Brevo ${method} ${path} → HTTP ${status}${brevoCode ? ` (${brevoCode})` : ''} : ${brevoMessage}`
    )
  }

  /** Rien n'a été créé ET un nouvel essai peut aboutir : 429 seulement. */
  get safeToRetry(): boolean {
    return this.status === 429
  }
}

type Methode = 'GET' | 'POST'
const TRANSITOIRES = new Set([429, 500, 502, 503, 504])

export class BrevoClient {
  constructor(private readonly config: BrevoClientConfig) {}

  get configured(): boolean {
    return this.config.apiKey.length > 0
  }

  async request<T>(methode: Methode, chemin: string, body?: unknown): Promise<T> {
    if (!this.configured) {
      throw new BrevoApiError(
        0,
        methode,
        chemin,
        null,
        'Brevo non configuré : BREVO_API_KEY requis'
      )
    }
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}${chemin}`
    const tentativesMax = 3
    let derniere: unknown

    for (let tentative = 1; tentative <= tentativesMax; tentative++) {
      try {
        return await this.unAppel<T>(methode, chemin, url, body)
      } catch (err) {
        derniere = err
        const statut = err instanceof BrevoApiError ? err.status : -1
        const coupure =
          (err as Error).name === 'TimeoutError' || (err as Error).name === 'TypeError'
        const rejouable = methode === 'GET' ? TRANSITOIRES.has(statut) || coupure : statut === 429
        if (!rejouable || tentative === tentativesMax) break
        const attente = 500 * 2 ** (tentative - 1)
        logger.warn(
          { methode, chemin, tentative, attente },
          '[brevo] appel transitoire, nouvel essai'
        )
        await new Promise((r) => setTimeout(r, attente))
      }
    }
    throw derniere
  }

  private async unAppel<T>(
    methode: Methode,
    chemin: string,
    url: string,
    body: unknown
  ): Promise<T> {
    const reponse = await fetch(url, {
      method: methode,
      headers: {
        'accept': 'application/json',
        'api-key': this.config.apiKey,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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
      const erreur = new BrevoApiError(
        reponse.status,
        methode,
        chemin,
        typeof json.code === 'string' ? json.code : null,
        typeof json.message === 'string' ? json.message : texte.slice(0, 200)
      )
      // Jamais le corps de la requête dans les journaux : il porte le code OTP.
      logger.error(
        { methode, chemin, status: reponse.status, brevoCode: erreur.brevoCode },
        `[brevo] appel en échec : ${erreur.brevoMessage}`
      )
      throw erreur
    }
    return json as T
  }
}
