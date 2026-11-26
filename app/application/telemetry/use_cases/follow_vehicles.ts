import { Ok, type DomainError, type Result } from '#domain/kernel'
import type { UseCase } from '#application/ports'
import type { TripReader } from '#application/telemetry/ports'
import type { TripReadScope } from '#domain/telemetry/code_legacy/trip/trip_reading_types'
import { followCapacity } from '#domain/telemetry/trip_reading_policy'

export interface FollowVehiclesInput {
  scope: TripReadScope
  vehicleIds: string[]
  /** Véhicules déjà suivis par la connexion. */
  alreadyFollowed: number
}

export interface FollowVehiclesOutput {
  /** Véhicules à suivre : du périmètre, vivants, dans la limite de la connexion. */
  accepted: string[]
  /** Inconnus, supprimés, d'un autre client, ou au-delà de la limite. */
  rejected: string[]
}

/**
 * CAS D'USAGE — Suivre des véhicules en direct (trajet en cours, nouveaux points).
 *
 * Décide QUELS véhicules la connexion peut suivre ; l'abonnement lui-même
 * (salle Socket.IO) est fait par la présentation.
 */
export class FollowVehicles implements UseCase<FollowVehiclesInput, FollowVehiclesOutput> {
  constructor(private readonly reader: TripReader) {}

  async execute(input: FollowVehiclesInput): Promise<Result<FollowVehiclesOutput, DomainError>> {
    const demandes = [...new Set(input.vehicleIds)]
    const permis = new Set(await this.reader.vehiclesInScope(input.scope, demandes))
    const accepted = demandes
      .filter((id) => permis.has(id))
      .slice(0, followCapacity(input.alreadyFollowed))
    const retenus = new Set(accepted)
    return Ok({ accepted, rejected: demandes.filter((id) => !retenus.has(id)) })
  }
}
