/**
 * PLAGES HORAIRES — heures de la journée.
 *
 * Une heure s'écrit `HH:MM` ou `HH:MM:SS`. `24:00` est admis comme fin de
 * journée : c'est ce qui permet d'écrire « jusqu'à minuit » malgré le CHECK
 * `start_time < end_time`. Une plage qui passe minuit (22 h → 6 h) se saisit
 * en deux plages : 22:00-24:00 puis 00:00-06:00 le lendemain.
 */
export const SECONDS_PER_HOUR = 3600
export const SECONDS_PER_DAY = 86_400

/** Format accepté d'une heure (validateurs et domaine utilisent le même). */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-4]):([0-5]\d)(?::([0-5]\d))?$/

/** Fin de journée : la seule heure admise à partir de 24 h. */
export const END_OF_DAY = '24:00'
