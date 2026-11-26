import { Ok, type DomainError, type Result } from '#domain/kernel'
import type { AuditLogger, Clock, UseCase } from '#application/ports'
import type {
  CommandReconciler,
  EngineCommandIssuer,
  EnforcementEvent,
  EnforcementEventLog,
  EnforcementReader,
  EnforcementState,
  EnforcementStateStore,
  EnforcementTarget,
  IssueOutcome,
} from '#application/scheduling/ports'
import {
  DISPATCH_FAILED_CODE,
  ONE_TIME_OUTCOMES,
  TRANSIENT_REFUSAL_CODES,
  type EnforcementAction,
  type EnforcementOutcome,
} from '#domain/scheduling/code_legacy/schedule/schedule_enforcement'
import type {
  DesiredUsage,
  UsageCause,
} from '#domain/scheduling/code_legacy/schedule/schedule_usage'
import type {
  EnforcementDecision,
  UsageVerdict,
} from '#domain/scheduling/code_legacy/schedule/schedule_types'
import { enforcementReason, resolveUsage } from '#domain/scheduling/usage_policy'
import { decideEnforcement } from '#domain/scheduling/enforcement_policy'

export interface EnforceUsageSchedulesInput {
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

const REFUS_PASSAGERS: ReadonlySet<string> = new Set(TRANSIENT_REFUSAL_CODES)
const ISSUES_PONCTUELLES: ReadonlySet<EnforcementOutcome> = new Set(ONE_TIME_OUTCOMES)

/**
 * =========================================================================
 *  CAS D'USAGE — Appliquer automatiquement les plages horaires au moteur
 * =========================================================================
 *
 * Un passage = pour chaque véhicule concerné :
 *
 *   calendriers ──resolveUsage──▶ verdict (libre / immobilisé)
 *   verdict + mémoire + faits ──decideEnforcement──▶ action (cut / restore / rien)
 *   action ──EngineCommandIssuer──▶ mêmes garde-fous que l'opérateur (CM-07, CM-09…)
 *
 * Aucune intervention humaine n'est attendue ni prise en compte : un véhicule
 * hors de ses plages est coupé dès que le garde-fou de vitesse le permet.
 * Toutes les règles vivent dans le domaine (`domain/scheduling`) ; ce cas
 * d'usage orchestre, persiste la mémoire et journalise.
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
    private readonly events: EnforcementEventLog,
    private readonly settings: EnforcementSettings,
    private readonly onError: (err: unknown, vehicleId: string) => void = () => {}
  ) {}

  async execute(
    input: EnforceUsageSchedulesInput = {}
  ): Promise<Result<EnforcementReport, DomainError>> {
    const now = this.clock.now()

    // Les résultats flespi d'abord : une coupure acquittée doit être vue comme telle.
    await this.reconciler.syncAll().catch((err) => this.onError(err, '*'))

    const targets = await this.reader.listTargets({
      vehicleIds: input.vehicleIds,
      organizationId: input.organizationId,
    })

    const report: EnforcementReport = {
      evaluatedAt: now,
      evaluated: targets.length,
      dispatched: 0,
      refused: 0,
      entries: [],
    }

    for (const target of targets) {
      try {
        const entry = await this.enforce(target, now)
        if (entry.action && entry.commandStatus && !entry.errorCode) report.dispatched++
        if (entry.action && entry.errorCode) report.refused++
        report.entries.push(entry)
      } catch (err) {
        this.onError(err, target.vehicleId)
      }
    }
    return Ok(report)
  }

  private async enforce(target: EnforcementTarget, now: Date): Promise<EnforcementReportEntry> {
    const verdict = resolveUsage(target.assignments, now)
    const decision = decideEnforcement({
      desired: verdict.state,
      previous: target.state,
      lastConfirmed: target.lastConfirmed,
      commandInFlight: target.commandInFlight,
      now,
    })

    const previous = target.state
    let attempts = decision.resumed ? (previous?.attempts ?? 0) : 0
    let nextAttemptAt = decision.memory.nextAttemptAt
    let issued: IssueOutcome | null = null

    if (decision.action) {
      issued = await this.issuer.issue({
        action: decision.action,
        vehicleId: target.vehicleId,
        organizationId: target.organizationId,
        reason: enforcementReason(verdict, decision.action),
      })
      attempts += 1
      const passager = issued.errorCode ? REFUS_PASSAGERS.has(issued.errorCode) : true
      const delai = passager ? this.settings.retryIntervalSeconds : this.settings.backoffSeconds
      nextAttemptAt = new Date(now.getTime() + delai * 1000)
    }

    const state = nextState({ target, verdict, decision, attempts, nextAttemptAt, issued, now })

    if (hasChanged(previous, state)) await this.store.save(state)
    const journal = journalEvents({ target, verdict, decision, previous, issued, now })
    if (journal.length > 0) {
      // Au mieux, comme l'audit : un journal indisponible ne doit pas empêcher une coupure.
      await this.events.record(journal).catch((err) => this.onError(err, target.vehicleId))
    }
    if (decision.transition || decision.outcome === 'manual_cut_kept') {
      await this.trace(target, state, verdict.decisive?.scheduleName ?? null).catch((err) =>
        this.onError(err, target.vehicleId)
      )
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

/** Mémoire du moteur après ce passage. */
function nextState(input: {
  target: EnforcementTarget
  verdict: UsageVerdict
  decision: EnforcementDecision
  attempts: number
  nextAttemptAt: Date | null
  issued: IssueOutcome | null
  now: Date
}): EnforcementState {
  const { target, verdict, decision, issued, now } = input
  const previous = target.state
  // Une nouvelle tentative efface l'erreur précédente ; sinon on garde la dernière connue.
  const garderErreur = !issued && !decision.action
  return {
    vehicleId: target.vehicleId,
    organizationId: target.organizationId,
    desired: decision.memory.desired,
    cause: verdict.cause,
    scheduleId: verdict.decisive?.scheduleId ?? null,
    pendingAction: decision.memory.pendingAction,
    pendingSince: decision.memory.pendingSince,
    nextAttemptAt: decision.memory.pendingAction ? input.nextAttemptAt : null,
    attempts: input.attempts,
    lastErrorCode: issued
      ? issued.errorCode
      : garderErreur
        ? (previous?.lastErrorCode ?? null)
        : null,
    lastErrorMessage: issued
      ? issued.errorMessage
      : garderErreur
        ? (previous?.lastErrorMessage ?? null)
        : null,
    lastCommandId: issued?.commandId ?? previous?.lastCommandId ?? null,
    lastOutcome: decision.outcome,
    evaluatedAt: now,
  }
}

/**
 * Événements à journaliser pour ce passage — la matière des analyses :
 *
 *   transition       entrée / sortie de plage
 *   dispatched       commande émise (échec passerelle compris : son statut le dira)
 *   refused          tentative refusée avant l'envoi, une ligne PAR tentative
 *   completed …      issues ponctuelles (une seule fois par action)
 */
function journalEvents(input: {
  target: EnforcementTarget
  verdict: UsageVerdict
  decision: EnforcementDecision
  previous: EnforcementState | null
  issued: IssueOutcome | null
  now: Date
}): EnforcementEvent[] {
  const { target, verdict, decision, previous, issued, now } = input
  const source = verdict.decisive?.source
  const base = {
    organizationId: target.organizationId,
    vehicleId: target.vehicleId,
    // Retour en plage : on garde le calendrier qui coupait si le verdict n'en désigne plus.
    scheduleId: verdict.decisive?.scheduleId ?? previous?.scheduleId ?? null,
    vehicleGroupId: source?.type === 'group' ? source.groupId : null,
    desired: decision.memory.desired,
    action: null,
    commandId: null,
    errorCode: null,
    pendingSince: null,
    occurredAt: now,
  } satisfies Omit<EnforcementEvent, 'kind'>

  const out: EnforcementEvent[] = []
  if (decision.transition) out.push({ ...base, kind: 'transition' })

  if (ISSUES_PONCTUELLES.has(decision.outcome)) {
    out.push({
      ...base,
      kind: decision.outcome as EnforcementEvent['kind'],
      action: previous?.pendingAction ?? null,
      pendingSince: previous?.pendingSince ?? null,
    })
  }

  if (issued && decision.action) {
    const emise =
      issued.commandId !== null && (!issued.errorCode || issued.errorCode === DISPATCH_FAILED_CODE)
    out.push({
      ...base,
      kind: emise ? 'dispatched' : 'refused',
      action: decision.action,
      commandId: issued.commandId,
      errorCode: emise ? null : (issued.errorCode ?? 'E_UNKNOWN'),
      pendingSince: decision.memory.pendingSince,
    })
  }
  return out
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
