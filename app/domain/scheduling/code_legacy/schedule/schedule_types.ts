import type { DayOfWeek } from '#domain/scheduling/code_legacy/schedule/schedule_days'
import type {
  EnforcementAction,
  EnforcementOutcome,
} from '#domain/scheduling/code_legacy/schedule/schedule_enforcement'
import type {
  DesiredUsage,
  UsageCause,
} from '#domain/scheduling/code_legacy/schedule/schedule_usage'
import type { WeeklyWindow } from '#domain/scheduling/value_objects'

/**
 * =========================================================================
 *  PLAGES HORAIRES — interfaces (référentiel en dur)
 * =========================================================================
 */

// ---------------------------------------------------------------------------
// Plages
// ---------------------------------------------------------------------------

/** Plage telle que saisie : jour, heure de début et de fin (`HH:MM`). */
/*
Plage par semaine dayOfWeek - startTime - endTime
*/
export interface WeeklyWindowInput {
  readonly dayOfWeek: number
  readonly startTime: string
  readonly endTime: string
}

/** Plage validée, telle que rendue par l'API. */
/*
Plage validée par l'api
*/
export interface WeeklyWindowJson {
  readonly dayOfWeek: DayOfWeek
  readonly startTime: string
  readonly endTime: string
}

/** Heure murale d'un instant dans le fuseau d'un calendrier. */
export interface LocalClock {
  readonly dayOfWeek: DayOfWeek
  readonly secondOfDay: number
}

// ---------------------------------------------------------------------------
// Calendriers appliqués à un véhicule
// ---------------------------------------------------------------------------

/** Origine d'un calendrier : rattaché au véhicule, ou hérité d'une flotte. */
export type ScheduleSource =
  | { readonly type: 'vehicle' }
  | { readonly type: 'group'; readonly groupId: string; readonly groupName: string }

/** Un calendrier ACTIF appliqué à un véhicule. Ses plages sont des plages autorisées. */
export interface ScheduleAssignment {
  readonly scheduleId: string
  readonly scheduleName: string
  readonly timezone: string
  readonly windows: readonly WeeklyWindow[]
  readonly source: ScheduleSource
}

/** Libre ou immobilisé, maintenant, et pourquoi. */
export interface UsageVerdict {
  readonly state: DesiredUsage
  readonly cause: UsageCause
  /** Le calendrier qui a tranché — inscrit dans le motif de la commande. */
  readonly decisive: ScheduleAssignment | null
}

// ---------------------------------------------------------------------------
// Application au moteur
// ---------------------------------------------------------------------------

/** Mémoire du moteur entre deux passages (`vehicle_schedule_states`). */
export interface EnforcementMemory {
  readonly desired: DesiredUsage
  readonly pendingAction: EnforcementAction | null
  readonly pendingSince: Date | null
  /** Pas de nouvelle tentative avant cette date (null = immédiatement). */
  readonly nextAttemptAt: Date | null
}

/** Dernière commande moteur CONFIRMÉE par le boîtier, quelle qu'en soit l'origine. */
export interface ConfirmedEngineCommand {
  readonly commandType: 'engine_cut' | 'engine_restore'
  readonly origin: string
  readonly at: Date
}

/** Ce que le moteur sait d'un véhicule à un passage. */
export interface EnforcementInput {
  readonly desired: DesiredUsage
  readonly previous: EnforcementMemory | null
  readonly lastConfirmed: ConfirmedEngineCommand | null
  /** Une commande occupe le boîtier (approved / queued / sent) : CM-09. */
  readonly commandInFlight: boolean
  readonly now: Date
}

export interface EnforcementDecision {
  readonly memory: EnforcementMemory
  /** Commande à émettre maintenant (null : rien à émettre). */
  readonly action: EnforcementAction | null
  readonly outcome: EnforcementOutcome
  /** Vrai si le verdict vient de changer (entrée / sortie de plage). */
  readonly transition: boolean
  /** Vrai si l'action en attente est la même qu'au passage précédent (tentatives cumulées). */
  readonly resumed: boolean
}
