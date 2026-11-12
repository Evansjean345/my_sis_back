import { test } from '@japa/runner'
import type { DomainEvent, TransactionScope } from '#domain/kernel'
import type { AuditLogger, Clock, IdGenerator, UnitOfWork } from '#application/ports'
import type {
  NewOtp,
  OtpCodeService,
  OtpRecord,
  OtpRepository,
  PasswordHasher,
  UserAccountWriter,
  UserContact,
  UserContactReader,
} from '#application/identity/ports'
import type {
  NewSmsNotification,
  NotificationJournal,
  SmsBalanceLedger,
  SmsGateway,
  SmsGatewayResult,
} from '#application/notification/ports'
import { SmsSender } from '#application/notification/services/sms_sender'
import { IdentityNotifications } from '#application/notification/handlers/identity_notifications'
import { EmailSender } from '#application/notification/services/email_sender'
import { NotificationDispatcher } from '#application/notification/services/notification_dispatcher'
import type { EmailGateway, OutgoingEmail } from '#application/notification/ports'
import type { AccountIdentifier } from '#domain/identity/otp_policy'
import { escapeHtml, isEmailAddress, maskEmail } from '#domain/notification/email_message'
import { EmailTemplates } from '#domain/notification/email_templates'
import { OtpVerifier } from '#application/identity/services/otp_verifier'
import { RequestPasswordReset } from '#application/identity/use_cases/request_password_reset'
import { VerifyPasswordResetCode } from '#application/identity/use_cases/verify_password_reset_code'
import { ResetPassword } from '#application/identity/use_cases/reset_password'
import { SuspendUserAccount } from '#application/identity/use_cases/suspend_user_account'
import { canIssue, DEFAULT_OTP_POLICY, usability } from '#domain/identity/otp_policy'
import { isGsm7, maskPhone, segmentSms } from '#domain/notification/sms_message'
import { SmsTemplates } from '#domain/notification/sms_templates'
import { HmacOtpCodeService } from '#infrastructure/services/otp_code_service'
import {
  computeTwilioSignature,
  isValidTwilioSignature,
} from '#infrastructure/gateways/twilio/twilio_signature'

/**
 * =========================================================================
 *  SMS (Twilio) ET OTP — sans base, sans réseau
 * =========================================================================
 *
 * Ce qui est vérifié ici est ce qui coûterait le plus cher en production :
 * un code devinable (tentatives, expiration), un point d'entrée public qui
 * divulgue les numéros enregistrés, un solde SMS débité deux fois ou jamais,
 * et un SMS « compte suspendu » envoyé à tort.
 */

const ORG = '22222222-2222-4222-8222-222222222222'
const ADMIN_ID = '44444444-4444-4444-8444-444444444444'
const T0 = new Date('2026-11-08T21:00:00Z')

const COMPTE: UserContact = {
  id: '55555555-5555-4555-8555-555555555555',
  organizationId: ORG,
  email: 'agent@client.ci',
  fullName: 'Agent Client',
  phone: '+2250161899990',
  status: 'active',
  locale: 'fr',
}

class HorlogeTest implements Clock {
  constructor(public t: Date) {}
  now() {
    return new Date(this.t)
  }
  avancer(secondes: number) {
    this.t = new Date(this.t.getTime() + secondes * 1000)
  }
}

