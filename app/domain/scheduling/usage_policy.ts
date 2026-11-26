import type { EnforcementAction } from '#domain/scheduling/code_legacy/schedule/schedule_enforcement'
import type {
  ScheduleAssignment,
  UsageVerdict,
} from '#domain/scheduling/code_legacy/schedule/schedule_types'
import { localClock } from '#domain/scheduling/value_objects'

/**
 * =========================================================================
 *  VERDICT D'USAGE — un véhicule doit-il être libre ou immobilisé MAINTENANT ?
 * =========================================================================
 *
 * Fonctions pures : calendriers + instant → verdict. Aucune I/O, aucune horloge.
 * Types et listes : `code_legacy/schedule`.
 *
 * Un véhicule peut suivre plusieurs calendriers : les siens
 * (`vehicle_schedules`) et ceux de chacune de ses flottes
 * (`vehicle_schedule_groups`). Chaque calendrier liste des plages
 * AUTORISÉES :
 *
 *   ① aucun calendrier actif                → LIBRE
 *   ② une plage autorisée est en cours      → LIBRE
 *   ③ aucune plage autorisée en cours       → IMMOBILISÉ
 *
 * Autrement dit, le véhicule roule pendant l'UNION des plages de ses
 * calendriers. Le résultat ne dépend pas de l'ordre des calendriers.
 */

/** Le véhicule est-il dans une plage de ce calendrier, à cet instant (heure du calendrier) ? */
/*
Fonct de traitement pour vérifier si le véhicule est dans une plage horaire du calendrier
*/
export function isWithinSchedule(assignment: ScheduleAssignment, now: Date): boolean {
  const clock = localClock(now, assignment.timezone)
  return assignment.windows.some((w) => w.contains(clock))
}

/*
fonction de resolution d'un usage d'une plage horaire
*/
export function resolveUsage(assignments: readonly ScheduleAssignment[], now: Date): UsageVerdict {
  if (assignments.length === 0) return { state: 'free', cause: 'no_schedule', decisive: null }

  const ouvert = assignments.find((a) => isWithinSchedule(a, now))
  return ouvert
    ? { state: 'free', cause: 'inside_allowed_window', decisive: ouvert }
    : { state: 'immobilized', cause: 'outside_allowed_windows', decisive: assignments[0] }
}

/** Motif inscrit sur la commande moteur (CM-08 : ≥ 5 caractères, toujours explicite). */
export function enforcementReason(verdict: UsageVerdict, action: EnforcementAction): string {
  const nom = verdict.decisive ? `« ${verdict.decisive.scheduleName} »` : null
  if (action === 'cut') {
    return nom
      ? `Immobilisation automatique : hors des plages horaires du calendrier ${nom}`
      : 'Immobilisation automatique : hors des plages horaires'
  }
  return nom
    ? `Fin d'immobilisation automatique : plage horaire du calendrier ${nom}`
    : "Fin d'immobilisation automatique : plus aucune plage horaire ne s'applique"
}
