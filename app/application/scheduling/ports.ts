import type { WeeklyWindow, ScheduleMode } from '#domain/scheduling/value_objects'
import type { ScheduleAssignment, DesiredUsage, UsageCause } from '#domain/scheduling/usage_policy'
import type {
  ConfirmedEngineCommand,
  EnforcementAction,
  EnforcementMemory,
  EnforcementOutcome,
} from '#domain/scheduling/enforcement_policy'

/**
 * =========================================================================
 *  PORTS DU CONTEXTE PLANIFICATION
 * =========================================================================
 *
 * Deux familles :
 *
 *  - ADMINISTRATION des calendriers (plages, rattachement aux véhicules et
 *    aux groupes) : le CRUD reste pragmatique, mais l'écriture des plages et
 *    le rattachement portent des règles (atomicité, cloisonnement) qui
 *    n'ont pas leur place dans un contrôleur.
 *
 *  - APPLICATION des calendriers : lecture de tout ce que le moteur doit
 *    savoir d'un véhicule en UNE passe, et mémoire du moteur.
 */

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export interface ScheduleWindowView {
  id: string
  dayOfWeek: number
  startTime: string
  endTime: string
}

export interface ScheduleTargetView {
  id: string
  /** Immatriculation (véhicule) ou nom (groupe). */
  label: string
  mode: ScheduleMode
  createdAt: Date
}

export interface AssignmentChange {
  /** Rattachés par cet appel. */
  applied: string[]
  /** Déjà rattachés, mode modifié. */
  updated: string[]
  /** Déjà rattachés avec le même mode (idempotence). */
  unchanged: string[]
  /** Inconnus, supprimés, ou d'une AUTRE organisation. */
  rejected: string[]
}

export interface UsageScheduleRepository {
  /** Crée le calendrier ET ses plages dans une seule transaction. */
  create(input: {
    organizationId: string
    name: string
    description: string | null
    timezone: string
    isActive: boolean
    windows: readonly WeeklyWindow[]
  }): Promise<string>

  /** Remplace TOUTES les plages (transactionnel) : le formulaire envoie la semaine entière. */
  replaceWindows(scheduleId: string, windows: readonly WeeklyWindow[]): Promise<void>

  windowsOf(scheduleIds: string[]): Promise<Record<string, ScheduleWindowView[]>>

  /** Effectifs rattachés, pour toute une page de calendriers en une requête. */
  countTargets(scheduleIds: string[]): Promise<Record<string, { vehicles: number; groups: number }>>

  vehiclesOf(scheduleId: string): Promise<ScheduleTargetView[]>
  groupsOf(scheduleId: string): Promise<ScheduleTargetView[]>

  /** N'accepte que les véhicules vivants de `organizationId` ; upsert du mode. */
  attachVehicles(
    scheduleId: string,
    organizationId: string,
    vehicleIds: string[],
    mode: ScheduleMode
  ): Promise<AssignmentChange>
  attachGroups(
    scheduleId: string,
    organizationId: string,
    groupIds: string[],
    mode: ScheduleMode
  ): Promise<AssignmentChange>

  detachVehicle(scheduleId: string, vehicleId: string): Promise<boolean>
  detachGroup(scheduleId: string, groupId: string): Promise<boolean>

  /** Véhicules vivants membres de ces groupes (simulation d'un calendrier de groupe). */
  vehicleIdsOfGroups(groupIds: string[]): Promise<string[]>