/** Monde en mémoire : comptes, OTP, journal SMS, solde, passerelle. */
function monde(
  options: { comptes?: UserContact[]; solde?: number; passerelle?: SmsGatewayResult[] } = {}
) {
  const comptes = new Map((options.comptes ?? [COMPTE]).map((c) => [c.id, { ...c }]))
  const otps: OtpRecord[] = []
  const journal: (NewSmsNotification & { id: string; status: string; error?: string })[] = []
  const envoyes: { to: string; body: string }[] = []
  const emails: OutgoingEmail[] = []
  const evenements: DomainEvent[] = []
  const audit: string[] = []
  const motsDePasse = new Map<string, string>()
  const sessionsRevoquees: string[] = []
  const reponses = [...(options.passerelle ?? [])]
  let solde = options.solde ?? 100
  let totalEnvoye = 0
  let sequence = 0

  const clock = new HorlogeTest(T0)
  const ids: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  }
  const uow: UnitOfWork = {
    async run(handler) {
      const scope: TransactionScope = { raw: null, collect: (e) => evenements.push(...e) }
      return handler(scope)
    },
  }
  const auditLogger: AuditLogger = {
    async record(e) {
      audit.push(e.action)
    },
  }

  const users: UserContactReader & UserAccountWriter = {
    async findContactById(id) {
      return comptes.get(id) ?? null
    },
    async findActiveByEmail(email) {
      return (
        [...comptes.values()].find(
          (c) => c.email.toLowerCase() === email.toLowerCase() && c.status === 'active'
        ) ?? null
      )
    },
    async findActiveByPhone(phone) {
      return [...comptes.values()].find((c) => c.phone === phone && c.status === 'active') ?? null
    },
    async setStatus(id, status) {
      comptes.get(id)!.status = status
    },
    async updatePassword(id, hash) {
      motsDePasse.set(id, hash)
    },
    async revokeAllTokens(id) {
      sessionsRevoquees.push(id)
    },
  }

  const actifs = (userId: string) =>
    otps.filter((o) => o.userId === userId && !o.consumedAt && !o.invalidatedAt)

  const otpRepo: OtpRepository = {
    async issuanceStats(userId, _p, since) {
      const recents = otps.filter((o) => o.userId === userId && o.createdAt >= since)
      const dernier = recents.map((o) => o.createdAt.getTime()).sort((a, b) => b - a)[0]
      return { lastIssuedAt: dernier ? new Date(dernier) : null, issuedLastHour: recents.length }
    },
    async invalidateActive(userId, _p, at) {
      for (const o of actifs(userId)) o.invalidatedAt = at
    },
    async insert(otp: NewOtp) {
      if (actifs(otp.userId).length > 0) return false
      otps.push({ ...otp, attempts: 0, consumedAt: null, invalidatedAt: null })
      return true
    },
    async findActiveForUpdate(userId) {
      return actifs(userId).at(-1) ?? null
    },
    async registerFailedAttempt(id, invalidateAt) {
      const o = otps.find((x) => x.id === id)!
      o.attempts++
      if (invalidateAt) o.invalidatedAt = invalidateAt
    },
    async consume(id, at) {
      otps.find((x) => x.id === id)!.consumedAt = at
    },
    async invalidate(id, at) {
      const o = otps.find((x) => x.id === id)!
      if (!o.consumedAt && !o.invalidatedAt) o.invalidatedAt = at
    },
    async attachNotification() {},
  }

  // Codes déterministes : « 123456 », puis « 223456 »…
  let tirage = 0
  const codes: OtpCodeService = {
    generate: () => `${++tirage}23456`.slice(0, 6),
    digest: (c) => `h(${c})`,
    matches: (c, d) => d === `h(${c})`,
  }

  const gateway: SmsGateway = {
    provider: 'test',
    async send(sms) {
      envoyes.push(sms)
      return (
        reponses.shift() ?? {
          ok: true,
          providerMessageId: `SM${envoyes.length}`,
          providerStatus: 'queued',
          segments: null,
        }
      )
    },
  }

  const journalRepo: NotificationJournal = {
    async reserve(entry) {
      const existe = entry.dedupKey ? journal.find((n) => n.dedupKey === entry.dedupKey) : undefined
      if (existe) {
        if (existe.status !== 'failed') return null
        existe.status = 'queued'
        return { notificationId: existe.id, retried: true }
      }
      const id = `notif-${journal.length + 1}`
      journal.push({ ...entry, id, status: 'queued' })
      return { notificationId: id, retried: false }
    },
    async markSent(id) {
      journal.find((n) => n.id === id)!.status = 'sent'
    },
    async markFailed(id, f) {
      const n = journal.find((x) => x.id === id)!
      n.status = 'failed'
      n.error = f.errorCode
    },
    async applyDeliveryStatus() {
      return true
    },
  }

  const ledger: SmsBalanceLedger = {
    async debit(n) {
      if (solde < n) return null
      solde -= n
      totalEnvoye += n
      return { balanceCredits: solde, lowBalanceThreshold: 10 }
    },
    async refund(n) {
      solde += n
      totalEnvoye -= n
    },
    async adjust(d) {
      solde = Math.max(solde - d, 0)
      totalEnvoye += d
    },
    async read() {
      return {
        provider: 'test',
        balanceCredits: solde,
        totalSent: totalEnvoye,
        lowBalanceThreshold: 10,
        lastTopupAt: null,
      }
    },
    async topUp(n) {
      solde += n
      return this.read()
    },
  }

  const hasher: PasswordHasher = { make: async (p) => `hash(${p})` }
  const sms = new SmsSender(uow, gateway, journalRepo, ledger, clock, { enforceBalance: true })
  const emailGateway: EmailGateway = {
    provider: 'test-mail',
    async send(e) {
      emails.push(e)
      return { ok: true, providerMessageId: `<m${emails.length}@brevo>` }
    },
  }
  const email = new EmailSender(emailGateway, journalRepo, clock)
  const notifier = new NotificationDispatcher(sms, email)
  const verifier = new OtpVerifier(otpRepo, codes, DEFAULT_OTP_POLICY)
  const config = { policy: DEFAULT_OTP_POLICY, brand: 'SISBM CORE' }

  return {
    clock,
    otps,
    journal,
    envoyes,
    emails,
    evenements,
    audit,
    motsDePasse,
    sessionsRevoquees,
    comptes,
    get solde() {
      return solde
    },
    recharger(n: number) {
      solde += n
    },
    get totalEnvoye() {
      return totalEnvoye
    },
    sms,
    demander: new RequestPasswordReset(
      uow,
      users,
      otpRepo,
      codes,
      notifier,
      clock,
      ids,
      auditLogger,
      config
    ),
    verifier: new VerifyPasswordResetCode(uow, users, verifier, clock),
    reinitialiser: new ResetPassword(
      uow,
      users,
      users,
      otpRepo,
      verifier,
      hasher,
      clock,
      auditLogger
    ),
    suspendre: new SuspendUserAccount(uow, users, users, auditLogger),
    notifications: new IdentityNotifications(users, notifier, { brand: 'SISBM CORE' }),
  }
}

