import limiter from '@adonisjs/limiter/services/main'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Limitation de débit par usage.
 *
 * `sensitive` protège les opérations irréversibles (immobilisation). Le seuil
 * est délibérément bas : dix demandes par minute et par utilisateur dépassent
 * largement tout usage légitime, et un dépassement mérite d'être remonté.
 *
 * `deviceCommands` a sa PROPRE clé, et c'est le point important : tant que les
 * commandes boîtier partageaient le compteur `sensitive`, quelques appels sur
 * `/devices/:id/commands/*` suffisaient à bloquer une immobilisation pendant
 * cinq minutes. Deux budgets séparés, deux usages indépendants.
 */
export const throttle = {
  api: limiter.define('api', (ctx: HttpContext) => {
    return limiter
      .allowRequests(120)
      .every('1 minute')
      .usingKey(ctx.auth?.user?.id ?? ctx.request.ip())
  }),
  sensitive: limiter.define('sensitive', (ctx: HttpContext) => {
    return limiter
      .allowRequests(10)
      .every('1 minute')
      .usingKey(`sensitive_${ctx.auth?.user?.id ?? ctx.request.ip()}`)
      .blockFor('5 minutes')
  }),
  /**
   * Commandes envoyées à un boîtier : matériel réel, jamais une opération de
   * masse — mais le tableau de bord en enchaîne légitimement quelques-unes
   * (envoi puis `sync`). Pas de `blockFor` : le dépassement se résorbe à la
   * fenêtre suivante au lieu de condamner l'utilisateur pour cinq minutes.
   */
  deviceCommands: limiter.define('deviceCommands', (ctx: HttpContext) => {
    return limiter
      .allowRequests(30)
      .every('1 minute')
      .usingKey(`device_commands_${ctx.auth?.user?.id ?? ctx.request.ip()}`)
  }),
  /**
   * Demande de code SMS — chaque appel peut COÛTER un SMS. Le quota par
   * compte (5 codes / heure, `OTP_MAX_PER_HOUR`) ne suffit pas : une
   * campagne sur de nombreux numéros viderait le solde. D'où ce plafond par
   * adresse IP, indépendant du compteur de connexion.
   */
  otpRequest: limiter.define('otpRequest', (ctx: HttpContext) => {
    return limiter
      .allowRequests(5)
      .every('15 minutes')
      .usingKey(`otp_request_${ctx.request.ip()}`)
      .blockFor('30 minutes')
  }),
  /**
   * Saisie du code. Le plafond par code (5 tentatives) est la vraie
   * barrière ; celle-ci freine la même IP qui essaierait plusieurs comptes.
   */
  otpVerify: limiter.define('otpVerify', (ctx: HttpContext) => {
    return limiter
      .allowRequests(10)
      .every('15 minutes')
      .usingKey(`otp_verify_${ctx.request.ip()}`)
      .blockFor('15 minutes')
  }),
  auth: limiter.define('auth', (ctx: HttpContext) => {
    return limiter
      .allowRequests(5)
      .every('1 minute')
      .usingKey(ctx.request.ip())
      .blockFor('15 minutes')
  }),
}
