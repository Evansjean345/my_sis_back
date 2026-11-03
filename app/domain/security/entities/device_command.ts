//domain
import { AggregateRoot, Ok, Err, type Result } from '#domain/kernel'
//objets de sécurité
import {
  type ActorId,
  type CommandId,
  type DeviceId,
  type Reason,
  type Speed,
  type VehicleId,
  ALLOWED_TRANSITIONS,
  type CommandOrigin,
  type CommandStatus,
  type CommandType,
} from '#domain/security/value_objects'
//erreur
import {
  CommandExpiredError,
  InvalidTransitionError,
  UnsafeSpeedError,
  VehicleInMotionError,
} from '#domain/security/errors'
//evenements
import {
  ImmobilizationRequested,
  CommandDispatched,
  CommandAcknowledged,
  CommandFailed,
} from '#domain/security/events'

//propriété des commandes du tracker
interface DeviceCommandProps {
  organizationId: string
  deviceId: DeviceId
  vehicleId: VehicleId | null
  commandType: CommandType
  status: CommandStatus
  reason: Reason
  origin: CommandOrigin
  /** Auteur de la demande : seule trace de QUI a coupé le moteur (audit). */
  requestedBy: ActorId | null
  requestedAt: Date
  safetySpeedLimit: Speed
  speedAtRequest: Speed | null
  ignitionAtRequest: boolean | null
  queuedAt: Date | null
  sentAt: Date | null
  acknowledgedAt: Date | null
  failedAt: Date | null
  errorMessage: string | null
  providerCommandId: string | null
  attempts: number
  expiresAt: Date
  policyId: string | null
  alertId: string | null
}

/**
 * =========================================================================
 *  AGRÉGAT DeviceCommand
 * =========================================================================
 *
 * Toutes les règles de sécurité de l'immobilisation vivent ICI, et nulle part
 * ailleurs. Un contrôleur HTTP, un worker de file ou le moteur de politiques
 * passent tous par ces méthodes : il n'existe aucun chemin qui contourne les
 * invariants.
 *
 * La base de données pose les mêmes garde-fous en `CHECK` (migration 9). Ce
 * n'est pas une redondance inutile : le domaine produit des messages
 * exploitables par l'utilisateur, la base garantit qu'aucun bug — ni aucun
 * script exécuté à la main — ne peut écrire un état interdit.
 *
 * Invariants portés :
 *   CM-07  aucune coupure moteur au-dessus du seuil de vitesse
 *   CM-08  motif obligatoire et substantiel
 *   —      machine à états stricte
 *   —      expiration : au-delà du TTL, la vitesse doit être revérifiée
 */
export class DeviceCommand extends AggregateRoot<CommandId> {
  private constructor(
    id: CommandId,
    private props: DeviceCommandProps
  ) {
    super(id)
  }

  // -------------------------------------------------------------- création

  /**
   * Demande d'immobilisation.
   *
   * La vitesse est contrôlée DÈS la demande, et non au moment de l'envoi.
   * Raison : une demande enregistrée alors que le véhicule roule constitue
   * déjà une trace ambiguë en audit. On refuse à la source.
   */
  static requestImmobilization(input: {
    id: CommandId
    organizationId: string
    deviceId: DeviceId
    vehicleId: VehicleId
    reason: Reason
    origin: CommandOrigin
    requestedBy: ActorId | null
    currentSpeed: Speed
    ignition: boolean | null
    safetySpeedLimit: Speed
    ttlMinutes: number //à definir le temps de traitement d'une commande
    now: Date
    policyId?: string | null
    alertId?: string | null
  }): Result<DeviceCommand> {
    // ---- CM-07 : garde-fou de vitesse, non contournable
    if (!input.currentSpeed.isAtOrBelow(input.safetySpeedLimit)) {
      return Err(new VehicleInMotionError(input.currentSpeed.kph, input.safetySpeedLimit.kph))
    }

    const command = new DeviceCommand(input.id, {
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      vehicleId: input.vehicleId,
      commandType: 'engine_cut', //commande pour couper le moteur
      status: 'approved',
      reason: input.reason,
      origin: input.origin,
      requestedBy: input.requestedBy,
      requestedAt: input.now,
      safetySpeedLimit: input.safetySpeedLimit,
      speedAtRequest: input.currentSpeed,
      ignitionAtRequest: input.ignition,
      queuedAt: null,
      sentAt: null,
      acknowledgedAt: null,
      failedAt: null,
      errorMessage: null,
      providerCommandId: null,
      attempts: 0,
      expiresAt: new Date(input.now.getTime() + input.ttlMinutes * 60_000),
      policyId: input.policyId ?? null,
      alertId: input.alertId ?? null,
    })

    //ajouté l'évènement aud domain
    command.addDomainEvent(
      new ImmobilizationRequested(command.id.value, {
        deviceId: input.deviceId.value,
        vehicleId: input.vehicleId.value,
        origin: input.origin,
        requestedBy: input.requestedBy?.value ?? null,
        speedAtRequestKph: input.currentSpeed.kph,
      })
    )

    return Ok(command)
  }