const MDP = 'NouveauMotDePasse2026!'
const tel = (value: string): AccountIdentifier => ({ kind: 'phone', value })
const mel = (value: string): AccountIdentifier => ({ kind: 'email', value })

// ---------------------------------------------------------------- règles pures

test.group('SMS — segmentation et modèles', () => {
  test('GSM-7 : 160 caractères en un segment, 153 au-delà', ({ assert }) => {
    assert.deepEqual(segmentSms('a'.repeat(160)), { encoding: 'GSM-7', units: 160, segments: 1 })
    assert.equal(segmentSms('a'.repeat(161)).segments, 2)
    assert.equal(segmentSms('a'.repeat(306)).segments, 2)
    assert.equal(segmentSms('a'.repeat(307)).segments, 3)
  })

  test('un seul caractère hors GSM bascule en UCS-2 (70 caractères)', ({ assert }) => {
    assert.isTrue(isGsm7('créé, à, où, déjà'))
    assert.isFalse(isGsm7('fenêtre'))
    assert.isFalse(isGsm7('« guillemets »'))
    assert.deepEqual(segmentSms(`${'a'.repeat(70)}ê`), {
      encoding: 'UCS-2',
      units: 71,
      segments: 2,
    })
  })

  test("les caractères d'extension comptent double", ({ assert }) => {
    assert.equal(segmentSms('€'.repeat(80)).units, 160)
    assert.equal(segmentSms('€'.repeat(81)).segments, 2)
  })

  test('tous les modèles restent en GSM-7, en français comme en anglais', ({ assert }) => {
    for (const locale of ['fr', 'en']) {
      const modeles = [
        SmsTemplates.accountCreated({
          brand: 'SISBM CORE',
          fullName: 'Jean-Baptiste Kouassi Koffi',
          email: 'jean-baptiste.kouassi@transport-abidjan.ci',
          locale,
        }),
        SmsTemplates.accountSuspended({ brand: 'SISBM CORE', email: 'agent@client.ci', locale }),
        SmsTemplates.passwordResetCode({
          brand: 'SISBM CORE',
          code: '123456',
          ttlMinutes: 10,
          locale,
        }),
        SmsTemplates.passwordChanged({ brand: 'SISBM CORE', locale }),
      ]
      for (const m of modeles) {
        assert.isTrue(isGsm7(m.body), `${m.templateCode} (${locale}) hors GSM-7 : ${m.body}`)
        assert.isAtMost(segmentSms(m.body).segments, 2, m.templateCode)
      }
    }
  })

  test("le code OTP n'apparaît que dans le corps envoyé, jamais dans le journal", ({ assert }) => {
    const m = SmsTemplates.passwordResetCode({ brand: 'X', code: '804211', ttlMinutes: 10 })
    assert.include(m.body, '804211')
    assert.notInclude(m.journalBody, '804211')
    assert.include(m.journalBody, '******')
  })

  test('masquage des numéros', ({ assert }) => {
    assert.equal(maskPhone('+2250161899990'), '+225******9990')
  })
})

