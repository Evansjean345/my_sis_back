import type { ApplicationService } from '@adonisjs/core/types'
import { LucidUnitOfWork } from '#infrastructure/persistence/unit_of_work'
import { LucidAuditLogger } from '#infrastructure/persistence/audit_logger'
import { SystemClock } from '#infrastructure/services/clock'
import { UuidGenerator } from '#infrastructure/services/id_generator'
import { LucidDeviceCommandRepository } from '#infrastructure/persistence/repositories/device_command_repository'
import { LucidVehicleStateReader } from '#infrastructure/persistence/readers/vehicle_state_reader'
import { RequestImmobilization } from '#application/security/use_cases/request_immobilization'
import { DispatchEngineCommand } from '#application/security/use_cases/dispatch_engine_command'
import { RequestEngineRestore } from '#application/security/use_cases/request_engine_restore'
import { LucidDeviceProviderReader } from '#infrastructure/persistence/readers/device_provider_reader'
import sisbmConfig from '#config/sisbm'
import { FlespiClient } from '#infrastructure/gateways/flespi/flespi_client'
import {
  HttpFlespiCommandGateway,
  FlespiDeviceCommandGateway,
} from '#infrastructure/gateways/flespi/flespi_command_gateway'
import { FlespiDeviceGateway } from '#infrastructure/gateways/flespi/flespi_device_gateway'
import { FlespiChannelGateway } from '#infrastructure/gateways/flespi/flespi_channel_gateway'
import { FlespiProtocolGateway } from '#infrastructure/gateways/flespi/flespi_protocol_gateway'
import { FlespiCommandTracker } from '#infrastructure/gateways/flespi/flespi_command_tracker'
import { FlespiProvisioning } from '#infrastructure/gateways/flespi/flespi_provisioning'
import {
  LucidPositionRepository,
  LucidVehicleLastPositionRepository,
  LucidIngestMessageRepository,
} from '#infrastructure/persistence/repositories/telemetry_repositories'
import { LucidTripRepository } from '#infrastructure/persistence/repositories/trip_repository'
import { CachedDeviceResolver } from '#infrastructure/persistence/readers/device_resolver'
import { TransmitBroadcaster } from '#infrastructure/realtime/transmit_broadcaster'
import {
  LucidOrganizationRepository,
  LucidRoleCatalog,
  LucidUserAccountRepository,
} from '#infrastructure/persistence/repositories/identity_repositories'
import { AdonisPasswordHasher } from '#infrastructure/services/password_hasher'
import { RoleAssignment } from '#application/identity/services/role_assignment'
import { CreateOrganization } from '#application/identity/use_cases/create_organization'
import { CreateOrganizationUser } from '#application/identity/use_cases/create_organization_user'
import {
  LucidDeviceGroupMembership,
  LucidDriverGroupMembership,
  LucidVehicleGroupMembership,
} from '#infrastructure/persistence/repositories/group_membership_repository'
import { LucidAuditLogReader } from '#infrastructure/persistence/readers/audit_log_reader'
import { CancelEngineCommand } from '#application/security/use_cases/cancel_engine_command'
import { EnforceUsageSchedules } from '#application/scheduling/use_cases/enforce_usage_schedules'
import { UseCaseEngineCommandIssuer } from '#application/scheduling/engine_command_issuer'
import { LucidUsageScheduleRepository } from '#infrastructure/persistence/repositories/usage_schedule_repository'
import {
  LucidEnforcementReader,
  LucidEnforcementStateStore,
} from '#infrastructure/persistence/readers/schedule_enforcement_reader'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { SuspendUserAccount } from '#application/identity/use_cases/suspend_user_account'
import { RequestPasswordReset } from '#application/identity/use_cases/request_password_reset'
import { VerifyPasswordResetCode } from '#application/identity/use_cases/verify_password_reset_code'
import { ResetPassword } from '#application/identity/use_cases/reset_password'
import { OtpVerifier } from '#application/identity/services/otp_verifier'
import { SmsSender } from '#application/notification/services/sms_sender'
import { IdentitySmsNotifications } from '#application/notification/handlers/identity_sms_notifications'
import type { SmsGateway } from '#application/notification/ports'
import { LucidOtpRepository } from '#infrastructure/persistence/repositories/otp_repository'
import {
  LucidNotificationJournal,
  LucidSmsBalanceLedger,
} from '#infrastructure/persistence/repositories/notification_repositories'
import { HmacOtpCodeService } from '#infrastructure/services/otp_code_service'
import { TwilioClient } from '#infrastructure/gateways/twilio/twilio_client'
import { TwilioSmsGateway } from '#infrastructure/gateways/twilio/twilio_sms_gateway'
import { TwilioAccountGateway } from '#infrastructure/gateways/twilio/twilio_account_gateway'
import { LogSmsGateway } from '#infrastructure/gateways/sms/log_sms_gateway'
import { OutboxDispatcher } from '#infrastructure/messaging/outbox_dispatcher'
import { hostname } from 'node:os'

