import { Identifier, ValueObject, type Result, Ok, Err } from '#domain/kernel'
import { UnsafeSpeedError, InvalidReasonError } from '#domain/security/errors'

// ---------------------------------------------------------------------------
// Identifiants typés
// ---------------------------------------------------------------------------

//Id de la commande
export class CommandId extends Identifier<'CommandId'> {
  static from(value: string): CommandId {
    return new CommandId(value)
  }
}

//Id du tracker
export class DeviceId extends Identifier<'DeviceId'> {
  static from(value: string): DeviceId {
    return new DeviceId(value)
  }
}

//Id du véhicule
export class VehicleId extends Identifier<'VehicleId'> {
  static from(value: string): VehicleId {
    return new VehicleId(value)
  }
}

//Id du user
export class ActorId extends Identifier<'ActorId'> {
  static from(value: string): ActorId {
    return new ActorId(value)
  }
}

// ---------------------------------------------------------------------------
// Vitesse
// ---------------------------------------------------------------------------

/**
 * Vitesse en km/h.
 *
 * L'unité est dans le type, pas seulement dans le nom de la variable.
 * C'est ce qui rend impossible de comparer par erreur des km/h à des m/s —
 * la classe d'erreur qui a détruit Mars Climate Orbiter.
 */
//Objet et classe Géreant la vitesse
export class Speed extends ValueObject<{ kph: number }> {
  private constructor(kph: number) {
    super({ kph })
  }

  static fromKph(kph: number): Result<Speed> {
    if (!Number.isFinite(kph) || kph < 0 || kph > 400) {
      return Err(new UnsafeSpeedError(`Vitesse hors domaine : ${kph} km/h`))
    }
    return Ok(new Speed(kph))
  }

  /** Utiliser uniquement sur des valeurs déjà validées (relecture depuis la base). */
  static trusted(kph: number): Speed {
    return new Speed(kph)
  }

  get kph(): number {
    return this.props.kph
  }

  isAtOrBelow(other: Speed): boolean {
    return this.props.kph <= other.props.kph
  }

  toString(): string {
    return `${this.props.kph} km/h`
  }
}

// ---------------------------------------------------------------------------
// Motif
// ---------------------------------------------------------------------------

/**
 * Motif d'une commande. Contrainte CM-08 : jamais vide, jamais un caractère
 * lâché pour passer la validation. Une coupure moteur sans motif traçable
 * est une pièce d'audit inutilisable.
 */
//Object pour le motif d'une commande et la limitation à 5
export class Reason extends ValueObject<{ text: string }> {
  static readonly MIN_LENGTH = 5

  private constructor(text: string) {
    super({ text })
  }

  static create(raw: string): Result<Reason> {
    const text = (raw ?? '').trim()
    if (text.length < Reason.MIN_LENGTH) {
      return Err(
        new InvalidReasonError(
          `Le motif doit contenir au moins ${Reason.MIN_LENGTH} caractères significatifs`
        )
      )
    }
    return Ok(new Reason(text))
  }

  static trusted(text: string): Reason {
    return new Reason(text)
  }

  get text(): string {
    return this.props.text
  }
}

// ---------------------------------------------------------------------------
// Types et statuts — alignés sur les CHECK de la migration 9
// ---------------------------------------------------------------------------

//Types de commandes nommées envoyées au tracker et indexation
export const COMMAND_TYPES = [
  'engine_cut',
  'engine_restore',
  'locate',
  'reboot',
  'set_interval',
  'custom',
] as const
export type CommandType = (typeof COMMAND_TYPES)[number] //indexation

//statutes de commandes ("à supprimer certaines vu que la doucble validation a été annulée")
export const COMMAND_STATUSES = [
  'pending_validation', //à supprimer double validation annulée
  'approved', //à supprimer double validation annulée
  'rejected', //à supprimer double validation annulée
  'queued',
  'sent',
  'acknowledged',
  'failed',
  'cancelled',
  'expired',
] as const
export type CommandStatus = (typeof COMMAND_STATUSES)[number] //indexation

//origin des commandes
export const COMMAND_ORIGINS = ['manual', 'policy', 'api'] as const
export type CommandOrigin = (typeof COMMAND_ORIGINS)[number]

/**
 * Machine à états. Déclarée une seule fois, en données, plutôt qu'éparpillée
 * dans des `if`. Toute transition non listée ici est refusée par l'agrégat.
 */
//lecture et transition pour indexation des commandes effectuées (supprimer les elements liés à la double validation)
export const ALLOWED_TRANSITIONS: Readonly<Record<CommandStatus, readonly CommandStatus[]>> = {
  pending_validation: ['approved', 'rejected', 'cancelled', 'expired'], //à supprimer double validation annulée
  approved: ['queued', 'cancelled', 'expired'], //à supprimer double validation annulée
  queued: ['sent', 'failed', 'cancelled', 'expired'], //à supprimer double validation annulée
  sent: ['acknowledged', 'failed'],
  acknowledged: [],
  rejected: [],
  failed: [],
  cancelled: [],
  expired: [],
} as const

/** Statuts pour lesquels la commande occupe encore le tracker (contrainte CM-09). */
//Commandes en cours sur le tracker (supprimer les elements liés à la double validation)
export const IN_FLIGHT_STATUSES: readonly CommandStatus[] = [
  'pending_validation', //à supprimer double validation annulée
  'approved', //à supprimer double validation annulée
  'queued',
  'sent',
]