test.group('OTP — politique', () => {
  test('délai de renvoi, puis quota horaire', ({ assert }) => {
    const cfg = DEFAULT_OTP_POLICY
    assert.deepEqual(canIssue({ lastIssuedAt: null, issuedLastHour: 0 }, T0, cfg), {
      allowed: true,
    })
    const recent = canIssue(
      { lastIssuedAt: new Date(T0.getTime() - 20_000), issuedLastHour: 1 },
      T0,
      cfg
    )
    assert.deepEqual(recent, { allowed: false, reason: 'cooldown', retryAfterSeconds: 40 })
    const quota = canIssue(
      { lastIssuedAt: new Date(T0.getTime() - 120_000), issuedLastHour: 5 },
      T0,
      cfg
    )
    assert.isFalse(quota.allowed)
    if (!quota.allowed) assert.equal(quota.reason, 'hourly_quota')
  })

  test('utilisabilité : consommé > invalidé > épuisé > expiré', ({ assert }) => {
    const base = {
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(T0.getTime() + 600_000),
      consumedAt: null,
      invalidatedAt: null,
    }
    assert.equal(usability(base, T0), 'usable')
    assert.equal(usability({ ...base, attempts: 5 }, T0), 'exhausted')
    assert.equal(usability({ ...base, expiresAt: T0 }, T0), 'expired')
    assert.equal(usability({ ...base, consumedAt: T0, attempts: 5 }, T0), 'consumed')
  })

  test('codes HMAC : tirage à 6 chiffres, empreinte vérifiée à temps constant', ({ assert }) => {
    const svc = new HmacOtpCodeService('cle-de-test')
    const code = svc.generate(6)
    assert.match(code, /^\d{6}$/)
    const d = svc.digest(code)
    assert.notInclude(d, code)
    assert.isTrue(svc.matches(code, d))
    assert.isFalse(svc.matches(code === '000000' ? '000001' : '000000', d))
    // Une autre clé (APP_KEY changée) ne reconnaît pas l'empreinte.
    assert.isFalse(new HmacOtpCodeService('autre-cle').matches(code, d))
  })
})

test.group('Twilio — signature des webhooks', () => {
  test('signature valide, puis altérée', ({ assert }) => {
    const url = 'https://api.sisbm.ci/api/v1/webhooks/twilio/sms-status'
    const params = { MessageSid: 'SM' + 'a'.repeat(32), MessageStatus: 'delivered' }
    const sig = computeTwilioSignature('jeton', url, params)
    assert.isTrue(isValidTwilioSignature('jeton', url, params, sig))
    assert.isFalse(
      isValidTwilioSignature('jeton', url, { ...params, MessageStatus: 'failed' }, sig)
    )
    assert.isFalse(isValidTwilioSignature('autre', url, params, sig))
    assert.isFalse(isValidTwilioSignature('jeton', url, params, undefined))
  })
})