  /**
   * Rétablissement du moteur.
   *
   * Aucun garde-fou de vitesse : rendre l'alimentation à un véhicule est
   * toujours plus sûr que de la lui retirer.
   */
  static requestEngineRestore(input: {
    id: CommandId
    organizationId: string
    deviceId: DeviceId
    vehicleId: VehicleId | null
    reason: Reason
    origin: CommandOrigin
    requestedBy: ActorId | null
    safetySpeedLimit: Speed
    ttlMinutes: number
    now: Date
  }): Result<DeviceCommand> {
    const command = new DeviceCommand(input.id, {
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      vehicleId: input.vehicleId,
      commandType: 'engine_restore',
      status: 'approved',
      reason: input.reason,
      origin: input.origin,
      requestedBy: input.requestedBy,
      requestedAt: input.now,
      safetySpeedLimit: input.safetySpeedLimit,
      speedAtRequest: null,
      ignitionAtRequest: null,
      queuedAt: null,
      sentAt: null,
      acknowledgedAt: null,
      failedAt: null,
      errorMessage: null,
      providerCommandId: null,
      attempts: 0,
      expiresAt: new Date(input.now.getTime() + input.ttlMinutes * 60_000),
      policyId: null,
      alertId: null,
    })
    return Ok(command)
  }

  /** Reconstitution depuis la persistance — aucune règle rejouée. */
  static rehydrate(id: CommandId, props: DeviceCommandProps): DeviceCommand {
    return new DeviceCommand(id, props)
  }

  // -------------------------------------------------------------- exécution

  /**
   * Mise en file : dernier contrôle de vitesse avant transmission au tracker.
   *
   * Le garde-fou CM-07 ne s'applique qu'à la COUPURE. Refuser un
   * rétablissement parce que le véhicule roule laisserait un moteur coupé
   * sur un véhicule lancé : l'inverse du but recherché.
   */
  //gestion de la mise en cache d'une comamnde sur un véhicule
  queue(input: { currentSpeed: Speed | null; now: Date }): Result<void> {
    const transition = this.ensureTransition('queued', input.now)
    if (!transition.ok) return transition

    //vitesse non reçu et inconnue
    if (this.props.commandType === 'engine_cut') {
      if (!input.currentSpeed) {
        return Err(new UnsafeSpeedError('Vitesse inconnue : coupure moteur refusée'))
      }
      //vitesse non autorisé pour coupure du moteur <= 5 km/h
      if (!input.currentSpeed.isAtOrBelow(this.props.safetySpeedLimit)) {
        return Err(
          new VehicleInMotionError(input.currentSpeed.kph, this.props.safetySpeedLimit.kph)
        )
      }
      this.props.speedAtRequest = input.currentSpeed
    }

    this.props.status = 'queued'
    this.props.queuedAt = input.now
    return Ok(undefined)
  }

  //Commande marqué comme envoyée
  markSent(input: { providerCommandId: string; now: Date }): Result<void> {
    const transition = this.ensureTransition('sent', input.now, { ignoreExpiry: true })
    if (!transition.ok) return transition

    this.props.status = 'sent'
    this.props.sentAt = input.now
    this.props.providerCommandId = input.providerCommandId
    this.props.attempts += 1

    this.addDomainEvent(
      new CommandDispatched(this.id.value, {
        deviceId: this.props.deviceId.value,
        providerCommandId: input.providerCommandId,
      })
    )
    return Ok(undefined)
  }

