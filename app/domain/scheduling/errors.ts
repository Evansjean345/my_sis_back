import { DomainError } from '#domain/kernel'

/*
Erreur du contexte Planification (calendriers d'utilisation).
Comme partout ailleurs , chaque `code` est un contrat d'API : il est lu par 
les tableaux de bord et sert de clé de traduction.
*/

/*
Fenetere horaire mal formée : jour hors 0-6, heure illisible, fin avant début.*/
export class InvalidScheduleWindowError extends DomainError {
  readonly code = 'E_INVALID_SCHEDULE_WINDOW'
  readonly httpStatus = 422

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details)
  }
}

/*
Deux fenetres du même jour se chevauchent.
Sans conséquence sur le calcul (l'union est la même), mais c'est presque
toujours une erreur de saisie : on la signale plutôt que de la stocker.
*/
export class OverlappingScheduleWindowsError extends DomainError {
  readonly code = 'E_SCHEDULE_WINDOWS_OVERLAP'
  readonly httpStatus = 422

  constructor(dayOfWeek: number, first: string, second: string) {
    super(`Deux plages du même jour se chevauchent : ${first} et ${second}`, {
      dayOfWeek,
      first,
      second,
    })
  }
}

/** Fuseau horaire inconnu du runtime (IANA attendu : `Africa/Abidjan`). */
export class InvalidTimezoneError extends DomainError {
  readonly code = 'E_INVALID_TIMEZONE'
  readonly httpStatus = 422

  constructor(timezone: string) {
    super(`Fuseau horaire inconnu : « ${timezone} » (format IANA attendu, ex. Africa/Abidjan)`, {
      timezone,
    })
  }
}

/** Période d'analyse invalide : début après la fin, ou plus de `maxDays` jours. */
export class InvalidAnalyticsRangeError extends DomainError {
  readonly code = 'E_INVALID_ANALYTICS_RANGE'
  readonly httpStatus = 422

  constructor(from: string, to: string, maxDays: number) {
    super(
      `Période d'analyse invalide (${from} → ${to}) : début avant fin, ${maxDays} jours au plus`,
      {
        from,
        to,
        maxDays,
      }
    )
  }
}
