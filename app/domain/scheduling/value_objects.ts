import { Err, Ok, ValueObject, type Result } from '#domain/kernel'
import {
  DAY_LABELS,
  FIRST_DAY_OF_WEEK,
  INTL_WEEKDAYS,
  LAST_DAY_OF_WEEK,
  type DayOfWeek,
} from '#domain/scheduling/code_legacy/schedule/schedule_days'
import {
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  TIME_OF_DAY_PATTERN,
} from '#domain/scheduling/code_legacy/schedule/schedule_time'
import type {
  LocalClock,
  WeeklyWindowInput,
  WeeklyWindowJson,
} from '#domain/scheduling/code_legacy/schedule/schedule_types'
import {
  InvalidScheduleWindowError,
  InvalidTimezoneError,
  OverlappingScheduleWindowsError,
} from '#domain/scheduling/errors'

/**
 * =========================================================================
 *  OBJETS-VALEURS DES PLAGES HORAIRES
 * =========================================================================
 *
 * Fonctions et objet-valeur seulement : jours, heures, interfaces et limites
 * vivent dans `code_legacy/schedule`.
 *
 * Aucune dépendance (ni Luxon, ni base) : la conversion de fuseau horaire
 * passe par `Intl`, fourni par le runtime. C'est ce qui permet de tester
 * « mardi 21 h 59 à Abidjan » en une microseconde, sans horloge réelle.
 */

// ---------------------------------------------------------------------------
// Heures
// ---------------------------------------------------------------------------

/**
 * `08:30` ou `08:30:00` → secondes depuis minuit.
 * `24:00` est accepté (fin de journée) : c'est ce qui permet d'exprimer
 * « jusqu'à minuit » malgré le CHECK `start_time < end_time`.
 */
export function parseTimeOfDay(raw: string): number | null {
  const m = TIME_OF_DAY_PATTERN.exec((raw ?? '').trim())
  if (!m) return null
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
  if (h === 24 && (min !== 0 || s !== 0)) return null
  return h * SECONDS_PER_HOUR + min * 60 + s
}

/** Secondes depuis minuit → `HH:MM` (ou `HH:MM:SS` si les secondes comptent). */
export function formatTimeOfDay(seconds: number): string {
  const h = Math.floor(seconds / SECONDS_PER_HOUR)
  const m = Math.floor((seconds % SECONDS_PER_HOUR) / 60)
  const s = seconds % 60
  const hm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  return s === 0 ? hm : `${hm}:${String(s).padStart(2, '0')}`
}

/** Secondes depuis minuit → `HH:MM:SS`, format du type SQL `time`. */
function sqlTime(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(seconds / SECONDS_PER_HOUR)
  const m = Math.floor((seconds % SECONDS_PER_HOUR) / 60)
  return `${pad(h)}:${pad(m)}:${pad(seconds % 60)}`
}

// ---------------------------------------------------------------------------
// Fuseau horaire et heure locale
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, f)
  }
  return f
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false
  try {
    formatterFor(timeZone)
    return true
  } catch {
    return false
  }
}

export function assertTimeZone(timeZone: string): Result<string> {
  return isValidTimeZone(timeZone) ? Ok(timeZone) : Err(new InvalidTimezoneError(timeZone))
}

/**
 * Jour et heure locale d'un instant.
 *
 * Un calendrier est toujours lu dans SON fuseau (`usage_schedules.timezone`),
 * jamais dans celui du serveur : un VPS en UTC et une flotte à Abidjan
 * tombent d'accord aujourd'hui, mais pas une flotte à Dakar l'été prochain.
 */
export function localClock(instant: Date, timeZone: string): LocalClock {
  const parts = formatterFor(timeZone).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  return {
    dayOfWeek: INTL_WEEKDAYS[get('weekday')] ?? FIRST_DAY_OF_WEEK,
    secondOfDay:
      Number(get('hour')) * SECONDS_PER_HOUR + Number(get('minute')) * 60 + Number(get('second')),
  }
}

// ---------------------------------------------------------------------------
// Fenêtre hebdomadaire
// ---------------------------------------------------------------------------

export function isDayOfWeek(value: unknown): value is DayOfWeek {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= FIRST_DAY_OF_WEEK &&
    value <= LAST_DAY_OF_WEEK
  )
}