// ---------------------------------------------------------------- envoi

test.group('SMS — service d’envoi unique', () => {
  const requete = (dedupKey: string | null = 'k1') => ({
    organizationId: ORG,
    recipientUserId: COMPTE.id,
    to: COMPTE.phone!,
    body: 'Bonjour',
    templateCode: 'test',
    dedupKey,
  })

  test('envoi nominal : journal `sent`, un crédit débité', async ({ assert }) => {
    const m = monde({ solde: 10 })
    const r = await m.sms.send(requete())
    assert.equal(r.status, 'sent')
    assert.equal(m.solde, 9)
    assert.equal(m.totalEnvoye, 1)
    assert.equal(m.journal[0].status, 'sent')
  })

  test('solde insuffisant : rien ne part, journal `failed`, nouvel essai possible', async ({
    assert,
  }) => {
    const m = monde({ solde: 0 })
    const r = await m.sms.send(requete())
    assert.equal(r.status, 'failed')
    if (r.status === 'failed') {
      assert.equal(r.errorCode, 'E_SMS_INSUFFICIENT_BALANCE')
      assert.isTrue(r.retryable)
    }
    assert.lengthOf(m.envoyes, 0)
    assert.equal(m.journal[0].status, 'failed')
  })

  test("refus de l'opérateur : crédit rendu", async ({ assert }) => {
    const m = monde({
      solde: 10,
      passerelle: [
        { ok: false, errorCode: 'twilio:21211', errorMessage: 'invalid To', retryable: false },
      ],
    })
    const r = await m.sms.send(requete())
    assert.equal(r.status, 'failed')
    assert.equal(m.solde, 10)
    assert.equal(m.totalEnvoye, 0)
  })

  test("segments recomptés par l'opérateur : le solde est corrigé", async ({ assert }) => {
    const m = monde({
      solde: 10,
      passerelle: [{ ok: true, providerMessageId: 'SM1', providerStatus: 'queued', segments: 2 }],
    })
    await m.sms.send(requete())
    assert.equal(m.solde, 8)
  })

  test('même clé d’idempotence : un seul SMS', async ({ assert }) => {
    const m = monde()
    await m.sms.send(requete('evt-1'))
    const r = await m.sms.send(requete('evt-1'))
    assert.equal(r.status, 'duplicate')
    assert.lengthOf(m.envoyes, 1)
  })

  test('numéro hors E.164 : refusé avant tout débit', async ({ assert }) => {
    const m = monde()
    const r = await m.sms.send({ ...requete(), to: '0161899990' })
    assert.equal(r.status, 'failed')
    assert.equal(m.solde, 100)
    assert.lengthOf(m.journal, 0)
  })
})

// ---------------------------------------------------------------- mot de passe oublié

test.group('Mot de passe oublié — demande de code', () => {
  test('numéro inconnu : même réponse, aucun SMS', async ({ assert }) => {
    const m = monde()
    const r = await m.demander.execute({ identifier: tel('+2250700000000') })
    assert.isTrue(r.ok)
    if (r.ok) {
      assert.deepEqual(r.value, { channel: 'sms', expiresInSeconds: 600, resendAfterSeconds: 60 })
    }
    assert.lengthOf(m.envoyes, 0)
    assert.lengthOf(m.otps, 0)
  })

  test('compte suspendu : aucun SMS', async ({ assert }) => {
    const m = monde({ comptes: [{ ...COMPTE, status: 'suspended' }] })
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })
    assert.lengthOf(m.envoyes, 0)
  })

  test('compte actif : code haché en base, en clair dans le SMS seulement', async ({ assert }) => {
    const m = monde()
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })
    assert.lengthOf(m.otps, 1)
    assert.equal(m.otps[0].codeHash, 'h(123456)')
    assert.include(m.envoyes[0].body, '123456')
    assert.notInclude(m.journal[0].body, '123456')
    assert.equal(m.journal[0].dedupKey, `otp:${m.otps[0].id}`)
    assert.include(m.audit, 'identity.password_reset.requested')
  })

  test('renvoi trop rapide : refusé en silence ; après 60 s, l’ancien code est invalidé', async ({
    assert,
  }) => {
    const m = monde()
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })
    m.clock.avancer(30)
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })
    assert.lengthOf(m.envoyes, 1)
    assert.include(m.audit, 'identity.password_reset.throttled')

    m.clock.avancer(31)
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })
    assert.lengthOf(m.envoyes, 2)
    assert.isNotNull(m.otps[0].invalidatedAt)
    assert.isNull(m.otps[1].invalidatedAt)
  })

  test('SMS non parti : le code est invalidé aussitôt', async ({ assert }) => {
    const m = monde({ solde: 0 })
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })
    assert.isNotNull(m.otps[0].invalidatedAt)
  })
})

