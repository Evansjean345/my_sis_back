import { test } from '@japa/runner'
import {
  WeeklyWindow,
  localClock,
  validateWeeklyWindows,
  isValidTimeZone,
  type ScheduleMode,
} from '#domain/scheduling/value_objects'
import {
  resolveUsage,
  enforcementReason,
  type ScheduleAssignment,
} from '#domain/scheduling/usage_policy'
import {
  decideEnforcement,
  type EnforcementInput,
  type EnforcementMemory,
} from '#domain/scheduling/enforcement_policy'
import { EnforceUsageSchedules } from '#application/scheduling/use_cases/enforce_usage_schedules'
import { UseCaseEngineCommandIssuer } from '#application/scheduling/engine_command_issuer'
import type {
  EngineCommandIssuer,
  EnforcementReader,
  EnforcementState,
  EnforcementStateStore,
  EnforcementTarget,
  IssueOutcome,
} from '#application/scheduling/ports'
import type { AuditLogger } from '#application/ports'
import { Err, Ok, type DomainError } from '#domain/kernel'
import { VehicleInMotionError } from '#domain/security/errors'
import type { RequestImmobilization } from '#application/security/use_cases/request_immobilization'
import type { RequestEngineRestore } from '#application/security/use_cases/request_engine_restore'
import type { DispatchEngineCommand } from '#application/security/use_cases/dispatch_engine_command'
import type { CancelEngineCommand } from '#application/security/use_cases/cancel_engine_command'

/**
 * =========================================================================
 *  IMMOBILISATION PLANIFIÉE — sans base, sans réseau, sans horloge réelle
 * =========================================================================
 *
 * Abidjan est en UTC+0 toute l'année : les instants ISO ci-dessous se lisent
 * directement en heure locale. 2026-11-03 est un MARDI (jour 2).
 */

const VEHICLE = '33333333-3333-4333-8333-333333333333'
const ORG = '66666666-6666-4666-8666-666666666666'
const at = (iso: string) => new Date(iso)

function plages(...fenetres: Array<[number, string, string]>) {
  const r = validateWeeklyWindows(
    fenetres.map(([dayOfWeek, startTime, endTime]) => ({ dayOfWeek, startTime, endTime }))
  )
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}

function calendrier(
  mode: ScheduleMode,
  fenetres: Array<[number, string, string]>,
  over: Partial<ScheduleAssignment> = {}
): ScheduleAssignment {
  return {
    scheduleId: '77777777-7777-4777-8777-777777777777',
    scheduleName: mode === 'allowed' ? 'Heures de service' : 'Couvre-feu',
    timezone: 'Africa/Abidjan',
    mode,
    windows: plages(...fenetres),
    source: { type: 'vehicle' },
    ...over,
  }
}

/** Lundi → vendredi, 06:00-20:00. */
const SEMAINE_6_20: Array<[number, string, string]> = [1, 2, 3, 4, 5].map((d) => [
  d,
  '06:00',
  '20:00',
])

// =========================================================================
//  Objets-valeurs
// =========================================================================

test.group('planification · fenêtres et fuseau', () => {
  test('une plage valide est acceptée, 24:00 compris', ({ assert }) => {
    const w = WeeklyWindow.create({ dayOfWeek: 1, startTime: '22:00', endTime: '24:00' })
    assert.isTrue(w.ok)
    if (!w.ok) return
    assert.equal(w.value.endTime, '24:00')
    assert.deepEqual(w.value.toRow(), { dayOfWeek: 1, startTime: '22:00:00', endTime: '24:00:00' })
  })

  test('refus : jour hors 0-6, heure illisible, fin avant début', ({ assert }) => {
    for (const r of [
      { dayOfWeek: 7, startTime: '08:00', endTime: '12:00' },
      { dayOfWeek: 1, startTime: '25:00', endTime: '26:00' },
      { dayOfWeek: 1, startTime: '22:00', endTime: '06:00' },
      { dayOfWeek: 1, startTime: '08:00', endTime: '08:00' },
      { dayOfWeek: 1, startTime: '24:00', endTime: '24:00' },
    ]) {
      const w = WeeklyWindow.create(r)
      assert.isFalse(w.ok, JSON.stringify(r))
      if (!w.ok) assert.equal(w.error.code, 'E_INVALID_SCHEDULE_WINDOW')
    }
  })

  test('deux plages du même jour qui se chevauchent sont refusées', ({ assert }) => {
    const r = validateWeeklyWindows([
      { dayOfWeek: 2, startTime: '08:00', endTime: '12:00' },
      { dayOfWeek: 2, startTime: '11:30', endTime: '14:00' },
    ])
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_SCHEDULE_WINDOWS_OVERLAP')
  })

  test('des plages contiguës ne se chevauchent pas (fin exclue)', ({ assert }) => {
    const r = validateWeeklyWindows([
      { dayOfWeek: 2, startTime: '12:00', endTime: '14:00' },
      { dayOfWeek: 2, startTime: '08:00', endTime: '12:00' },
    ])
    assert.isTrue(r.ok)
    if (r.ok) assert.equal(r.value[0].startTime, '08:00') // triées
  })

  test('heure locale lue dans le fuseau du calendrier, pas celui du serveur', ({ assert }) => {
    const instant = at('2026-11-03T22:30:00Z')
    assert.deepEqual(localClock(instant, 'Africa/Abidjan'), { dayOfWeek: 2, secondOfDay: 81000 })
    // Paris en novembre : UTC+1 → 23:30, toujours mardi
    assert.deepEqual(localClock(instant, 'Europe/Paris'), { dayOfWeek: 2, secondOfDay: 84600 })
    // Dubaï : UTC+4 → mercredi 02:30
    assert.deepEqual(localClock(instant, 'Asia/Dubai'), { dayOfWeek: 3, secondOfDay: 9000 })
  })

  test('fuseau inconnu détecté', ({ assert }) => {
    assert.isTrue(isValidTimeZone('Africa/Abidjan'))
    assert.isFalse(isValidTimeZone('Afrique/Abidjan'))
  })
})