  /** Calendriers d'un groupe de véhicules (écran du groupe). */
  schedulesOfGroup(
    groupId: string
  ): Promise<Array<{ id: string; name: string; mode: ScheduleMode; isActive: boolean }>>
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/** Tout ce que le moteur doit savoir d'un véhicule, lu en une passe. */
export interface EnforcementTarget {
  vehicleId: string
  organizationId: string
  registration: string
  /** Calendriers ACTIFS applicables : directs et hérités des groupes. */
  assignments: ScheduleAssignment[]
  /** Mémoire du moteur, `null` au premier passage. */
  state: EnforcementState | null
  lastConfirmed: ConfirmedEngineCommand | null
  commandInFlight: boolean
  lastOperatorCommandAt: Date | null
}

/** Ligne de `vehicle_schedule_states`. */
export interface EnforcementState extends EnforcementMemory {
  vehicleId: string
  organizationId: string
  cause: UsageCause
  scheduleId: string | null
  attempts: number
  lastErrorCode: string | null
  lastErrorMessage: string | null
  lastCommandId: string | null
  lastOutcome: EnforcementOutcome | null
  evaluatedAt: Date
}

export interface EnforcementReader {
  /**
   * Véhicules à évaluer : ceux qui suivent au moins un calendrier actif, plus
   * ceux que le moteur gère encore (action en attente, ou immobilisés par un
   * calendrier qui vient d'être retiré — il faut pouvoir les libérer).
   */
  listTargets(filter?: {
    vehicleIds?: string[]
    organizationId?: string
  }): Promise<EnforcementTarget[]>
}

export interface EnforcementStateStore {
  save(state: EnforcementState): Promise<void>
}

// ---------------------------------------------------------------------------
// Journal d'exécution (`schedule_enforcement_events`) et analyses
// ---------------------------------------------------------------------------

export type EnforcementEventKind =
  | 'transition'
  | 'dispatched'
  | 'refused'
  | 'completed'
  | 'overridden'
  | 'manual_cut_kept'
  | 'already_immobilized'

/** Un événement significatif du moteur, rattaché au calendrier décisif. */
export interface EnforcementEvent {
  organizationId: string
  vehicleId: string
  scheduleId: string | null
  /** Flotte par laquelle le calendrier s'applique (null : rattachement direct). */
  vehicleGroupId: string | null
  kind: EnforcementEventKind
  desired: DesiredUsage | null
  action: EnforcementAction | null
  commandId: string | null
  errorCode: string | null
  /** Début de l'action (entrée en plage) : sur `completed`, donne le délai réel d'exécution. */
  pendingSince: Date | null
  occurredAt: Date
}

/** Écriture du journal — par le seul moteur, jamais en simulation. */
export interface EnforcementEventLog {
  record(events: EnforcementEvent[]): Promise<void>
}

export interface CommandTally {
  requested: number
  acknowledged: number
  failed: number
  expired: number
  cancelled: number
  inFlight: number
}

export interface LatencyStats {
  /** Secondes. */
  median: number | null
  p90: number | null
  samples: number
}

export interface ScheduleAnalyticsQuery {
  /** Vide : toutes les organisations (exploitant). */
  organizationIds: string[]
  /** Dates civiles incluses, lues dans `timezone`. */
  from: string
  to: string
  timezone: string
}

export interface ScheduleAnalyticsDay {
  date: string
  cut: CommandTally
  restore: CommandTally
  refusals: number
  refusedVehicles: number
  overrides: number
  manualCutsKept: number
  transitionsToImmobilized: number
  transitionsToFree: number
  completed: number
  /** Par heure locale (24 cases) : commandes demandées et tentatives refusées. */
  hours: { cut: number[]; restore: number[]; refused: number[] }
}

export interface ScheduleAnalytics {
  range: { from: string; to: string; timezone: string; startsAt: string; endsAt: string }
  totals: {
    cut: CommandTally
    restore: CommandTally
    refusals: number
    refusedVehicles: number
    overrides: number
    manualCutsKept: number
    alreadyImmobilized: number
    transitionsToImmobilized: number
    transitionsToFree: number
    vehicles: number
    /** Commande demandée → acquittement du boîtier. */
    commandLatency: { cut: LatencyStats; restore: LatencyStats }
    /** Entrée / sortie de plage → objectif confirmé : ce que vit l'exploitant. */
    executionDelay: { cut: LatencyStats; restore: LatencyStats }
  }
  refusalsByCode: Array<{ code: string; count: number; vehicles: number }>
  days: ScheduleAnalyticsDay[]
  vehicles: Array<{
    id: string
    registration: string | null
    organizationId: string
    cuts: number
    restores: number
    failures: number
    refusals: number
    overrides: number
  }>
  schedules: Array<{
    id: string
    name: string
    organizationId: string
    transitionsToImmobilized: number
    dispatched: number
    acknowledged: number
    refusals: number
    overrides: number
    completed: number
    medianExecutionSeconds: number | null
  }>
  /** Premier événement journalisé : avant, refus et dérogations ne sont pas connus. */
  journalSince: string | null
}

export interface ScheduleAnalyticsReader {
  analyze(query: ScheduleAnalyticsQuery): Promise<ScheduleAnalytics>
}

/**
 * Réconciliation des commandes en vol avec la passerelle (flespi).
 * Sans elle, une coupure `sent` acquittée par le boîtier resterait `sent`
 * chez nous : le moteur croirait la commande encore en vol.
 */
export interface CommandReconciler {
  syncAll(): Promise<unknown>
}

/** Résultat d'une tentative d'émission. */
export interface IssueOutcome {
  /** Commande créée (même si son émission a échoué ensuite). */
  commandId: string | null
  /** Statut final de la commande, `null` si la demande a été refusée avant création. */
  status: string | null
  errorCode: string | null
  errorMessage: string | null
}

/**
 * Émission d'une commande moteur au nom du moteur de planification.
 * L'implémentation passe par les MÊMES cas d'usage que l'opérateur : aucun
 * garde-fou (CM-07, CM-09, interrupteur général, relais) n'est contourné.
 */
export interface EngineCommandIssuer {
  issue(input: {
    action: EnforcementAction
    vehicleId: string
    organizationId: string
    reason: string
  }): Promise<IssueOutcome>
}

export type { DesiredUsage }