  //commande marqué comme distribuée et envoyée à flespi
  markAcknowledged(now: Date): Result<void> {
    const transition = this.ensureTransition('acknowledged', now, { ignoreExpiry: true })
    if (!transition.ok) return transition

    this.props.status = 'acknowledged'
    this.props.acknowledgedAt = now

    this.addDomainEvent(
      new CommandAcknowledged(this.id.value, {
        deviceId: this.props.deviceId.value,
        vehicleId: this.props.vehicleId?.value ?? null,
        commandType: this.props.commandType,
      })
    )
    return Ok(undefined)
  }

  //commande maqrué comme echouée
  markFailed(input: { errorMessage: string; now: Date }): Result<void> {
    const transition = this.ensureTransition('failed', input.now, { ignoreExpiry: true })
    if (!transition.ok) return transition

    this.props.status = 'failed'
    this.props.failedAt = input.now
    this.props.errorMessage = input.errorMessage

    this.addDomainEvent(
      new CommandFailed(this.id.value, {
        deviceId: this.props.deviceId.value,
        errorMessage: input.errorMessage,
        attempts: this.props.attempts,
      })
    )
    return Ok(undefined)
  }

  //commande marqué comme annulé
  cancel(input: { cancelledBy: ActorId | null; now: Date }): Result<void> {
    const transition = this.ensureTransition('cancelled', input.now, { ignoreExpiry: true })
    if (!transition.ok) return transition
    this.props.status = 'cancelled'
    return Ok(undefined)
  }

  //commande marqué comme expirée gestion du TTL
  expire(now: Date): Result<void> {
    const transition = this.ensureTransition('expired', now, { ignoreExpiry: true })
    if (!transition.ok) return transition
    this.props.status = 'expired'
    return Ok(undefined)
  }

  // -------------------------------------------------------------- invariants

  //assurer la transition / changement de l'etat de d'une commande
  private ensureTransition(
    target: CommandStatus,
    now: Date,
    options: { ignoreExpiry?: boolean } = {}
  ): Result<void> {
    if (!ALLOWED_TRANSITIONS[this.props.status].includes(target)) {
      return Err(new InvalidTransitionError(this.props.status, target))
    }
    if (!options.ignoreExpiry && this.isExpired(now)) {
      return Err(new CommandExpiredError(this.props.expiresAt))
    }
    return Ok(undefined)
  }

  //expiration de l'etat du commande
  isExpired(now: Date): boolean {
    return now.getTime() > this.props.expiresAt.getTime()
  }

  // -------------------------------------------------------------- lecture

  //retrouver le statut d'une commande
  get status(): CommandStatus {
    return this.props.status
  }
  //l'id du tracker
  get deviceId(): DeviceId {
    return this.props.deviceId
  }
  //l'id du véhicule
  get vehicleId(): VehicleId | null {
    return this.props.vehicleId
  }
  //le type de commande / nom système
  get commandType(): CommandType {
    return this.props.commandType
  }
  //commande demandé par quel user
  get requestedBy(): ActorId | null {
    return this.props.requestedBy
  }
  //la commande expire quand ?
  get expiresAt(): Date {
    return this.props.expiresAt
  }

  /** Projection destinée à la persistance et à la sérialisation HTTP. */
  //capturation de l'etat de la commande
  snapshot() {
    return {
      id: this.id.value,
      organizationId: this.props.organizationId,
      deviceId: this.props.deviceId.value,
      vehicleId: this.props.vehicleId?.value ?? null,
      commandType: this.props.commandType,
      status: this.props.status,
      reason: this.props.reason.text,
      origin: this.props.origin,
      requestedBy: this.props.requestedBy?.value ?? null,
      requestedAt: this.props.requestedAt,
      safetySpeedLimitKph: this.props.safetySpeedLimit.kph,
      speedAtRequestKph: this.props.speedAtRequest?.kph ?? null,
      ignitionAtRequest: this.props.ignitionAtRequest,
      queuedAt: this.props.queuedAt,
      sentAt: this.props.sentAt,
      acknowledgedAt: this.props.acknowledgedAt,
      failedAt: this.props.failedAt,
      errorMessage: this.props.errorMessage,
      providerCommandId: this.props.providerCommandId,
      attempts: this.props.attempts,
      expiresAt: this.props.expiresAt,
      policyId: this.props.policyId,
      alertId: this.props.alertId,
    }
  }
}