// =========================================================================
//  Verdict d'usage
// =========================================================================

test.group('planification · verdict libre / immobilisé', () => {
  test('aucun calendrier → libre', ({ assert }) => {
    assert.equal(resolveUsage([], at('2026-11-03T10:00:00Z')).cause, 'no_schedule')
  })

  test('allowed : libre pendant la plage, immobilisé en dehors', ({ assert }) => {
    const c = [calendrier('allowed', SEMAINE_6_20)]
    assert.equal(resolveUsage(c, at('2026-11-03T10:00:00Z')).state, 'free')
    const soir = resolveUsage(c, at('2026-11-03T20:00:00Z')) // borne de fin exclue
    assert.equal(soir.state, 'immobilized')
    assert.equal(soir.cause, 'outside_allowed_windows')
    assert.equal(resolveUsage(c, at('2026-11-08T10:00:00Z')).state, 'immobilized') // dimanche
  })

  test('forbidden : immobilisé pendant la plage seulement', ({ assert }) => {
    const c = [calendrier('forbidden', [[2, '22:00', '24:00']])]
    assert.equal(resolveUsage(c, at('2026-11-03T22:15:00Z')).cause, 'forbidden_window')
    assert.equal(resolveUsage(c, at('2026-11-03T21:59:59Z')).cause, 'outside_forbidden_windows')
  })

  test("l'interdiction l'emporte sur l'autorisation, quel que soit l'ordre", ({ assert }) => {
    const autorise = calendrier('allowed', [[2, '00:00', '24:00']])
    const interdit = calendrier('forbidden', [[2, '12:00', '14:00']], { scheduleName: 'Pause' })
    for (const c of [
      [autorise, interdit],
      [interdit, autorise],
    ]) {
      const v = resolveUsage(c, at('2026-11-03T12:30:00Z'))
      assert.equal(v.state, 'immobilized')
      assert.equal(v.decisive?.scheduleName, 'Pause')
    }
  })

  test("plusieurs calendriers allowed : le véhicule roule pendant l'UNION des plages", ({
    assert,
  }) => {
    const matin = calendrier('allowed', [[2, '06:00', '12:00']])
    const groupe = calendrier('allowed', [[2, '14:00', '18:00']], {
      source: { type: 'group', groupId: VEHICLE, groupName: 'Livraison' },
    })
    assert.equal(resolveUsage([matin, groupe], at('2026-11-03T15:00:00Z')).state, 'free')
    assert.equal(resolveUsage([matin, groupe], at('2026-11-03T13:00:00Z')).state, 'immobilized')
  })

  test('allowed sans aucune plage : immobilisé en permanence', ({ assert }) => {
    assert.equal(
      resolveUsage([calendrier('allowed', [])], at('2026-11-03T10:00:00Z')).state,
      'immobilized'
    )
  })

  test('le motif inscrit sur la commande nomme le calendrier (CM-08)', ({ assert }) => {
    const v = resolveUsage([calendrier('allowed', SEMAINE_6_20)], at('2026-11-03T21:00:00Z'))
    const motif = enforcementReason(v, 'cut')
    assert.include(motif, '« Heures de service »')
    assert.isAtLeast(motif.trim().length, 5)
  })
})

