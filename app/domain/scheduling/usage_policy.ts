import { localClock, type ScheduleMode, type WeeklyWindow } from '#domain/scheduling/value_objects'

/**
 * =========================================================================
 *  VERDICT D'USAGE — un véhicule doit-il être libre ou immobilisé MAINTENANT ?
 * =========================================================================
 *
 * Fonction pure : calendriers + instant → verdict. Aucune I/O, aucune horloge.
 *
 * Un véhicule peut suivre plusieurs calendriers : les siens
 * (`vehicle_schedules`) et ceux de chacun de ses groupes
 * (`vehicle_schedule_groups`). Règle de combinaison, dans cet ordre :
 *
 *   ① une plage `forbidden` en cours        → IMMOBILISÉ   (l'interdiction l'emporte)
 *   ② au moins un calendrier `allowed`,
 *      aucune de ses plages en cours        → IMMOBILISÉ   (hors des heures autorisées)
 *   ③ sinon                                 → LIBRE
 *
 * Autrement dit : le véhicule peut rouler pendant l'UNION des plages
 * autorisées, MOINS l'union des plages interdites. Le résultat ne dépend pas
 * de l'ordre des calendriers — deux administrateurs qui empilent des règles
 * obtiennent toujours la plus restrictive, jamais la dernière saisie.
 */

export type DesiredUsage = 'free' | 'immobilized'

export type ScheduleSource =
  | { readonly type: 'vehicle' }
  | { readonly type: 'group'; readonly groupId: string; readonly groupName: string }

/** Un calendrier appliqué à un véhicule, avec l'origine de l'application. */
export interface ScheduleAssignment {
  readonly scheduleId: string
  readonly scheduleName: string
  readonly timezone: string
  readonly mode: ScheduleMode
  readonly windows: readonly WeeklyWindow[]
  readonly source: ScheduleSource
}

export type UsageCause =
  /** Aucun calendrier actif ne s'applique. */
  | 'no_schedule'
  /** Une plage interdite est en cours. */
  | 'forbidden_window'
  /** Des plages autorisées existent, aucune n'est en cours. */
  | 'outside_allowed_windows'
  /** Une plage autorisée est en cours. */
  | 'inside_allowed_window'
  /** Seulement des calendriers `forbidden`, aucun en cours. */
  | 'outside_forbidden_windows'

export interface UsageVerdict {
  readonly state: DesiredUsage
  readonly cause: UsageCause
  /** Le calendrier qui a tranché — affiché à l'opérateur et inscrit dans le motif. */
  readonly decisive: ScheduleAssignment | null
}

export function isWithinSchedule(assignment: ScheduleAssignment, now: Date): boolean {
  const clock = localClock(now, assignment.timezone)
  return assignment.windows.some((w) => w.contains(clock))
}

export function resolveUsage(assignments: readonly ScheduleAssignment[], now: Date): UsageVerdict {
  if (assignments.length === 0) return { state: 'free', cause: 'no_schedule', decisive: null }

  // ① l'interdiction l'emporte
  const interdit = assignments.find((a) => a.mode === 'forbidden' && isWithinSchedule(a, now))
  if (interdit) return { state: 'immobilized', cause: 'forbidden_window', decisive: interdit }

  // ② hors de toutes les plages autorisées
  const autorises = assignments.filter((a) => a.mode === 'allowed')
  if (autorises.length > 0) {
    const ouvert = autorises.find((a) => isWithinSchedule(a, now))
    return ouvert
      ? { state: 'free', cause: 'inside_allowed_window', decisive: ouvert }
      : { state: 'immobilized', cause: 'outside_allowed_windows', decisive: autorises[0] }
  }

  // ③ seulement des interdictions, aucune en cours
  return { state: 'free', cause: 'outside_forbidden_windows', decisive: null }
}

/** Motif inscrit sur la commande moteur (CM-08 : ≥ 5 caractères, toujours explicite). */
export function enforcementReason(verdict: UsageVerdict, action: 'cut' | 'restore'): string {
  const nom = verdict.decisive ? `« ${verdict.decisive.scheduleName} »` : null
  if (action === 'cut') {
    return verdict.cause === 'forbidden_window'
      ? `Immobilisation planifiée : plage interdite du calendrier ${nom}`
      : `Immobilisation planifiée : hors des plages autorisées du calendrier ${nom}`
  }
  return nom
    ? `Fin d'immobilisation planifiée : plage autorisée du calendrier ${nom}`
    : "Fin d'immobilisation planifiée : plus aucune restriction horaire en cours"
}
