import type { ExecutionContext } from '#application/ports'
import type { EngineCommandIssuer, IssueOutcome } from '#application/scheduling/ports'
import type { RequestImmobilization } from '#application/security/use_cases/request_immobilization'
import type { RequestEngineRestore } from '#application/security/use_cases/request_engine_restore'
import type { DispatchEngineCommand } from '#application/security/use_cases/dispatch_engine_command'
import type { CancelEngineCommand } from '#application/security/use_cases/cancel_engine_command'
import type { EnforcementAction } from '#domain/scheduling/enforcement_policy'

/**
 * =========================================================================
 *  ÉMETTEUR DE COMMANDES MOTEUR — au nom du moteur de planification
 * =========================================================================
 *
 * Réutilise tel quel le chemin de l'opérateur :
 *
 *   RequestImmobilization / RequestEngineRestore   (motif, relais, CM-07, CM-09)
 *     → DispatchEngineCommand                       (2e contrôle de vitesse, interrupteur général)
 *
 * L'acteur est `system`, l'origine `schedule` : l'audit dit précisément
 * qu'aucun humain n'a appuyé sur le bouton, et le moteur saura plus tard
 * qu'il a le droit de rétablir ce véhicule.
 *
 * Si l'émission échoue AVANT l'envoi, la commande créée est annulée : une
 * commande `approved` orpheline bloquerait le boîtier (CM-09).
 */
export class UseCaseEngineCommandIssuer implements EngineCommandIssuer {
  constructor(
    private readonly immobilize: RequestImmobilization,
    private readonly restore: RequestEngineRestore,
    private readonly dispatch: DispatchEngineCommand,
    private readonly cancel: CancelEngineCommand
  ) {}

  async issue(input: {
    action: EnforcementAction
    vehicleId: string
    organizationId: string
    reason: string
  }): Promise<IssueOutcome> {
    const context: ExecutionContext = {
      actorId: null,
      actorType: 'system',
      organizationId: input.organizationId,
      requestId: `schedule-enforcer:${input.vehicleId}`,
    }

    const demande =
      input.action === 'cut'
        ? await this.immobilize.execute({
            context,
            vehicleId: input.vehicleId,
            reason: input.reason,
            origin: 'schedule',
          })
        : await this.restore.execute({
            context,
            vehicleId: input.vehicleId,
            reason: input.reason,
            origin: 'schedule',
          })

    if (!demande.ok) {
      return {
        commandId: null,
        status: null,
        errorCode: demande.error.code,
        errorMessage: demande.error.message,
      }
    }

    const commandId = demande.value.commandId
    const envoi = await this.dispatch.execute({ context, commandId })
    if (envoi.ok) {
      return {
        commandId,
        status: envoi.value.status,
        // `failed` : la passerelle a refusé ou n'a pas répondu (motif sur la commande).
        errorCode: envoi.value.status === 'failed' ? 'E_DISPATCH_FAILED' : null,
        errorMessage: null,
      }
    }

    // Échec avant l'envoi : on libère le boîtier.
    const annulation = await this.cancel.execute({
      context,
      commandId,
      note: `Émission impossible (${envoi.error.code}) : commande retirée par le moteur de planification`,
    })
    return {
      commandId,
      status: annulation.ok ? annulation.value.status : 'approved',
      errorCode: envoi.error.code,
      errorMessage: envoi.error.message,
    }
  }
}