// =========================================================================
//  Décision du moteur
// =========================================================================

const NOW = at('2026-11-03T21:00:00Z')

function decider(over: Partial<EnforcementInput>) {
  return decideEnforcement({
    desired: 'immobilized',
    previous: null,
    lastConfirmed: null,
    commandInFlight: false,
    lastOperatorCommandAt: null,
    now: NOW,
    ...over,
  })
}

const armeCoupure = (over: Partial<EnforcementMemory> = {}): EnforcementMemory => ({
  desired: 'immobilized',
  pendingAction: 'cut',
  pendingSince: at('2026-11-03T20:00:00Z'),
  nextAttemptAt: null,
  ...over,
})

test.group('planification · décision du moteur', () => {
  test('entrée en période interdite → coupure émise', ({ assert }) => {
    const d = decider({
      previous: { desired: 'free', pendingAction: null, pendingSince: null, nextAttemptAt: null },
    })
    assert.equal(d.action, 'cut')
    assert.equal(d.outcome, 'dispatch')
    assert.isTrue(d.transition)
    assert.equal(d.memory.pendingSince?.getTime(), NOW.getTime())
  })

  test('moteur déjà coupé à la transition → rien à émettre', ({ assert }) => {
    const d = decider({
      lastConfirmed: { commandType: 'engine_cut', origin: 'manual', at: NOW },
    })
    assert.isNull(d.action)
    assert.equal(d.outcome, 'already_immobilized')
  })

  test('véhicule encore en mouvement : on attend, puis on retente', ({ assert }) => {
    const avant = decider({
      previous: armeCoupure({ nextAttemptAt: at('2026-11-03T21:00:30Z') }),
    })
    assert.equal(avant.outcome, 'waiting_retry')
    assert.isNull(avant.action)

    const apres = decider({
      previous: armeCoupure({ nextAttemptAt: at('2026-11-03T20:59:00Z') }),
    })
    assert.equal(apres.action, 'cut')
  })

  test('commande en vol : on attend son issue (CM-09)', ({ assert }) => {
    const d = decider({ previous: armeCoupure(), commandInFlight: true })
    assert.equal(d.outcome, 'waiting_in_flight')
    assert.equal(d.memory.pendingAction, 'cut')
  })

  test('coupure confirmée par le boîtier → objectif atteint', ({ assert }) => {
    const d = decider({
      previous: armeCoupure(),
      lastConfirmed: { commandType: 'engine_cut', origin: 'schedule', at: NOW },
    })
    assert.equal(d.outcome, 'completed')
    assert.isNull(d.memory.pendingAction)
  })

  test('fin de plage : on rétablit ce que le calendrier a coupé', ({ assert }) => {
    const d = decider({
      desired: 'free',
      previous: {
        desired: 'immobilized',
        pendingAction: null,
        pendingSince: null,
        nextAttemptAt: null,
      },
      lastConfirmed: { commandType: 'engine_cut', origin: 'schedule', at: NOW },
    })
    assert.equal(d.action, 'restore')
  })

  test("fin de plage : une coupure MANUELLE n'est jamais levée", ({ assert }) => {
    const d = decider({
      desired: 'free',
      previous: {
        desired: 'immobilized',
        pendingAction: null,
        pendingSince: null,
        nextAttemptAt: null,
      },
      lastConfirmed: { commandType: 'engine_cut', origin: 'manual', at: NOW },
    })
    assert.isNull(d.action)
    assert.equal(d.outcome, 'manual_cut_kept')
  })

  test("dérogation : une commande opérateur après l'armement annule l'action", ({ assert }) => {
    const d = decider({
      previous: armeCoupure(),
      lastOperatorCommandAt: at('2026-11-03T20:30:00Z'),
    })
    assert.equal(d.outcome, 'overridden')
    assert.isNull(d.action)
    assert.isNull(d.memory.pendingAction)
  })

  test("une commande opérateur ANTÉRIEURE à l'armement ne vaut pas dérogation", ({ assert }) => {
    const d = decider({
      previous: armeCoupure(),
      lastOperatorCommandAt: at('2026-11-03T19:00:00Z'),
    })
    assert.equal(d.action, 'cut')
  })

  test('sans transition ni action armée : rien', ({ assert }) => {
    const d = decider({
      previous: {
        desired: 'immobilized',
        pendingAction: null,
        pendingSince: null,
        nextAttemptAt: null,
      },
    })
    assert.equal(d.outcome, 'idle')
    assert.isFalse(d.transition)
  })
})

// =========================================================================
//  Cas d'usage
// =========================================================================

