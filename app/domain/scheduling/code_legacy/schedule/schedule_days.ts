/**
 * PLAGES HORAIRES — jours de la semaine.
 *
 * 0 = dimanche … 6 = samedi : convention de PostgreSQL (`EXTRACT(DOW FROM …)`)
 * et de `Date#getDay()`, posée par le CHECK `ck_schedule_windows_dow` (0-6).
 * Luxon numérote 1 = lundi … 7 = dimanche : ne jamais mélanger les deux.
 */
export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number]

export const FIRST_DAY_OF_WEEK: DayOfWeek = 0
export const LAST_DAY_OF_WEEK: DayOfWeek = 6

/** Libellé de chaque jour, indexé par `DayOfWeek`. */
export const DAY_LABELS = [
  'dimanche',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
] as const
export type DayLabel = (typeof DAY_LABELS)[number]

/** Jour court rendu par `Intl.DateTimeFormat('en-US', { weekday: 'short' })` → `DayOfWeek`. */
export const INTL_WEEKDAYS: Readonly<Record<string, DayOfWeek>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}
