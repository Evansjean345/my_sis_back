import { inject } from '@adonisjs/core'
import { Err, Ok, NotFoundError, type DomainError, type Result } from '#domain/kernel'
import type { AuditLogger, Clock, ExecutionContext, UnitOfWork, UseCase } from '#application/ports'
import type { DeviceCommandRepository } from '#domain/security/repositories/device_command_repository'
import { ActorId, CommandId } from '#domain/security/value_objects'

export interface CancelEngineCommandInput {
  context: ExecutionContext
  commandId: string
  note: string
}

/**
 * =========================================================================
 *  CAS D'USAGE — Annuler une commande moteur qui n'a pas été émise
 * =========================================================================
 *
 * Une commande `approved` occupe le boîtier (CM-09) et AUCUN balayage ne la
 * fait expirer : si son émission échoue avant l'envoi (interrupteur général
 * coupé, boîtier non rattaché à flespi…), elle bloque toute commande
 * suivante sur ce boîtier, y compris un rétablissement.
 *
 * Le moteur d'immobilisation planifiée l'appelle dans ce cas précis : la
 * coupure qu'il vient de demander n'a pas pu partir, il la retire plutôt que
 * de condamner le boîtier. La machine à états de l'agrégat n'autorise
 * l'annulation qu'avant l'envoi (`approved`, `queued`).
 */
@inject()
export class CancelEngineCommand implements UseCase<CancelEngineCommandInput, { status: string }> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly commands: DeviceCommandRepository,
    private readonly clock: Clock,
    private readonly audit: AuditLogger
  ) {}

  async execute(input: CancelEngineCommandInput): Promise<Result<{ status: string }, DomainError>> {
    return this.unitOfWork.run(async (tx) => {
      const command = await this.commands.findById(CommandId.from(input.commandId), tx)
      if (!command) return Err(new NotFoundError('Commande', input.commandId))

      const avant = command.snapshot()
      const annule = command.cancel({
        cancelledBy: input.context.actorId ? ActorId.from(input.context.actorId) : null,
        now: this.clock.now(),
      })
      if (!annule.ok) return annule

      await this.commands.save(command, tx)
      tx.collect(command.pullDomainEvents())

      await this.audit.record({
        context: input.context,
        action: `security.${command.commandType}.cancelled`,
        resourceType: 'device_command',
        resourceId: command.id.value,
        before: { status: avant.status },
        after: { status: command.status },
        metadata: { note: input.note },
      })
      return Ok({ status: command.status })
    })
  }
}