function cible(over: Partial<EnforcementTarget> = {}): EnforcementTarget {
  return {
    vehicleId: VEHICLE,
    organizationId: ORG,
    registration: '1234 AB 01',
    assignments: [calendrier('allowed', SEMAINE_6_20)],
    state: null,
    lastConfirmed: null,
    commandInFlight: false,
    lastOperatorCommandAt: null,
    ...over,
  }
}

class FakeIssuer implements EngineCommandIssuer {
  readonly appels: Array<{ action: string; reason: string; organizationId: string }> = []
  constructor(private readonly reponse: Partial<IssueOutcome> = {}) {}
  async issue(input: {
    action: 'cut' | 'restore'
    vehicleId: string
    organizationId: string
    reason: string
  }) {
    this.appels.push(input)
    return { commandId: null, status: 'sent', errorCode: null, errorMessage: null, ...this.reponse }
  }
}

class FakeStore implements EnforcementStateStore {
  readonly sauvegardes: EnforcementState[] = []
  async save(s: EnforcementState) {
    this.sauvegardes.push(s)
  }
}

function moteur(
  targets: EnforcementTarget[],
  issuer: EngineCommandIssuer,
  store = new FakeStore()
) {
  const audits: string[] = []
  const reader: EnforcementReader = { listTargets: async () => targets }
  const audit: AuditLogger = { record: async (e) => void audits.push(e.action) }
  const use = new EnforceUsageSchedules(
    reader,
    store,
    issuer,
    { syncAll: async () => undefined },
    { now: () => NOW },
    audit,
    { retryIntervalSeconds: 60, backoffSeconds: 900 }
  )
  return { use, store, audits }
}

test.group('planification · cas d’usage EnforceUsageSchedules', () => {
  test('hors des heures autorisées : coupure émise, mémoire écrite, transition tracée', async ({
    assert,
  }) => {
    const issuer = new FakeIssuer({ commandId: '88888888-8888-4888-8888-888888888888' })
    const { use, store, audits } = moteur([cible()], issuer)

    const r = await use.execute()
    assert.isTrue(r.ok)
    if (!r.ok) return
    assert.equal(r.value.dispatched, 1)
    assert.lengthOf(issuer.appels, 1)
    assert.equal(issuer.appels[0].action, 'cut')
    assert.equal(issuer.appels[0].organizationId, ORG)
    assert.include(issuer.appels[0].reason, 'Heures de service')

    const s = store.sauvegardes[0]
    assert.equal(s.desired, 'immobilized')
    assert.equal(s.pendingAction, 'cut') // reste armée jusqu'à l'acquittement
    assert.equal(s.attempts, 1)
    assert.equal(s.lastCommandId, '88888888-8888-4888-8888-888888888888')
    assert.deepEqual(audits, ['scheduling.enforcement.dispatch'])
  })

  test('refus passager (véhicule en mouvement) → nouvelle tentative après 60 s', async ({
    assert,
  }) => {
    const issuer = new FakeIssuer({ status: null, errorCode: 'E_VEHICLE_IN_MOTION' })
    const { use, store } = moteur([cible()], issuer)
    const r = await use.execute()
    assert.isTrue(r.ok)
    if (r.ok) assert.equal(r.value.refused, 1)
    assert.equal(store.sauvegardes[0].nextAttemptAt?.getTime(), NOW.getTime() + 60_000)
    assert.equal(store.sauvegardes[0].lastErrorCode, 'E_VEHICLE_IN_MOTION')
  })

  test('refus durable (pas de relais) → attente longue', async ({ assert }) => {
    const issuer = new FakeIssuer({ status: null, errorCode: 'E_DEVICE_NO_RELAY' })
    const { use, store } = moteur([cible()], issuer)
    await use.execute()
    assert.equal(store.sauvegardes[0].nextAttemptAt?.getTime(), NOW.getTime() + 900_000)
  })

  test('simulation : aucune émission, aucune écriture, instant au choix', async ({ assert }) => {
    const issuer = new FakeIssuer()
    const { use, store, audits } = moteur([cible()], issuer)
    const r = await use.execute({ dryRun: true, at: at('2026-11-03T10:00:00Z') })
    assert.isTrue(r.ok)
    if (!r.ok) return
    assert.equal(r.value.entries[0].desired, 'free') // mardi 10 h : dans la plage
    assert.lengthOf(issuer.appels, 0)
    assert.lengthOf(store.sauvegardes, 0)
    assert.lengthOf(audits, 0)
  })

  test("l'instant `at` est ignoré hors simulation", async ({ assert }) => {
    const { use } = moteur([cible()], new FakeIssuer())
    const r = await use.execute({ at: at('2026-11-03T10:00:00Z') })
    if (r.ok) assert.equal(r.value.evaluatedAt.getTime(), NOW.getTime())
  })

  test('mémoire inchangée → pas de réécriture', async ({ assert }) => {
    const etat: EnforcementState = {
      vehicleId: VEHICLE,
      organizationId: ORG,
      desired: 'immobilized',
      cause: 'outside_allowed_windows',
      scheduleId: '77777777-7777-4777-8777-777777777777',
      pendingAction: null,
      pendingSince: null,
      nextAttemptAt: null,
      attempts: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastCommandId: null,
      lastOutcome: 'idle',
      evaluatedAt: NOW,
    }
    const { use, store } = moteur([cible({ state: etat })], new FakeIssuer())
    await use.execute()
    assert.lengthOf(store.sauvegardes, 0)
  })

  test("un véhicule en erreur n'interrompt pas le passage", async ({ assert }) => {
    const issuer: EngineCommandIssuer = {
      async issue(input) {
        if (input.vehicleId === VEHICLE) throw new Error('flespi en panne')
        return { commandId: null, status: 'sent', errorCode: null, errorMessage: null }
      },
    }
    const autre = cible({ vehicleId: '99999999-9999-4999-8999-999999999999', registration: 'B' })
    const { use } = moteur([cible(), autre], issuer)
    const r = await use.execute()
    assert.isTrue(r.ok)
    if (r.ok) {
      assert.lengthOf(r.value.entries, 1)
      assert.equal(r.value.entries[0].registration, 'B')
    }
  })
})