/**
 * =========================================================================
 *  COMPOSITION ROOT
 * =========================================================================
 *
 * SEUL endroit du projet où les interfaces du domaine rencontrent leurs
 * implémentations concrètes. Partout ailleurs, le code dépend d'abstractions.
 *
 * Le câblage est EXPLICITE, pas auto-résolu. Les dépendances des cas d'usage
 * sont des interfaces TypeScript : elles n'existent pas au runtime, le
 * conteneur ne peut donc pas les déduire. C'est un avantage — la composition
 * complète du système se lit d'un seul coup d'oeil, ici.
 *
 * Pour brancher des doubles en test, on ne modifie que ce fichier.
 *
 * Vérification de la santé de l'architecture :
 *
 *     grep -rl "@adonisjs" app/modules/<ctx>/domain/       -> doit être vide
 *     grep -rl "@adonisjs" app/modules/<ctx>/application/  -> seulement `inject`
 */
export default class ContainerProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    const immo = sisbmConfig.immobilization
    const flespi = {
      token: sisbmConfig.flespi.token,
      baseUrl: sisbmConfig.flespi.baseUrl,
      timeoutMs: sisbmConfig.flespi.timeoutMs,
    }

    // ------------------------------------------------------------- Flespi
    // Un SEUL client HTTP partagé : même jeton, même politique de réessai.
    this.app.container.singleton(FlespiClient, () => new FlespiClient(flespi))
    this.app.container.singleton(FlespiChannelGateway, async (resolver) => {
      return new FlespiChannelGateway(await resolver.make(FlespiClient))
    })
    this.app.container.singleton(FlespiDeviceGateway, async (resolver) => {
      return new FlespiDeviceGateway(await resolver.make(FlespiClient))
    })
    // Singleton : son cache du catalogue protocoles n'a d'intérêt que partagé.
    this.app.container.singleton(FlespiProtocolGateway, async (resolver) => {
      return new FlespiProtocolGateway(await resolver.make(FlespiClient))
    })
    this.app.container.singleton(HttpFlespiCommandGateway, async (resolver) => {
      return new HttpFlespiCommandGateway(await resolver.make(FlespiClient))
    })
    this.app.container.singleton(FlespiCommandTracker, async (resolver) => {
      return new FlespiCommandTracker(await resolver.make(HttpFlespiCommandGateway))
    })
    this.app.container.singleton(FlespiProvisioning, async (resolver) => {
      return new FlespiProvisioning(
        await resolver.make(FlespiChannelGateway),
        await resolver.make(FlespiDeviceGateway),
        await resolver.make(FlespiProtocolGateway)
      )
    })
    // Adaptateur du port sécurité — prêt pour le branchement de l'immobilisation (Jalon 3).
    this.app.container.singleton(FlespiDeviceCommandGateway, async (resolver) => {
      return new FlespiDeviceCommandGateway(
        await resolver.make(HttpFlespiCommandGateway),
        immo.commandTtlMinutes * 60
      )
    })

    // ------------------------------------------------------------- télémétrie
    // Le résolveur est un SINGLETON : son cache mémoire n'a d'intérêt que
    // partagé entre toutes les trames du processus.
    this.app.container.singleton(CachedDeviceResolver, () => new CachedDeviceResolver())
    this.app.container.singleton(LucidPositionRepository, () => new LucidPositionRepository())
    this.app.container.singleton(LucidTripRepository, () => new LucidTripRepository())
    this.app.container.singleton(
      LucidIngestMessageRepository,
      () => new LucidIngestMessageRepository()
    )
    this.app.container.singleton(
      LucidVehicleLastPositionRepository,
      () => new LucidVehicleLastPositionRepository()
    )
    this.app.container.singleton(TransmitBroadcaster, () => new TransmitBroadcaster())

    // ------------------------------------------------------------- sécurité
    this.app.container.singleton(RequestImmobilization, () => {
      return new RequestImmobilization(
        new LucidUnitOfWork(),
        new LucidDeviceCommandRepository(),
        new LucidVehicleStateReader(),
        new SystemClock(),
        new UuidGenerator(),
        new LucidAuditLogger(),
        {
          safetySpeedKph: immo.safetySpeedKph,
          commandTtlMinutes: immo.commandTtlMinutes,
          //à supprimer
          maxPositionAgeSeconds: immo.maxPositionAgeSeconds,
        }
      )
    })

    /**
     * Émission réelle vers le boîtier. Le garde-fou `immo.enabled`
     * (IMMOBILIZATION_ENABLED) est porté par le cas d'usage : tant qu'il est
     * à `false`, aucune coupure ne part, quel que soit l'appelant.
     */
    this.app.container.singleton(DispatchEngineCommand, async (resolver) => {
      return new DispatchEngineCommand(
        new LucidUnitOfWork(),
        new LucidDeviceCommandRepository(),
        new LucidVehicleStateReader(),
        new LucidDeviceProviderReader(),
        await resolver.make(FlespiDeviceCommandGateway),
        new SystemClock(),
        new LucidAuditLogger(),
        {
          enabled: immo.enabled,
          // à supprimer
          maxPositionAgeSeconds: immo.maxPositionAgeSeconds,
        }
      )
    })

    this.app.container.singleton(RequestEngineRestore, () => {
      return new RequestEngineRestore(
        new LucidUnitOfWork(),
        new LucidDeviceCommandRepository(),
        new LucidVehicleStateReader(),
        new SystemClock(),
        new UuidGenerator(),
        new LucidAuditLogger(),
        {
          safetySpeedKph: immo.safetySpeedKph,
          commandTtlMinutes: immo.commandTtlMinutes,
        }
      )
    })

    this.app.container.singleton(CancelEngineCommand, () => {
      return new CancelEngineCommand(
        new LucidUnitOfWork(),
        new LucidDeviceCommandRepository(),
        new SystemClock(),
        new LucidAuditLogger()
      )
    })

    // ------------------------------------------------------------- immobilisation planifiée
    this.registerScheduling()

    // ------------------------------------------------------------- notification (SMS)
    this.registerNotification()

    // ------------------------------------------------------------- identité
    this.registerIdentity()

    // ------------------------------------------------------------- outbox
    this.registerOutbox()

    // ------------------------------------------------------------- groupes et audit
    // Adaptateurs sans état : un singleton suffit, et le conteneur peut les
    // injecter directement dans les contrôleurs (@inject).
    this.app.container.singleton(
      LucidVehicleGroupMembership,
      () => new LucidVehicleGroupMembership()
    )
    this.app.container.singleton(LucidDeviceGroupMembership, () => new LucidDeviceGroupMembership())
    this.app.container.singleton(LucidDriverGroupMembership, () => new LucidDriverGroupMembership())
    this.app.container.singleton(LucidAuditLogger, () => new LucidAuditLogger())
    this.app.container.singleton(LucidAuditLogReader, () => new LucidAuditLogReader())
  }

  /**
   * Immobilisation planifiée — calendriers d'utilisation appliqués au moteur.
   *
   * Le moteur n'a AUCUN accès direct à la passerelle : il émet par
   * `UseCaseEngineCommandIssuer`, c'est-à-dire par les cas d'usage de
   * l'opérateur, avec tous leurs garde-fous (CM-07, CM-09, relais,
   * IMMOBILIZATION_ENABLED). Le suivi flespi (`FlespiCommandTracker`) sert de
   * réconciliateur avant chaque passage.
   */
  private registerScheduling() {
    const planif = sisbmConfig.schedules

    this.app.container.singleton(
      LucidUsageScheduleRepository,
      () => new LucidUsageScheduleRepository()
    )
    this.app.container.singleton(LucidEnforcementReader, () => new LucidEnforcementReader())

    this.app.container.singleton(EnforceUsageSchedules, async (resolver) => {
      const issuer = new UseCaseEngineCommandIssuer(
        await resolver.make(RequestImmobilization),
        await resolver.make(RequestEngineRestore),
        await resolver.make(DispatchEngineCommand),
        await resolver.make(CancelEngineCommand)
      )
      return new EnforceUsageSchedules(
        await resolver.make(LucidEnforcementReader),
        new LucidEnforcementStateStore(),
        issuer,
        await resolver.make(FlespiCommandTracker),
        new SystemClock(),
        new LucidAuditLogger(),
        {
          retryIntervalSeconds: planif.retryIntervalSeconds,
          backoffSeconds: planif.backoffSeconds,
        },
        (err: any, vehicleId: any) =>
          logger.error(
            { err, vehicleId },
            '[schedules] erreur pendant l’application d’un calendrier'
          )
      )
    })
  }

  /**
   * Notification — SMS (Twilio).
   *
   * UN SEUL `SmsSender` pour toute la plateforme : il tient le solde global
   * et le journal. La passerelle est choisie par `SMS_PROVIDER` : `twilio`,
   * ou `log` en développement (aucun envoi, SMS dans la console).
   */
  private registerNotification() {
    const tw = sisbmConfig.twilio
    const sms = sisbmConfig.sms

    this.app.container.singleton(
      TwilioClient,
      () =>
        new TwilioClient({
          accountSid: tw.accountSid,
          apiKeySid: tw.apiKeySid,
          apiKeySecret: tw.apiKeySecret,
          authToken: tw.authToken,
          baseUrl: tw.baseUrl,
          timeoutMs: tw.timeoutMs,
        })
    )
    this.app.container.singleton(TwilioAccountGateway, async (resolver) => {
      return new TwilioAccountGateway(await resolver.make(TwilioClient))
    })
    this.app.container.singleton(LucidSmsBalanceLedger, () => new LucidSmsBalanceLedger())
    this.app.container.singleton(LucidNotificationJournal, () => new LucidNotificationJournal())

    this.app.container.singleton(SmsSender, async (resolver) => {
      const gateway: SmsGateway =
        sms.provider === 'twilio'
          ? new TwilioSmsGateway(await resolver.make(TwilioClient), {
              from: tw.from,
              messagingServiceSid: tw.messagingServiceSid,
              statusCallbackUrl: tw.statusCallbackUrl,
            })
          : new LogSmsGateway(this.app.inProduction)
      if (sms.provider !== 'twilio' && this.app.inProduction) {
        logger.error('[sms] SMS_PROVIDER=log en production : aucun SMS ne partira')
      }
      return new SmsSender(
        new LucidUnitOfWork(),
        gateway,
        await resolver.make(LucidNotificationJournal),
        await resolver.make(LucidSmsBalanceLedger),
        new SystemClock(),
        { enforceBalance: sms.enforceBalance },
        (message, meta) => logger.warn(meta, message)
      )
    })
  }

  /** Outbox — handlers enregistrés auprès de `node ace sisbm:outbox:dispatch`. */
  private registerOutbox() {
    const cfg = sisbmConfig.outbox
    this.app.container.singleton(IdentitySmsNotifications, async (resolver) => {
      return new IdentitySmsNotifications(
        new LucidUserAccountRepository(),
        await resolver.make(SmsSender),
        { brand: sisbmConfig.sms.brand }
      )
    })
    this.app.container.singleton(OutboxDispatcher, async (resolver) => {
      return new OutboxDispatcher(
        [await resolver.make(IdentitySmsNotifications)],
        {
          batchSize: cfg.batchSize,
          maxAttempts: cfg.maxAttempts,
          retryBaseSeconds: cfg.retryBaseSeconds,
          staleLockSeconds: cfg.staleLockSeconds,
        },
        `${hostname()}:${process.pid}`,
        (level, message, meta) => logger[level](meta, message)
      )
    })
  }

  /**
   * Identité — création d'organisations et de comptes rattachés.
   * Appelé depuis `register()`.
   */
  private registerIdentity() {
    // Adaptateurs sans état : une instance partagée suffit.
    const organizations = new LucidOrganizationRepository()
    const users = new LucidUserAccountRepository()
    const roles = new LucidRoleCatalog()

    this.app.container.singleton(RoleAssignment, () => new RoleAssignment(roles))

    this.app.container.singleton(CreateOrganizationUser, async (resolver) => {
      return new CreateOrganizationUser(
        new LucidUnitOfWork(),
        organizations,
        users,
        await resolver.make(RoleAssignment),
        new AdonisPasswordHasher(),
        new UuidGenerator(),
        new LucidAuditLogger()
      )
    })

    // ---- cycle de vie : suspension (événement → SMS par l'outbox)
    this.app.container.singleton(SuspendUserAccount, () => {
      return new SuspendUserAccount(new LucidUnitOfWork(), users, users, new LucidAuditLogger())
    })

    // ---- mot de passe oublié : OTP par SMS
    const otp = sisbmConfig.otp
    const otps = new LucidOtpRepository()
    const verifier = new OtpVerifier(otps, new HmacOtpCodeService(env.get('APP_KEY')), otp)

    this.app.container.singleton(RequestPasswordReset, async (resolver) => {
      return new RequestPasswordReset(
        new LucidUnitOfWork(),
        users,
        otps,
        new HmacOtpCodeService(env.get('APP_KEY')),
        await resolver.make(SmsSender),
        new SystemClock(),
        new UuidGenerator(),
        new LucidAuditLogger(),
        { policy: otp, brand: sisbmConfig.sms.brand }
      )
    })
    this.app.container.singleton(VerifyPasswordResetCode, () => {
      return new VerifyPasswordResetCode(new LucidUnitOfWork(), users, verifier, new SystemClock())
    })
    this.app.container.singleton(ResetPassword, () => {
      return new ResetPassword(
        new LucidUnitOfWork(),
        users,
        users,
        otps,
        verifier,
        new AdonisPasswordHasher(),
        new SystemClock(),
        new LucidAuditLogger()
      )
    })

    this.app.container.singleton(CreateOrganization, async (resolver) => {
      return new CreateOrganization(
        new LucidUnitOfWork(),
        organizations,
        users,
        roles,
        await resolver.make(RoleAssignment),
        new AdonisPasswordHasher(),
        new UuidGenerator(),
        new LucidAuditLogger()
      )
    })
  }

  async boot() {}
  async start() {}
  async ready() {}
  async shutdown() {}
}
