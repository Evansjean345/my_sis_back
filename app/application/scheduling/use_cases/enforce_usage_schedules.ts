import { Ok, type DomainError, type Result } from '#domain/kernel'
import type { AuditLogger, Clock, UseCase } from '#application/ports'
import type {
  CommandReconciler,
  EngineCommandIssuer,
  EnforcementReader,
  EnforcementState,
  EnforcementStateStore,
  EnforcementTarget,
  IssueOutcome,
} from '#application/scheduling/ports'

import {
  enforcementReason,
  resolveUsage,
  type DesiredUsage,
  type UsageCause,
} from '#domain/scheduling/usage_policy'

import {
  decideEnforcement,
  type EnforcementAction,
  type EnforcementOutcome,
} from '#domain/scheduling/enforcement_policy'

export interface EnforceUsageSchedulesInput {
  /** Simulation : rien n'est émis ni écrit. */
  dryRun?: boolean
  /** Instant d'évaluation — en simulation uniquement (« que se passerait-il lundi à 6 h ? »). */
  at?: Date
  vehicleIds?: string[]
  organizationId?: string
}

export interface EnforcementReportEntry {
  vehicleId: string
  registration: string
  organizationId: string
  desired: DesiredUsage
  cause: UsageCause
  schedule: { id: string; name: string; source: string } | null
  outcome: EnforcementOutcome
  action: EnforcementAction | null
  pendingAction: EnforcementAction | null
  commandId: string | null
  commandStatus: string | null
  errorCode: string | null
  errorMessage: string | null
}

export interface EnforcementReport {
  evaluatedAt: Date
  dryRun: boolean
  evaluated: number
  dispatched: number
  refused: number
  entries: EnforcementReportEntry[]
}

export interface EnforcementSettings {
  /** Délai entre deux tentatives après un refus passager (véhicule en mouvement…). */
  retryIntervalSeconds: number
  /** Délai après un refus durable ou un échec d'émission (relais absent, flespi en erreur…). */
  backoffSeconds: number
}

/**
 * Refus PASSAGERS : la situation se règle d'elle-même, on retente vite.
 * Tout autre refus (immobilisation désactivée sur le véhicule, pas de
 * relais, interrupteur général coupé) attend `backoffSeconds`.
 */
const TRANSIENT_ERRORS = new Set([
  'E_VEHICLE_IN_MOTION',
  'E_UNSAFE_SPEED',
  'E_NO_POSITION',
  'E_STALE_POSITION',
  'E_COMMAND_IN_FLIGHT',
  'E_CONCURRENT_MODIFICATION',
])

/**
 * =========================================================================
 *  CAS D'USAGE — Appliquer les calendriers d'utilisation au moteur
 * =========================================================================
 *
 * Un passage = pour chaque véhicule concerné :
 *
 *   calendriers ──resolveUsage──▶ verdict (libre / immobilisé)
 *   verdict + mémoire + faits ──decideEnforcement──▶ action (cut / restore / rien)
 *   action ──EngineCommandIssuer──▶ mêmes cas d'usage que l'opérateur
 *
 * Toutes les règles vivent dans le domaine (`domain/scheduling`) ; ce cas
 * d'usage orchestre, persiste la mémoire et trace les transitions.
 *
 * Un véhicule en erreur n'interrompt jamais le passage : la flotte d'un
 * client ne doit pas rester ouverte parce que le boîtier d'un autre ne
 * répond pas.
 */
export class EnforceUsageSchedules implements UseCase<
  EnforceUsageSchedulesInput,
  EnforcementReport