// =========================================================================
//  Émetteur : mêmes cas d'usage que l'opérateur
// =========================================================================

test.group('planification · émetteur de commandes', () => {
  const CMD = '12121212-1212-4212-8212-121212121212'

  function emetteur(opts: { demande?: 'ok' | DomainError; envoi?: 'ok' | DomainError }) {
    const traces: string[] = []
    const immobilize = {
      execute: async (i: { origin: string; context: { actorType: string } }) => {
        traces.push(`request:${i.origin}:${i.context.actorType}`)
        return opts.demande && opts.demande !== 'ok'
          ? Err(opts.demande)
          : Ok({ commandId: CMD, status: 'approved', expiresAt: NOW })
      },
    }
    const dispatch = {
      execute: async () => {
        traces.push('dispatch')
        return opts.envoi && opts.envoi !== 'ok'
          ? Err(opts.envoi)
          : Ok({
              commandId: CMD,
              commandType: 'engine_cut',
              status: 'sent',
              providerCommandId: '1',
            })
      },
    }
    const cancel = {
      execute: async () => {
        traces.push('cancel')
        return Ok({ status: 'cancelled' })
      },
    }
    const issuer = new UseCaseEngineCommandIssuer(
      immobilize as unknown as RequestImmobilization,
      {} as RequestEngineRestore,
      dispatch as unknown as DispatchEngineCommand,
      cancel as unknown as CancelEngineCommand
    )
    return { issuer, traces }
  }

  test('origine `schedule`, acteur `system`, demande puis émission', async ({ assert }) => {
    const { issuer, traces } = emetteur({})
    const r = await issuer.issue({
      action: 'cut',
      vehicleId: VEHICLE,
      organizationId: ORG,
      reason: 'motif planifié',
    })
    assert.deepEqual(traces, ['request:schedule:system', 'dispatch'])
    assert.equal(r.status, 'sent')
    assert.isNull(r.errorCode)
  })

  test('refus CM-07 à la demande : aucune commande créée', async ({ assert }) => {
    const { issuer, traces } = emetteur({ demande: new VehicleInMotionError(42, 5) })
    const r = await issuer.issue({
      action: 'cut',
      vehicleId: VEHICLE,
      organizationId: ORG,
      reason: 'motif planifié',
    })
    assert.deepEqual(traces, ['request:schedule:system'])
    assert.equal(r.errorCode, 'E_VEHICLE_IN_MOTION')
    assert.isNull(r.commandId)
  })

  test("échec avant l'envoi : la commande est annulée pour libérer le boîtier", async ({
    assert,
  }) => {
    const { issuer, traces } = emetteur({ envoi: new VehicleInMotionError(12, 5) })
    const r = await issuer.issue({
      action: 'cut',
      vehicleId: VEHICLE,
      organizationId: ORG,
      reason: 'motif planifié',
    })
    assert.deepEqual(traces, ['request:schedule:system', 'dispatch', 'cancel'])
    assert.equal(r.status, 'cancelled')
    assert.equal(r.commandId, CMD)
  })
})
