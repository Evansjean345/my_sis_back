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
// Types, statuts et origines — source unique : `code_legacy/code_base`
// ---------------------------------------------------------------------------

export {
  ALLOWED_TRANSITIONS,
  COMMAND_ORIGINS,
  COMMAND_STATUSES,
  COMMAND_TYPES,
  EXPIRABLE_STATUSES,
  IN_FLIGHT_STATUSES,
} from '#domain/security/code_legacy/code_base'
export type {
  CommandOrigin,
  CommandStatus,
  CommandType,
} from '#domain/security/code_legacy/code_base'