/**
 * Plage [début, fin[ d'un jour de la semaine.
 *
 * Une plage qui passe minuit (22 h → 6 h) se saisit en DEUX fenêtres :
 * lundi 22:00-24:00 et mardi 00:00-06:00. C'est la contrainte de la table
 * (`start_time < end_time`) et c'est aussi ce qui garde le calcul trivial.
 */
export class WeeklyWindow extends ValueObject<{
  dayOfWeek: DayOfWeek
  startSecond: number
  endSecond: number
}> {
  private constructor(dayOfWeek: DayOfWeek, startSecond: number, endSecond: number) {
    super({ dayOfWeek, startSecond, endSecond })
  }

  static create(input: WeeklyWindowInput): Result<WeeklyWindow> {
    const { dayOfWeek } = input
    if (!isDayOfWeek(dayOfWeek)) {
      return Err(
        new InvalidScheduleWindowError(
          'Le jour doit être compris entre 0 (dimanche) et 6 (samedi)',
          {
            dayOfWeek,
          }
        )
      )
    }
    const start = parseTimeOfDay(input.startTime)
    const end = parseTimeOfDay(input.endTime)
    if (start === null || end === null) {
      return Err(
        new InvalidScheduleWindowError('Heure illisible : format HH:MM attendu (00:00 à 24:00)', {
          startTime: input.startTime,
          endTime: input.endTime,
        })
      )
    }
    if (start >= SECONDS_PER_DAY || start >= end) {
      return Err(
        new InvalidScheduleWindowError(
          "L'heure de fin doit suivre l'heure de début. Une plage qui passe minuit se saisit en deux fenêtres (22:00-24:00 puis 00:00-06:00 le lendemain).",
          { startTime: input.startTime, endTime: input.endTime }
        )
      )
    }
    return Ok(new WeeklyWindow(dayOfWeek, start, end))
  }

  /** Relecture depuis la base : valeurs déjà bornées par les CHECK SQL. */
  static trusted(dayOfWeek: number, startTime: string, endTime: string): WeeklyWindow {
    return new WeeklyWindow(
      dayOfWeek as DayOfWeek,
      parseTimeOfDay(startTime) ?? 0,
      parseTimeOfDay(endTime) ?? 0
    )
  }

  get dayOfWeek(): DayOfWeek {
    return this.props.dayOfWeek
  }
  get startTime(): string {
    return formatTimeOfDay(this.props.startSecond)
  }
  get endTime(): string {
    return formatTimeOfDay(this.props.endSecond)
  }

  /** Borne de fin EXCLUE : 08:00-12:00 ne contient pas 12:00:00. */
  contains(clock: LocalClock): boolean {
    return (
      clock.dayOfWeek === this.props.dayOfWeek &&
      clock.secondOfDay >= this.props.startSecond &&
      clock.secondOfDay < this.props.endSecond
    )
  }

  overlaps(other: WeeklyWindow): boolean {
    return (
      this.props.dayOfWeek === other.props.dayOfWeek &&
      this.props.startSecond < other.props.endSecond &&
      other.props.startSecond < this.props.endSecond
    )
  }

  /** Format SQL `time` pour l'écriture. */
  toRow() {
    return {
      dayOfWeek: this.props.dayOfWeek,
      startTime: sqlTime(this.props.startSecond),
      endTime: sqlTime(this.props.endSecond),
    }
  }

  toJSON(): WeeklyWindowJson {
    return { dayOfWeek: this.dayOfWeek, startTime: this.startTime, endTime: this.endTime }
  }

  toString(): string {
    return `${DAY_LABELS[this.props.dayOfWeek]} ${this.startTime}-${this.endTime}`
  }
}

/**
 * Valide un jeu complet de fenêtres : chacune, puis l'absence de
 * chevauchement entre fenêtres du même jour.
 *
 * Un jeu vide est accepté : un calendrier sans aucune plage immobilise en
 * permanence les véhicules qui le suivent. Utile pour préparer un calendrier
 * inactif avant de le remplir.
 */
export function validateWeeklyWindows(raw: readonly WeeklyWindowInput[]): Result<WeeklyWindow[]> {
  const windows: WeeklyWindow[] = []
  for (const r of raw) {
    const w = WeeklyWindow.create(r)
    if (!w.ok) return w
    windows.push(w.value)
  }
  const sorted = [...windows].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)
  )
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].overlaps(sorted[i])) {
      return Err(
        new OverlappingScheduleWindowsError(
          sorted[i].dayOfWeek,
          sorted[i - 1].toString(),
          sorted[i].toString()
        )
      )
    }
  }
  return Ok(sorted)
}