test.group('Mot de passe oublié — vérification et réinitialisation', () => {
  test('code faux : tentatives restantes, puis code invalidé au 5e échec', async ({ assert }) => {
    const m = monde()
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })

    for (let i = 4; i >= 1; i--) {
      const r = await m.verifier.execute({ identifier: tel(COMPTE.phone!), code: '000000' })
      assert.isFalse(r.ok)
      if (!r.ok) assert.deepEqual(r.error.toJSON().details, { remainingAttempts: i })
    }
    const dernier = await m.verifier.execute({ identifier: tel(COMPTE.phone!), code: '000000' })
    assert.isFalse(dernier.ok)
    if (!dernier.ok) assert.equal(dernier.error.code, 'E_OTP_ATTEMPTS_EXCEEDED')

    // Même le bon code ne passe plus.
    const bon = await m.verifier.execute({ identifier: tel(COMPTE.phone!), code: '123456' })
    assert.isFalse(bon.ok)
  })

  test('verify et reset partagent le même plafond', async ({ assert }) => {
    const m = monde()
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })
    for (let i = 0; i < 3; i++)
      await m.verifier.execute({ identifier: tel(COMPTE.phone!), code: '999999' })
    await m.reinitialiser.execute({
      identifier: tel(COMPTE.phone!),
      code: '999999',
      newPassword: MDP,
    })
    assert.equal(m.otps[0].attempts, 4)
  })

  test('verify ne consomme pas le code', async ({ assert }) => {
    const m = monde()
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })
    const r = await m.verifier.execute({ identifier: tel(COMPTE.phone!), code: '123456' })
    assert.isTrue(r.ok)
    assert.isNull(m.otps[0].consumedAt)
  })

  test('code expiré', async ({ assert }) => {
    const m = monde()
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })
    m.clock.avancer(601)
    const r = await m.reinitialiser.execute({
      identifier: tel(COMPTE.phone!),
      code: '123456',
      newPassword: MDP,
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_OTP_EXPIRED')
    assert.equal(m.motsDePasse.size, 0)
  })

  test('réinitialisation : mot de passe, sessions révoquées, code consommé, événement', async ({
    assert,
  }) => {
    const m = monde()
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })
    const r = await m.reinitialiser.execute({
      identifier: tel(COMPTE.phone!),
      code: '123456',
      newPassword: MDP,
    })
    assert.isTrue(r.ok)
    assert.equal(m.motsDePasse.get(COMPTE.id), `hash(${MDP})`)
    assert.deepEqual(m.sessionsRevoquees, [COMPTE.id])
    assert.isNotNull(m.otps[0].consumedAt)
    assert.deepEqual(
      m.evenements.map((e) => e.eventName),
      ['identity.user.password_reset']
    )
    assert.include(m.audit, 'identity.password_reset.completed')

    // Usage unique.
    const encore = await m.reinitialiser.execute({
      identifier: tel(COMPTE.phone!),
      code: '123456',
      newPassword: MDP,
    })
    assert.isFalse(encore.ok)
  })

  test('numéro inconnu : même erreur qu’un code faux', async ({ assert }) => {
    const m = monde()
    const r = await m.reinitialiser.execute({
      identifier: tel('+2250700000000'),
      code: '123456',
      newPassword: MDP,
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_OTP_INVALID')
  })
})

// ---------------------------------------------------------------- cycle de vie