> {
  constructor(
    private readonly reader: EnforcementReader,
    private readonly store: EnforcementStateStore,
    private readonly issuer: EngineCommandIssuer,
    private readonly reconciler: CommandReconciler,
    private readonly clock: Clock,
    private readonly audit: AuditLogger,
    private readonly settings: EnforcementSettings,
    private readonly onError: (err: unknown, vehicleId: string) => void = () => {}
  ) {}

  async execute(
    input: EnforceUsageSchedulesInput = {}
  ): Promise<Result<EnforcementReport, DomainError>> {
    const dryRun = Boolean(input.dryRun)
    // Un instant arbitraire n'a de sens qu'en simulation : en réel, on agit MAINTENANT.
    const now = dryRun && input.at ? input.at : this.clock.now()

    if (!dryRun) {
      // Les résultats flespi d'abord : une coupure acquittée doit être vue comme telle.
      await this.reconciler.syncAll().catch((err) => this.onError(err, '*'))
    }

    const targets = await this.reader.listTargets({
      vehicleIds: input.vehicleIds,
      organizationId: input.organizationId,
    })

    const report: EnforcementReport = {
      evaluatedAt: now,
      dryRun,
      evaluated: targets.length,
      dispatched: 0,
      refused: 0,
      entries: [],
    }

    for (const target of targets) {
      try {
        const entry = await this.enforce(target, now, dryRun)
        if (entry.action && entry.commandStatus && !entry.errorCode) report.dispatched++
        if (entry.action && entry.errorCode) report.refused++
        report.entries.push(entry)
      } catch (err) {
        this.onError(err, target.vehicleId)
      }
    }
    return Ok(report)
  }

  private async enforce(
    target: EnforcementTarget,
    now: Date,
    dryRun: boolean
  ): Promise<EnforcementReportEntry> {
    const verdict = resolveUsage(target.assignments, now)
    const decision = decideEnforcement({
      desired: verdict.state,
      previous: target.state,
      lastConfirmed: target.lastConfirmed,
      commandInFlight: target.commandInFlight,
      lastOperatorCommandAt: target.lastOperatorCommandAt,
      now,
    })

    const previous = target.state
    let attempts =
      decision.transition || !decision.memory.pendingAction ? 0 : (previous?.attempts ?? 0)
    let nextAttemptAt = decision.memory.nextAttemptAt
    let issued: IssueOutcome | null = null

    if (decision.action && !dryRun) {
      issued = await this.issuer.issue({
        action: decision.action,
        vehicleId: target.vehicleId,
        organizationId: target.organizationId,
        reason: enforcementReason(verdict, decision.action),
      })
      attempts += 1
      const passager = issued.errorCode ? TRANSIENT_ERRORS.has(issued.errorCode) : true
      const delai = passager ? this.settings.retryIntervalSeconds : this.settings.backoffSeconds
      nextAttemptAt = new Date(now.getTime() + delai * 1000)
    }

    const state: EnforcementState = {
      vehicleId: target.vehicleId,
      organizationId: target.organizationId,
      desired: decision.memory.desired,
      cause: verdict.cause,
      scheduleId: verdict.decisive?.scheduleId ?? null,
      pendingAction: decision.memory.pendingAction,
      pendingSince: decision.memory.pendingSince,
      nextAttemptAt: decision.memory.pendingAction ? nextAttemptAt : null,
      attempts,
      lastErrorCode: issued
        ? issued.errorCode
        : decision.action
          ? null
          : (previous?.lastErrorCode ?? null),
      lastErrorMessage: issued
        ? issued.errorMessage
        : decision.action
          ? null
          : (previous?.lastErrorMessage ?? null),
      lastCommandId: issued?.commandId ?? previous?.lastCommandId ?? null,
      lastOutcome: decision.outcome,
      evaluatedAt: now,
    }

    if (!dryRun) {
      if (hasChanged(previous, state)) await this.store.save(state)
      if (decision.transition || ['overridden', 'manual_cut_kept'].includes(decision.outcome)) {
        await this.trace(target, state, verdict.decisive?.scheduleName ?? null).catch((err) =>
          this.onError(err, target.vehicleId)
        )
      }
    }

    const source = verdict.decisive?.source
    return {
      vehicleId: target.vehicleId,
      registration: target.registration,
      organizationId: target.organizationId,
      desired: verdict.state,
      cause: verdict.cause,
      schedule: verdict.decisive
        ? {
            id: verdict.decisive.scheduleId,
            name: verdict.decisive.scheduleName,
            source: source?.type === 'group' ? `group:${source.groupName}` : 'vehicle',
          }
        : null,
      outcome: decision.outcome,
      action: decision.action,
      pendingAction: state.pendingAction,
      commandId: issued?.commandId ?? null,
      commandStatus: issued?.status ?? null,
      errorCode: issued?.errorCode ?? null,
      errorMessage: issued?.errorMessage ?? null,
    }
  }

  /** Trace d'audit des TRANSITIONS — « pourquoi ce moteur a-t-il été coupé à 22 h ? ». */
  private trace(target: EnforcementTarget, state: EnforcementState, scheduleName: string | null) {
    return this.audit.record({
      context: {
        actorId: null,
        actorType: 'system',
        organizationId: target.organizationId,
        requestId: `schedule-enforcer:${target.vehicleId}`,
      },
      action: `scheduling.enforcement.${state.lastOutcome}`,
      resourceType: 'vehicle',
      resourceId: target.vehicleId,
      after: {
        desired: state.desired,
        cause: state.cause,
        scheduleId: state.scheduleId,
        scheduleName,
        pendingAction: state.pendingAction,
      },
      metadata: { registration: target.registration },
    })
  }
}

/** On n'écrit la mémoire que si elle change : pas d'UPDATE par véhicule et par minute. */
function hasChanged(previous: EnforcementState | null, next: EnforcementState): boolean {
  if (!previous) return true
  const cle = (s: EnforcementState) =>
    JSON.stringify([
      s.desired,
      s.cause,
      s.scheduleId,
      s.pendingAction,
      s.pendingSince?.getTime() ?? null,
      s.nextAttemptAt?.getTime() ?? null,
      s.attempts,
      s.lastErrorCode,
      s.lastCommandId,
      s.lastOutcome,
    ])
  return cle(previous) !== cle(next)
}
