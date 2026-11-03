import { BaseDomainEvent } from '#domain/kernel'

/**
 * Événements de domaine du contexte Sécurité.
 *
 * Ils sont écrits dans `outbox_messages` DANS la transaction métier, puis
 * publiés par un worker après le commit. C'est ce qui garantit
 * « la commande existe <=> l'événement part », sans transaction distribuée
 * et sans appel réseau à l'intérieur d'un BEGIN/COMMIT.
 *
 * Leur nom est au passé : ce sont des faits établis, pas des intentions.
 */
//immobilisation demandé
export class ImmobilizationRequested extends BaseDomainEvent {
  constructor(aggregateId: string, payload: Record<string, unknown>) {
    super('security.immobilization.requested', aggregateId, payload)
  }
}

//commande ennvoyé à flepsi
export class CommandDispatched extends BaseDomainEvent {
  constructor(aggregateId: string, payload: Record<string, unknown>) {
    super('security.command.dispatched', aggregateId, payload)
  }
}

//commande reconnue
export class CommandAcknowledged extends BaseDomainEvent {
  constructor(aggregateId: string, payload: Record<string, unknown>) {
    super('security.command.acknowledged', aggregateId, payload)
  }
}

//commande ecouhée
export class CommandFailed extends BaseDomainEvent {
  constructor(aggregateId: string, payload: Record<string, unknown>) {
    super('security.command.failed', aggregateId, payload)
  }
}