test.group('Comptes — suspension et SMS du cycle de vie', () => {
  const contexte = { actorId: ADMIN_ID, actorType: 'user' as const, organizationId: ORG }

  test('suspension : statut, sessions, événement', async ({ assert }) => {
    const m = monde()
    const r = await m.suspendre.execute({ context: contexte, userId: COMPTE.id })
    assert.isTrue(r.ok)
    assert.equal(m.comptes.get(COMPTE.id)!.status, 'suspended')
    assert.deepEqual(m.sessionsRevoquees, [COMPTE.id])
    assert.deepEqual(
      m.evenements.map((e) => e.eventName),
      ['identity.user.suspended']
    )
  })

  test('déjà suspendu : aucun événement (pas de second SMS)', async ({ assert }) => {
    const m = monde({ comptes: [{ ...COMPTE, status: 'suspended' }] })
    const r = await m.suspendre.execute({ context: contexte, userId: COMPTE.id })
    assert.isTrue(r.ok)
    if (r.ok) assert.isFalse(r.value.changed)
    assert.lengthOf(m.evenements, 0)
  })

  test('auto-suspension refusée', async ({ assert }) => {
    const m = monde()
    const r = await m.suspendre.execute({
      context: { ...contexte, actorId: COMPTE.id },
      userId: COMPTE.id,
    })
    assert.isFalse(r.ok)
    if (!r.ok) assert.equal(r.error.code, 'E_SELF_SUSPEND')
  })

  const message = (topic: string, id = '42') => ({
    id,
    topic,
    aggregateId: COMPTE.id,
    payload: {},
    attempts: 1,
  })

  test('compte créé : SMS de bienvenue, jamais de mot de passe', async ({ assert }) => {
    const m = monde()
    const r = await m.notifications.handle(message('identity.user.created'))
    assert.deepEqual(r, { status: 'done' })
    assert.include(m.envoyes[0].body, COMPTE.fullName)
    assert.notMatch(m.envoyes[0].body, /mot de passe\s*:/i)
    assert.equal(m.journal[0].dedupKey, 'identity.user.created:42')
  })

  test('suspension annulée avant l’envoi : pas de SMS', async ({ assert }) => {
    const m = monde()
    await m.notifications.handle(message('identity.user.suspended'))
    assert.lengthOf(m.envoyes, 0)
  })

  test('message rejoué : un seul SMS', async ({ assert }) => {
    const m = monde()
    await m.notifications.handle(message('identity.user.created'))
    await m.notifications.handle(message('identity.user.created'))
    assert.lengthOf(m.envoyes, 1)
  })

  test('solde épuisé : nouvel essai demandé à l’outbox, puis succès après recharge', async ({
    assert,
  }) => {
    const m = monde({ solde: 0 })
    const r = await m.notifications.handle(message('identity.user.created'))
    assert.equal(r.status, 'retry')

    // Recharge, puis rejeu du même message : la ligne `failed` est reprise.
    m.recharger(5)
    const r2 = await m.notifications.handle(message('identity.user.created'))
    assert.deepEqual(r2, { status: 'done' })
    assert.lengthOf(m.envoyes, 1)
    assert.lengthOf(m.journal, 1)
    assert.equal(m.journal[0].status, 'sent')
  })

  test('compte sans téléphone : ignoré', async ({ assert }) => {
    const m = monde({ comptes: [{ ...COMPTE, phone: null }] })
    const r = await m.notifications.handle(message('identity.user.created'))
    assert.deepEqual(r, { status: 'done' })
    assert.lengthOf(m.envoyes, 0)
  })
})

// ---------------------------------------------------------------- e-mail (Brevo)

