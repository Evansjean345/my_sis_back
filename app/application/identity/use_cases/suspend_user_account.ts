import { Err, Ok, type Result } from '#domain/kernel'
import type { AuditLogger, ExecutionContext, UnitOfWork, UseCase } from '#application/ports'
import type { UserAccountWriter, UserContactReader } from '#application/identity/ports'
import { SelfSuspendError, UserAccountNotFoundError } from '#domain/identity/errors'
import { UserAccountSuspended } from '#domain/identity/events'

export interface SuspendUserAccountInput {
  context: ExecutionContext
  /** Compte DÉJÀ résolu dans le périmètre de l'acteur par la présentation. */
  userId: string
}

export interface SuspendUserAccountOutput {
  /** `false` : le compte était déjà suspendu — aucun événement, aucun SMS. */
  changed: boolean
}

/**
 * =========================================================================
 *  CAS D'USAGE — Suspendre un compte
 * =========================================================================
 *
 * Promu en cas d'usage (il était fait dans le contrôleur) pour une seule
 * raison : il émet désormais un événement, `identity.user.suspended`, qui
 * déclenche le SMS d'information. Statut, révocation des sessions et
 * événement sont écrits dans UNE transaction — jamais de SMS « compte
 * suspendu » pour une suspension annulée par un ROLLBACK.
 *
 * Le cloisonnement (client : sa propre organisation ; plateforme : toutes)
 * reste porté par la présentation, comme pour les autres routes `/users`.
 */
export class SuspendUserAccount implements UseCase<
  SuspendUserAccountInput,
  SuspendUserAccountOutput
> {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly users: UserContactReader,
    private readonly accounts: UserAccountWriter,
    private readonly audit: AuditLogger
  ) {}

  async execute(
    input: SuspendUserAccountInput
  ): Promise<Result<SuspendUserAccountOutput, SelfSuspendError | UserAccountNotFoundError>> {
    if (input.userId === input.context.actorId) return Err(new SelfSuspendError())

    const user = await this.users.findContactById(input.userId)
    if (!user) return Err(new UserAccountNotFoundError(input.userId))
    if (user.status === 'suspended') return Ok({ changed: false })

    await this.unitOfWork.run(async (tx) => {
      await this.accounts.setStatus(user.id, 'suspended', tx)
      // Suspendre sans révoquer les jetons laisserait le compte actif jusqu'à
      // leur expiration — sept jours.
      await this.accounts.revokeAllTokens(user.id, tx)
      tx.collect([
        new UserAccountSuspended(user.id, {
          organizationId: user.organizationId,
          previousStatus: user.status,
          suspendedBy: input.context.actorId,
        }),
      ])
    })

    await this.audit.record({
      context: { ...input.context, organizationId: user.organizationId },
      action: 'identity.user.suspended',
      resourceType: 'user',
      resourceId: user.id,
      before: { status: user.status },
      after: { status: 'suspended' },
      metadata: { actorOrganizationId: input.context.organizationId },
    })

    return Ok({ changed: true })
  }
}
