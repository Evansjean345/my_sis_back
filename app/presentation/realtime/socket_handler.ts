import { errors as vineErrors } from '@vinejs/vine'
import logger from '@adonisjs/core/services/logger'
import { DomainError, type Result } from '#domain/kernel'

/** Réponse d'une demande : `{ data }` en cas de succès, `{ error }` sinon. */
export type SocketAck<T> = { data: T } | { error: SocketError }

export interface SocketError {
  code: string
  message: string
  details?: Record<string, unknown>
}

/** Même format d'erreur que l'API HTTP (`{ code, message, details }`). */
export function toSocketError(err: unknown): SocketError {
  if (err instanceof DomainError) return err.toJSON()
  if (err instanceof vineErrors.E_VALIDATION_ERROR) {
    return {
      code: 'E_VALIDATION',
      message: 'Les données transmises sont invalides',
      details: { fields: err.messages },
    }
  }
  logger.error({ err }, '[socket.io] erreur inattendue pendant une demande')
  return { code: 'E_INTERNAL', message: 'Erreur interne' }
}

export function fromResult<T>(r: Result<T, DomainError>): SocketAck<T> {
  return r.ok ? { data: r.value } : { error: r.error.toJSON() }
}

/** Une erreur qui refuse une demande (habilitation, périmètre), au format commun. */
export function socketError(code: string, message: string): SocketAck<never> {
  return { error: { code, message } }
}
