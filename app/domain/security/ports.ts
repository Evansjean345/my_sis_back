import type { Speed } from '#domain/security/value_objects'

/**
 * Ports applicatifs du contexte Sécurité.
 *
 * `VehicleStateReader` est un port de LECTURE vers un autre bounded context
 * (Télémétrie). On ne traverse pas les frontières en important son agrégat :
 * on déclare le strict minimum dont on a besoin. Le jour où la télémétrie
 * devient un service séparé, seule l'implémentation change.
 */
//etet de securité du véhicule
export interface VehicleSafetyState {
  vehicleId: string
  deviceId: string | null
  speed: Speed
  ignition: boolean | null
  recordedAt: Date
  immobilizationEnabled: boolean
  deviceHasRelay: boolean
}

//Lecture du dernier etat connu du vehicule
export interface VehicleStateReader {
  /** Dernier état connu du véhicule. `null` si aucune position n'a été reçue. */
  readSafetyState(vehicleId: string): Promise<VehicleSafetyState | null>
}

/**
 * Rattachement d'un boîtier au fournisseur télématique.
 *
 * Le contexte Sécurité n'a pas à connaître la table `devices` : il lui faut
 * seulement l'identifiant que la passerelle comprend.
 */
//identifiant du provider (flespi_device_id) pour la table device
export interface ProviderDevice {
  deviceId: string
  /** `flespi_device_id`, ou `null` si le boîtier n'est pas rattaché. */
  externalDeviceId: string | null
  hasRelay: boolean
}

//lecture du tracker par le fournisseur
export interface DeviceProviderReader {
  readProviderDevice(deviceId: string): Promise<ProviderDevice | null>
}

/** Sortie vers la passerelle télématique (Flespi en Phase 1). */
//interface et contrat pour coupure moteur et restoration envoyés à la passerelle flespi
export interface DeviceCommandGateway {
  //coupure
  sendEngineCut(input: {
    deviceId: string
    externalDeviceId: string | null
    commandId: string
  }): Promise<{ providerCommandId: string }>

  //restoration
  sendEngineRestore(input: {
    deviceId: string
    externalDeviceId: string | null
    commandId: string
  }): Promise<{ providerCommandId: string }>
}