test.group('E-mail — règles et modèles', () => {
  test('adresse, masquage, échappement HTML', ({ assert }) => {
    assert.isTrue(isEmailAddress('agent@client.ci'))
    assert.isFalse(isEmailAddress('agent@client'))
    assert.equal(maskEmail('evans.katchi@sisbm.ci'), 'ev**********@sisbm.ci')
    assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;')
  })

  test('code OTP : présent dans HTML et texte, masqué dans le journal', ({ assert }) => {
    const m = EmailTemplates.passwordResetCode({
      brand: 'SISBM CORE',
      fullName: 'Agent Client',
      code: '804211',
      ttlMinutes: 10,
    })
    assert.include(m.html, '804211')
    assert.include(m.text, '804211')
    assert.notInclude(m.journalBody, '804211')
    assert.include(m.subject, 'SISBM CORE')
  })

  test('un nom piégé ne peut pas injecter de HTML', ({ assert }) => {
    const m = EmailTemplates.passwordChanged({
      brand: 'SISBM CORE',
      fullName: '<script>alert(1)</script>',
    })
    assert.notInclude(m.html, '<script>')
    assert.include(m.html, '&lt;script&gt;')
  })
})

test.group('Mot de passe oublié — choix du canal', () => {
  test('identifiant e-mail, canal par défaut : code par e-mail, aucun SMS ni crédit', async ({
    assert,
  }) => {
    const m = monde()
    const r = await m.demander.execute({ identifier: mel('AGENT@client.ci') })
    assert.isTrue(r.ok)
    if (r.ok) assert.equal(r.value.channel, 'email')
    assert.lengthOf(m.envoyes, 0)
    assert.lengthOf(m.emails, 1)
    assert.equal(m.emails[0].to, COMPTE.email)
    assert.include(m.emails[0].text, '123456')
    assert.equal(m.otps[0].channel, 'email')
    assert.equal(m.otps[0].recipient, COMPTE.email)
    assert.equal(m.journal[0].channel, 'email')
    assert.notInclude(m.journal[0].body, '123456')
    assert.equal(m.solde, 100)
  })

  test('identifiant e-mail, canal SMS : le code part au téléphone DU COMPTE', async ({
    assert,
  }) => {
    const m = monde()
    await m.demander.execute({ identifier: mel(COMPTE.email), channel: 'sms' })
    assert.lengthOf(m.emails, 0)
    assert.lengthOf(m.envoyes, 1)
    assert.equal(m.envoyes[0].to, COMPTE.phone)
  })

  test('canal SMS sur un compte sans téléphone : même réponse, rien ne part', async ({
    assert,
  }) => {
    const m = monde({ comptes: [{ ...COMPTE, phone: null }] })
    const r = await m.demander.execute({ identifier: mel(COMPTE.email), channel: 'sms' })
    assert.isTrue(r.ok)
    assert.lengthOf(m.envoyes, 0)
    assert.lengthOf(m.emails, 0)
    assert.include(m.audit, 'identity.password_reset.no_recipient')
  })

  test('changer de canal ne contourne pas le délai de renvoi', async ({ assert }) => {
    const m = monde()
    await m.demander.execute({ identifier: tel(COMPTE.phone!) })
    m.clock.avancer(10)
    await m.demander.execute({ identifier: mel(COMPTE.email), channel: 'email' })
    assert.lengthOf(m.envoyes, 1)
    assert.lengthOf(m.emails, 0)
  })

  test('code reçu par e-mail, réinitialisation par téléphone : même compte, accepté', async ({
    assert,
  }) => {
    const m = monde()
    await m.demander.execute({ identifier: mel(COMPTE.email) })
    const r = await m.reinitialiser.execute({
      identifier: tel(COMPTE.phone!),
      code: '123456',
      newPassword: MDP,
    })
    assert.isTrue(r.ok)
    const evt = m.evenements.find((e) => e.eventName === 'identity.user.password_reset')!
    assert.equal(evt.payload.method, 'otp_email')
  })

  test('alerte « mot de passe modifié » par le canal du code', async ({ assert }) => {
    const m = monde()
    const msg = (method: string, id: string) => ({
      id,
      topic: 'identity.user.password_reset',
      aggregateId: COMPTE.id,
      payload: { method },
      attempts: 1,
    })
    await m.notifications.handle(msg('otp_email', '1'))
    await m.notifications.handle(msg('otp_sms', '2'))
    assert.lengthOf(m.emails, 1)
    assert.include(m.emails[0].subject, 'mot de passe')
    assert.lengthOf(m.envoyes, 1)
  })
})
