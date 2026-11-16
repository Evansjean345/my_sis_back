import { BaseDomainEvent } from '#domain/kernel'

/**
 * Événements du contexte Télémétrie.
 *
 * Écrits dans `outbox_messages` DANS la transaction d'ingestion, publiés après
 * le COMMIT. Ce sont eux qui alimenteront le moteur de règles (Jalon 3) et la
 * diffusion temps réel, sans que l'ingestion ait à les connaître.
 */

//entregistrement de la position
export class PositionRecorded extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.position.recorded', id, p)
  }
}

//enregistrement de la position rejetée
export class PositionRejected extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.position.rejected', id, p)
  }
}

//moteur allumé et contact avec le boitier ok
export class IgnitionTurnedOn extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.ignition.on', id, p)
  }
}

//moteur eteint et contact avec le boitier off
export class IgnitionTurnedOff extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.ignition.off', id, p)
  }
}

//demarrage du trajet
export class TripStarted extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.trip.started', id, p)
  }
}

//fermeture du trajet
export class TripClosed extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.trip.closed', id, p)
  }
}

//appareil silencieux à definir
export class DeviceWentSilent extends BaseDomainEvent {
  constructor(id: string, p: Record<string, unknown>) {
    super('telemetry.device.silent', id, p)
  }
}
