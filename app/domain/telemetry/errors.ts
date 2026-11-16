import { DomainError } from '#domain/kernel'

//tracker inconnue dans la base de donnée(erreur contrainte base de donnée et not found)
export class UnknownDeviceError extends DomainError {
  readonly code = 'E_UNKNOWN_DEVICE'
  readonly httpStatus = 404
  constructor(ident: string) {
    super(
      'Aucun boîtier enregistré pour cet identifiant. La trame est conservée ' +
        "dans le journal d'ingestion et pourra être rejouée après enregistrement.",
      { ident }
    )
  }
}

//trame reçu par flespi est illisible
export class MalformedFrameError extends DomainError {
  readonly code = 'E_MALFORMED_FRAME'
  readonly httpStatus = 422
  constructor(detail: string, raw?: unknown) {
    super(`Trame illisible : ${detail}`, { detail, raw })
  }
}

//le tracker n'est pas assigné à un véhicule (contrainte base de donnée)
export class DeviceNotAssignedError extends DomainError {
  readonly code = 'E_DEVICE_NOT_ASSIGNED'
  readonly httpStatus = 409
  constructor(ident: string) {
    super(
      "Le boîtier n'est affecté à aucun véhicule. La position est historisée " +
        'sans rattachement véhicule.',
      { ident }
    )
  }
}
