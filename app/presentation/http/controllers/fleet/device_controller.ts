import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import DeviceModel from '#infrastructure/persistence/models/device_model'
import sisbmConfig from '#config/sisbm'
import { FlespiApiError } from '#infrastructure/gateways/flespi/flespi_client'
import { FlespiDeviceGateway } from '#infrastructure/gateways/flespi/flespi_device_gateway'
import {
  FlespiProvisioning,
  type ProvisionResult,
} from '#infrastructure/gateways/flespi/flespi_provisioning'
import { FlespiProtocolGateway } from '#infrastructure/gateways/flespi/flespi_protocol_gateway'
import { FlespiChannelGateway } from '#infrastructure/gateways/flespi/flespi_channel_gateway'
import { CachedDeviceResolver } from '#infrastructure/persistence/readers/device_resolver'
import { LucidDeviceAssignments } from '#infrastructure/persistence/repositories/device_assignment_repository'
import {
  createDeviceValidator,
  updateDeviceValidator,
  assignDeviceValidator,
  listDevicesValidator,
  syncDeviceFlespiValidator,
  clientUpdateDeviceValidator,
} from '#presentation/http/validators/fleet/fleet_validators'
import { logQueryValidator } from '#presentation/http/validators/fleet/flespi_validators'
import { toFlespiSeconds } from '#presentation/http/support/flespi_time'
import { authorize } from '#presentation/http/support/authorize'
import { toExecutionContext } from '#presentation/http/support/execution_context'
import OrganizationModel from '#infrastructure/persistence/models/organization_model'
import {
  adminListDevicesValidator,
  adminOrganizationFilterValidator,
  targetOrganizationValidator,
} from '#presentation/http/validators/admin/admin_validators'
import {
  PLATFORM_SCOPE,
  applyScope,
  authorizePlatform,
  countsBy,
  organizationsOf,
  ownScope,
  serializeWithOrganizations,
  type TenantScope,
} from '#presentation/http/support/platform_scope'

/*
Fichier corriger pour la gestion des permissions pour un admin ou un client
correction des permissions pour les methodes du controller DeviceController
viewDevices et manageDevices pour un admin ou un client
ancinnement viewVehicles et manageVehicles pour un admin ou un client
supprimer certaines routes de creation de device pour le client des routes sont inutiles sur son tableau de bord
*/

/**
 * =========================================================================
 *  CRUD BOÎTIERS — avec synchronisation Flespi
 * =========================================================================
 *
 * Un boîtier existe à DEUX endroits : dans notre base et chez Flespi. Les deux
 * doivent rester alignés — un boîtier enregistré chez nous mais absent de
 * Flespi ne remontera jamais de position, et personne ne s'en apercevra avant
 * la première alerte manquée.
 *
 * L'ORDRE des opérations n'est pas indifférent :
 *   création    → Flespi d'abord, base ensuite  (si Flespi échoue, rien n'est créé)
 *   suppression → Flespi d'abord, base ensuite  (sinon device orphelin qui
 *                                                continue de facturer et de publier)
 *
 * Si l'écriture en base échoue APRÈS la création flespi, le device flespi est
 * supprimé (compensation) : on ne laisse pas d'orphelin.
 */
@inject()
export default class DeviceController {
  constructor(
    private readonly gateway: FlespiDeviceGateway,
    private readonly provisioning: FlespiProvisioning,
    private readonly channels: FlespiChannelGateway,
    private readonly catalogue: FlespiProtocolGateway,
    private readonly resolver: CachedDeviceResolver,
    private readonly assignments: LucidDeviceAssignments
  ) {}

  /**
   * Le cache ident → véhicule du worker d'ingestion doit être invalidé à
   * chaque montage/démontage/changement d'ident : sinon les positions sont
   * rattachées pendant 5 minutes à l'ancien véhicule.
   */
  /*
  methode permettant d'invalider le cache d'un boitier (ident) dans le cache mémoire et Redis
  */
  private async invalider(device: { imei: string; flespiIdent: string | null }): Promise<void> {
    const resolver = this.resolver
    await Promise.all(
      [device.imei, device.flespiIdent]
        .filter((i): i is string => Boolean(i))
        .map((i) => resolver.invalidate(i))
    )
  }

  /** GET /api/v1/devices */
  /*
  Affiche la liste des devices
  NB : correction de la permission pour lister les boitiers pour un admin ou un client
  */
  async index(ctx: HttpContext) {
    //await authorize(ctx, 'viewVehicles')
    //correction : autorisation de lister les boitiers pour un admin ou un client
    await authorize(ctx, 'viewDevices')
    const {
      page = 1,
      perPage = 25,
      status,
      search,
      unassigned,
    } = await ctx.request.validateUsing(listDevicesValidator)
    const org = toExecutionContext(ctx).organizationId

    const query = DeviceModel.query()
      .where('organization_id', org)
      .whereNull('deleted_at')
      .orderBy('imei')

    if (status) query.where('status', status)
    if (search) query.whereILike('imei', `%${search}%`)

    // Boîtiers en stock, non montés : la question la plus fréquente en
    // exploitation avant une installation.
    if (unassigned) {
      query.whereNotExists((sub) =>
        sub
          .from('device_assignments as da')
          .whereRaw('da.device_id = devices.id')
          .whereRaw('upper_inf(da.period)')
      )
    }

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    return ctx.response.ok(resultat.toJSON())
  }

  /**
   * GET /api/v1/devices/stats — trackers AFFECTÉS à l'organisation :
   * montés / en stock, rattachement flespi, silencieux depuis 24 h.
   * Même contenu que `/admin/devices/stats`, cloisonné à l'acteur.
   */
  /*
  Voir les stats d'un device
  NB : correction de la permission
  */
  async stats(ctx: HttpContext) {
    //await authorize(ctx, 'viewVehicles')
    await authorize(ctx, 'viewDevices')
    return this.statistiques(ctx, ownScope(ctx))
  }

  /** GET /api/v1/devices/:id */
  /*
  Voir un device precis par son Id
  NB : correction de la permission
  */
  async show(ctx: HttpContext) {
    //await authorize(ctx, 'viewVehicles')
    await authorize(ctx, 'viewDevices')
    return this.showScoped(ctx, ownScope(ctx))
  }

  /**
   * POST /api/v1/devices
   *
   * `syncFlespi: true` → crée (ou rattache) le device chez flespi sur le canal
   * `flespiChannelId` (défaut FLESPI_CHANNEL_ID), avec le type
   * `flespiDeviceType` (défaut « Micodus MV730 ») résolu dans le protocole du
   * canal, puis l'enregistre en base.
   *
   * Micodus : fournir `terminalId` (ID de l'étiquette) ou `flespiIdent`.
   * L'IMEI seul ne suffit pas — cf. flespi_ident.ts.
   */
  /*
  Correction de la permission pour la creation d'un boitier pour un admin ou un client
  */
  async store(ctx: HttpContext) {
    //await authorize(ctx, 'manageVehicles')
    await authorize(ctx, 'manageDevices')
    return this.storeScoped(ctx, toExecutionContext(ctx).organizationId)
  }

  /**
   * POST /api/v1/devices/:id/flespi/sync
   *
   * Rattache après coup un boîtier SISBM à flespi (créé en stock sans
   * `syncFlespi`, ou device flespi recréé). Mêmes garde-fous que la création.
   */
  /*
  Correction de la permission pour la synchronisation d'un boitier pour un admin ou un client
  */
  async syncFlespi(ctx: HttpContext) {
    //await authorize(ctx, 'manageVehicles')
    await authorize(ctx, 'manageDevices')
    return this.syncFlespiScoped(ctx, ownScope(ctx))
  }

  /**
   * PATCH /api/v1/devices/:id — côté CLIENT, annotations seulement (`notes`,
   * `name`). IMEI, SIM, ident flespi et statut relèvent de l'exploitant
   * (`PATCH /admin/devices/:id`) : une erreur y coupe la remontée des positions.
   */
  /*
  Correction de la permission pour la mise à jour d'un boitier pour un admin ou un client
  */
  async update(ctx: HttpContext) {
    //await authorize(ctx, 'manageVehicles')
    await authorize(ctx, 'manageDevices')
    const payload = await ctx.request.validateUsing(clientUpdateDeviceValidator)
    return this.updateScoped(ctx, ownScope(ctx), payload)
  }

  /**
   * DELETE /api/v1/devices/:id
   *
   * Flespi d'abord, base ensuite. Si Flespi échoue, le boîtier n'est pas
   * archivé chez nous et l'opération reste rejouable.
   */
  /*
  Correction de la permission pour la suppression d'un boitier pour un admin ou un client
  */
  async destroy(ctx: HttpContext) {
    //await authorize(ctx, 'manageVehicles')
    await authorize(ctx, 'manageDevices')
    return this.destroyScoped(ctx, ownScope(ctx))
  }

  /**
   * POST /api/v1/devices/:id/assignment — monter le boîtier sur un véhicule.
   *
   * L'affectation est DATÉE. Les contraintes CM-01/CM-02 (`EXCLUDE USING gist`)
   * garantissent en base qu'un boîtier n'est jamais sur deux véhicules à la
   * fois. En cas de chevauchement, PostgreSQL lève une `exclusion_violation`
   * traduite en 409 par le gestionnaire d'exceptions.
   */
  /*
  Correction de la permission pour l'affectation d'un boitier pour un admin ou un client
  */
  async assign(ctx: HttpContext) {
    //await authorize(ctx, 'manageVehicles')
    await authorize(ctx, 'manageDevices')
    return this.assignScoped(ctx, ownScope(ctx))
  }

  /** DELETE /api/v1/devices/:id/assignment — démonter le boîtier. */
  /*
  Correction de la permission pour la désaffectation d'un boitier pour un admin ou un client
  */
  async unassign(ctx: HttpContext) {
    //await authorize(ctx, 'manageVehicles')
    await authorize(ctx, 'manageDevices')
    return this.unassignScoped(ctx, ownScope(ctx))
  }

  /**
   * GET /api/v1/devices/:id/telemetry — dernier message CHEZ FLESPI.
   *
   * Outil de DIAGNOSTIC : il interroge Flespi directement, pas notre base.
   * Il répond à la question « le boîtier émet-il, et est-ce nous qui perdons
   * les trames ? ». La source de vérité de l'historique reste `positions`.
   */
  /*
  Correction de la permission pour la visualisation des données en temps réel pour un admin ou un client
  */
  async liveTelemetry(ctx: HttpContext) {
    await authorize(ctx, 'viewDevices')
    //await authorize(ctx, 'viewVehicles')
    return this.liveTelemetryScoped(ctx, ownScope(ctx))
  }

  /** GET /api/v1/devices/:id/telemetry/history?from=&to=&count= */
  /*
  Correction de la permission pour la visualisation des données en temps réel pour un admin ou un client
  */
  async liveHistory(ctx: HttpContext) {
    //await authorize(ctx, 'viewVehicles')
    await authorize(ctx, 'viewDevices')
    return this.liveHistoryScoped(ctx, ownScope(ctx))
  }

  /**
   * GET /api/v1/devices/:id/flespi — DIAGNOSTIC COMPLET du rattachement.
   *
   * Répond en un appel aux questions d'une mise en service :
   *   - le device existe-t-il chez flespi, avec quel ident et quel type ?
   *   - son protocole est-il celui du canal ? (sinon il ne recevra rien)
   *   - l'ident SISBM et l'ident flespi coïncident-ils ?
   *   - le boîtier est-il connecté, quand a-t-il émis pour la dernière fois ?
   *   - quelle est sa dernière position connue ?
   */
  /*
  Correction de la permission pour la visualisation du statut Flespi pour un admin ou un client
  */
  async flespiStatus(ctx: HttpContext) {
    // await authorize(ctx, 'viewVehicles')
    await authorize(ctx, 'viewDevices')
    return this.flespiStatusScoped(ctx, ownScope(ctx))
  }

  /** GET /api/v1/devices/:id/flespi/logs?from=&to=&count= — connexions, erreurs de décodage, modifications. */
  /*
  Correction de la permission pour la visualisation des logs Flespi pour un admin ou un client
  */
  async flespiLogs(ctx: HttpContext) {
    // await authorize(ctx, 'viewVehicles')
    await authorize(ctx, 'viewDevices')
    return this.flespiLogsScoped(ctx, ownScope(ctx))
  }

  /** GET /api/v1/devices/:id/flespi/telemetry — dernière valeur de chaque paramètre. */
  /*
  Correction de la permission pour la visualisation des données Flespi pour un admin ou un client
  */
  async flespiTelemetry(ctx: HttpContext) {
    // await authorize(ctx, 'viewVehicles')
    await authorize(ctx, 'viewDevices')
    return this.flespiTelemetryScoped(ctx, ownScope(ctx))
  }

  // =========================================================================
  //  TABLEAU DE BORD ADMIN — toutes organisations (joker `*` exigé)
  // =========================================================================

  /*
  Version Admin aucune correction a apportée
  */

  /**
   * GET /api/v1/admin/devices
   * ?organizationId=&status=&search=&unassigned=&linked=&page=&perPage=
   */
  async indexAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const {
      page = 1,
      perPage = 25,
      status,
      search,
      unassigned,
      linked,
      organizationId,
    } = await ctx.request.validateUsing(adminListDevicesValidator)

    const query = DeviceModel.query().whereNull('deleted_at').orderBy('imei')
    if (organizationId) query.where('organization_id', organizationId)
    if (status) query.where('status', status)
    if (search) query.whereILike('imei', `%${search}%`)
    if (linked === true) query.whereNotNull('flespi_device_id')
    if (linked === false) query.whereNull('flespi_device_id')
    if (unassigned) {
      query.whereNotExists((sub) =>
        sub
          .from('device_assignments as da')
          .whereRaw('da.device_id = devices.id')
          .whereRaw('upper_inf(da.period)')
      )
    }

    const resultat = await query.paginate(page, Math.min(perPage, 100))
    return ctx.response.ok(await serializeWithOrganizations(resultat))
  }

  /**
   * GET /api/v1/admin/devices/stats?organizationId=
   *
   * Parc boîtiers : par statut, par organisation, rattachement flespi, montés
   * ou en stock, et « silencieux » (aucune trame depuis 24 h ou jamais vus).
   */
  async statsAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(adminOrganizationFilterValidator)
    return this.statistiques(ctx, { organizationId: organizationId ?? null })
  }

  /** GET /api/v1/admin/devices/:id (admin) */
  async showAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.showScoped(ctx, PLATFORM_SCOPE)
  }

  /** POST /api/v1/admin/devices — body : { organizationId, ...champs de POST /devices } */
  async storeAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const { organizationId } = await ctx.request.validateUsing(targetOrganizationValidator)
    const organisation = await OrganizationModel.query()
      .where('id', organizationId)
      .whereNull('deleted_at')
      .select('id')
      .first()
    if (!organisation) {
      return ctx.response.notFound({
        error: { code: 'E_NOT_FOUND', message: 'Organisation introuvable', details: {} },
      })
    }
    return this.storeScoped(ctx, organizationId)
  }

  /** POST /api/v1/admin/devices/:id/flespi/sync (admin) */
  async syncFlespiAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.syncFlespiScoped(ctx, PLATFORM_SCOPE)
  }

  /** PATCH /api/v1/admin/devices/:id (admin) */
  async updateAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    const payload = await ctx.request.validateUsing(updateDeviceValidator)
    return this.updateScoped(ctx, PLATFORM_SCOPE, payload)
  }

  /** DELETE /api/v1/admin/devices/:id (admin) */
  async destroyAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.destroyScoped(ctx, PLATFORM_SCOPE)
  }

  /** POST /api/v1/admin/devices/:id/assignment — véhicule de la MÊME organisation que le boîtier (admin) */
  async assignAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.assignScoped(ctx, PLATFORM_SCOPE)
  }

  /** DELETE /api/v1/admin/devices/:id/assignment (admin) */
  async unassignAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.unassignScoped(ctx, PLATFORM_SCOPE)
  }

  /** GET /api/v1/admin/devices/:id/telemetry (admin) */
  async liveTelemetryAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.liveTelemetryScoped(ctx, PLATFORM_SCOPE)
  }

  /** GET /api/v1/admin/devices/:id/telemetry/history (admin) */
  async liveHistoryAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.liveHistoryScoped(ctx, PLATFORM_SCOPE)
  }

  /** GET /api/v1/admin/devices/:id/flespi (admin) */
  async flespiStatusAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.flespiStatusScoped(ctx, PLATFORM_SCOPE)
  }

  /** GET /api/v1/admin/devices/:id/flespi/logs (admin) */
  async flespiLogsAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.flespiLogsScoped(ctx, PLATFORM_SCOPE)
  }

  /** GET /api/v1/admin/devices/:id/flespi/telemetry (admin) */
  async flespiTelemetryAll(ctx: HttpContext) {
    await authorizePlatform(ctx)
    return this.flespiTelemetryScoped(ctx, PLATFORM_SCOPE)
  }

  /*
  ----------------------------------------------------------------------------------------------------------
  */

  // -------------------------------------------------------------------------
  //  Implémentations partagées client / admin : seul le périmètre change.
  // -------------------------------------------------------------------------

  /**
   * Parc boîtiers : par statut, par organisation, rattachement flespi, montés
   * ou en stock, et « silencieux » (aucune trame depuis 24 h ou jamais vus).
   */
  private async statistiques(ctx: HttpContext, scope: TenantScope) {
    const base = () => applyScope(DeviceModel.query().whereNull('deleted_at'), scope)
    const total = async (q: ReturnType<typeof base>) => {
      const ligne = await q.count('* as total').first()
      return Number(ligne?.$extras.total ?? 0)
    }

    const [parStatut, parOrganisation, rattaches, montes, silencieux] = await Promise.all([
      base().select('status').count('* as total').groupBy('status'),
      base().select('organization_id').count('* as total').groupBy('organization_id'),
      total(base().whereNotNull('flespi_device_id')),
      total(
        base().whereExists((sub) =>
          sub
            .from('device_assignments as da')
            .whereRaw('da.device_id = devices.id')
            .whereRaw('upper_inf(da.period)')
        )
      ),
      total(
        base()
          .whereNot('status', 'decommissioned')
          .where((q) =>
            q
              .whereNull('last_seen_at')
              .orWhere('last_seen_at', '<', DateTime.now().minus({ hours: 24 }).toSQL()!)
          )
      ),
    ])

    const compteurs = countsBy(parStatut, 'status')
    const organisations = await organizationsOf(parOrganisation.map((l) => l.organizationId))
    const tous = Object.values(compteurs).reduce((a, b) => a + b, 0)

    return ctx.response.ok({
      data: {
        total: tous,
        byStatus: compteurs,
        flespi: { linked: rattaches, notLinked: tous - rattaches },
        assignment: { assigned: montes, unassigned: tous - montes },
        silentSince24h: silencieux,
        byOrganization: parOrganisation.map((l) => ({
          organization: organisations[l.organizationId] ?? { id: l.organizationId },
          total: Number(l.$extras.total ?? 0),
        })),
      },
    })
  }

  /*
  renvoi des informations d'un boitier, avec l'affectation au véhicule si monté.
  Le boitier est recherché dans le périmètre de l'acteur (client) ou dans toute la plateforme (admin).
  tables devices, device_assignments, vehicles
  1. Vérifie que le boîtier existe dans le périmètre.
  2. Recherche l'affectation en cours (si monté) et le véhicule associé.
  3. Retourne les informations du boîtier et de l'affectation (ou null si non monté).
  */
  private async showScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.trouver(ctx, scope)
    if (!device) return this.introuvable(ctx)

    return ctx.response.ok({
      data: {
        ...device.serialize(),
        assignment: await this.assignments.currentOf(device.id),
      },
    })
  }

  /*
  create avec ou sans rattache un boitier à un device flespi, avec le type et le protocole du canal. Le boitier est mis à jour en base avec le deviceId et l'ident flespi.
  4. Vérifie que le boîtier n'existe pas déjà en base.
  5. Crée ou rattache le device chez flespi, avec le type et le protocole du canal.
  */
  private async storeScoped(ctx: HttpContext, organizationId: string) {
    const payload = await ctx.request.validateUsing(createDeviceValidator)

    let provision: ProvisionResult | null = null
    let flespiDeviceId = payload.flespiDeviceId ?? null
    let flespiIdent = payload.flespiIdent ?? null
    let protocol = payload.protocol ?? null
    const channelId = payload.flespiChannelId ?? (sisbmConfig.flespi.channelId || null)

    if (payload.syncFlespi) {
      const prov = this.provisioning
      // Les erreurs de provisionnement (type/protocole, ident, doublon) sont
      // traduites en 4xx explicites par le gestionnaire d'exceptions.
      provision = await prov.provision({
        imei: payload.imei,
        model: payload.model,
        channelId: channelId ?? 0,
        deviceType:
          payload.flespiDeviceType ?? payload.flespiDeviceTypeId ?? sisbmConfig.flespi.deviceType,
        name: payload.name,
        terminalId: payload.terminalId,
        flespiIdent: payload.flespiIdent,
        phone: payload.simMsisdn ?? payload.simIccid ?? null,
        messagesTtl: sisbmConfig.flespi.deviceMessagesTtl,
        linkExisting: payload.linkExisting,
      })
      flespiDeviceId = provision.device.id
      flespiIdent = provision.ident
      protocol = provision.protocolName
    } else if (flespiDeviceId) {
      // Rattachement manuel à un device flespi existant : on vérifie qu'il existe.
      const existant = await this.gateway.get(flespiDeviceId)
      if (!existant) {
        return ctx.response.unprocessableEntity({
          error: {
            code: 'E_FLESPI_DEVICE_NOT_FOUND',
            message: `Aucun device flespi ${flespiDeviceId}`,
            details: {},
          },
        })
      }
      flespiIdent = existant.configuration.ident
    }

    try {
      const device = await DeviceModel.create({
        imei: payload.imei,
        serialNumber: payload.serialNumber ?? null,
        manufacturer: payload.manufacturer ?? 'micodus',
        model: payload.model,
        protocol,
        hasRelay: payload.hasRelay ?? false,
        simMsisdn: payload.simMsisdn ?? null,
        simIccid: payload.simIccid ?? null,
        simOperator: payload.simOperator ?? null,
        organizationId,
        flespiDeviceId,
        flespiChannelId: flespiDeviceId ? channelId : null,
        flespiIdent,
        status: payload.status ?? 'stock',
        notes: payload.notes ?? null,
      })
      await this.invalider(device)

      return ctx.response.created({
        data: device.serialize(),
        meta: provision
          ? {
              flespi: {
                deviceId: provision.device.id,
                ident: provision.ident,
                deviceType: provision.deviceTypeTitle,
                protocol: provision.protocolName,
                created: provision.created,
              },
            }
          : undefined,
      })
    } catch (err) {
      // Compensation : pas de device flespi orphelin si la base refuse (IMEI en double…).
      if (provision) await this.provisioning.rollback(provision)
      throw err
    }
  }

  /*
  Synchronisation d'un boîtier existant avec Flespi : création ou rattachement d'un device flespi, mise à jour du channel, du type et du protocole. Le boîtier est mis à jour en base avec le deviceId et l'ident flespi.
  6. Vérifie que le boîtier existe en base.
  7. Vérifie qu'il n'est pas déjà rattaché à un device flespi.
  8. Crée ou rattache le device chez flespi, avec le type et le protocole du canal.
  9. Met à jour le boîtier en base avec le deviceId, l'ident et le protocole.
  10. Invalide le cache du boîtier pour que le worker d'ingestion rattache les trames au bon véhicule.
  11. Retourne les informations du boîtier et du device flespi.
  */
  private async syncFlespiScoped(ctx: HttpContext, scope: TenantScope) {
    const payload = await ctx.request.validateUsing(syncDeviceFlespiValidator)
    const device = await this.trouver(ctx, scope)
    if (!device) return this.introuvable(ctx)
    //verification que le boitier n'est pas déjà rattaché à un device flespi
    if (device.flespiDeviceId) {
      const existant = await this.gateway.get(device.flespiDeviceId).catch(() => null)
      if (existant) {
        return ctx.response.conflict({
          error: {
            code: 'E_ALREADY_LINKED',
            message: `Déjà rattaché au device flespi ${device.flespiDeviceId}`,
            details: { flespiDeviceId: device.flespiDeviceId },
          },
        })
      }
    }

    //creation et configuration du device chez flespi, avec le type et le protocole du canal
    const channelId =
      payload.flespiChannelId ?? device.flespiChannelId ?? sisbmConfig.flespi.channelId
    const prov = this.provisioning
    const provision = await prov.provision({
      imei: device.imei,
      model: device.model,
      channelId,
      deviceType: payload.flespiDeviceType ?? sisbmConfig.flespi.deviceType,
      name: payload.name,
      terminalId: payload.terminalId,
      flespiIdent: payload.flespiIdent ?? device.flespiIdent,
      phone: device.simMsisdn ?? device.simIccid,
      messagesTtl: sisbmConfig.flespi.deviceMessagesTtl,
      linkExisting: payload.linkExisting,
    })

    try {
      // Mise à jour locale du boîtier avec les infos flespi : deviceId, channelId, ident et protocole.
      const ancien = { imei: device.imei, flespiIdent: device.flespiIdent }
      device.merge({
        flespiDeviceId: provision.device.id,
        flespiChannelId: channelId,
        flespiIdent: provision.ident,
        protocol: provision.protocolName,
      })
      await device.save()
      await this.invalider(ancien)
      await this.invalider(device)
    } catch (err) {
      await prov.rollback(provision)
      throw err
    }

    return ctx.response.ok({
      data: device.serialize(),
      meta: {
        flespi: {
          deviceId: provision.device.id,
          ident: provision.ident,
          created: provision.created,
        },
      },
    })
  }

  //update d'un boitier : nom, téléphone, ident flespi, notes. IMEI et SIM sont immuables.
  private async updateScoped(
    ctx: HttpContext,
    scope: TenantScope,
    payload: Awaited<ReturnType<typeof updateDeviceValidator.validate>>
  ) {
    const device = await this.trouver(ctx, scope)
    if (!device) return this.introuvable(ctx)

    const { name, flespiIdent, ...local } = payload
    const ancien = { imei: device.imei, flespiIdent: device.flespiIdent }

    /**
     * Répercussion chez flespi AVANT la base : nom, téléphone (requis pour les
     * commandes SMS) et ident. Si flespi refuse, rien n'est modifié chez nous.
     */
    const identChange = flespiIdent !== undefined && flespiIdent !== device.flespiIdent
    const phoneChange = local.simMsisdn !== undefined && local.simMsisdn !== device.simMsisdn
    if (device.flespiDeviceId && (name || identChange || phoneChange)) {
      await this.gateway.update(device.flespiDeviceId, {
        name,
        ident: identChange ? flespiIdent : undefined,
        phone: phoneChange ? local.simMsisdn : undefined,
      })
    }

    //update local device
    device.merge(local)
    if (flespiIdent !== undefined) device.flespiIdent = flespiIdent
    await device.save()
    if (identChange) {
      await this.invalider(ancien)
      await this.invalider(device)
    }
    return ctx.response.ok({ data: device.serialize() })
  }

  /*
  Suppression d'un boîtier : Flespi d'abord, base ensuite. le boitier est mis hors service et archivé (deleted_at) : il n'est pas physiquement supprimé de la base, pour conserver l'historique des positions du véhicule.
  */
  /*
  private async destroyScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.trouver(ctx, scope)
    if (!device) return this.introuvable(ctx)

    // Un boîtier encore monté ne se supprime pas : l'historique du véhicule
    // en dépend. Il faut le démonter explicitement d'abord.
    if (await this.assignments.isMounted(device.id)) {
      return ctx.response.conflict({
        error: {
          code: 'E_DEVICE_STILL_ASSIGNED',
          message: 'Démonter le boîtier de son véhicule avant de le supprimer',
          details: {},
        },
      })
    }

    if (device.flespiDeviceId) {
      try {
        await this.gateway.delete(device.flespiDeviceId)
      } catch (err) {
        // Déjà supprimé chez flespi : rien à compenser, on archive.
        const dejaAbsent = err instanceof FlespiApiError && err.notFound
        if (!dejaAbsent) {
          logger.error(
            { err, flespiDeviceId: device.flespiDeviceId },
            '[devices] suppression Flespi en échec'
          )
          return ctx.response.badGateway({
            error: {
              code: 'E_FLESPI_UNAVAILABLE',
              message:
                "Le boîtier n'a pas pu être supprimé chez Flespi. Il n'a pas été archivé " +
                'localement : relancer une fois le service rétabli.',
              details: { detail: (err as Error).message },
            },
          })
        }
      }
    }

    device.deletedAt = DateTime.now()
    device.status = 'decommissioned'
    await device.save()
    //supprimer le cache du boitier pour que le worker d'ingestion rattache les trames au bon véhicule
    await this.invalider(device)
    return ctx.response.noContent()
  }
 */

  /*
  Device detruit en base de donnée et chez flespi , le boitier est mis hors service et est supprimé en base de donnée 
  */
  /*
    Suppression d'un boîtier : Flespi d'abord, base de données ensuite (suppression définitive).
  */
  private async destroyScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.trouver(ctx, scope)
    if (!device) return this.introuvable(ctx)

    // Un boîtier encore monté ne se supprime pas : l'historique du véhicule
    // en dépend. Il faut le démonter explicitement d'abord.
    if (await this.assignments.isMounted(device.id)) {
      return ctx.response.conflict({
        error: {
          code: 'E_DEVICE_STILL_ASSIGNED',
          message: 'Démonter le boîtier de son véhicule avant de le supprimer',
          details: {},
        },
      })
    }

    if (device.flespiDeviceId) {
      try {
        await this.gateway.delete(device.flespiDeviceId)
      } catch (err) {
        // Déjà supprimé chez flespi : rien à compenser, on supprime.
        const dejaAbsent = err instanceof FlespiApiError && err.notFound
        if (!dejaAbsent) {
          logger.error(
            { err, flespiDeviceId: device.flespiDeviceId },
            '[devices] suppression Flespi en échec'
          )
          return ctx.response.badGateway({
            error: {
              code: 'E_FLESPI_UNAVAILABLE',
              message:
                "Le boîtier n'a pas pu être supprimé chez Flespi. Il n'a pas été supprimé " +
                'localement : relancer une fois le service rétabli.',
              details: { detail: (err as Error).message },
            },
          })
        }
      }
    }

    // Suppression définitive de l'enregistrement en base de données
    await device.delete()

    // Supprimer le cache du boîtier
    await this.invalider(device)

    return ctx.response.noContent()
  }

  /*
  Assignation d'un boîtier à un véhicule : INSERT dans device_assignments, avec
  mise à jour de la période de l'affectation précédente (si existante) et du
  statut du boîtier. Le tout dans une transaction.
  */
  private async assignScoped(ctx: HttpContext, scope: TenantScope) {
    const { vehicleId, installNotes } = await ctx.request.validateUsing(assignDeviceValidator)
    const contexte = toExecutionContext(ctx)

    /**
     * Les deux identifiants sont vérifiés AVANT l'insertion.
     *
     * Sans ce contrôle, un UUID inexistant part directement dans le INSERT et
     * PostgreSQL répond par une violation de clé étrangère
     * (`device_assignments_device_id_fkey`) : le client reçoit un 409
     * « contrainte d'intégrité » illisible, alors que la vraie cause est un
     * boîtier ou un véhicule introuvable — typiquement l'inversion des deux
     * identifiants, ou une base réinitialisée depuis.
     */
    const device = await this.trouver(ctx, scope)
    if (!device) return this.introuvable(ctx)

    // Même organisation que le BOÎTIER (et non que l'acteur) : en admin, le
    // super_admin n'appartient pas à l'organisation du boîtier.
    if (!(await this.assignments.vehicleExists(vehicleId, device.organizationId))) {
      return ctx.response.notFound({
        error: {
          code: 'E_VEHICLE_NOT_FOUND',
          message: 'Véhicule introuvable dans cette organisation',
          details: { vehicleId },
        },
      })
    }

    await this.assignments.assign({
      deviceId: device.id,
      vehicleId,
      actorId: contexte.actorId ?? null,
      notes: installNotes ?? null,
    })

    //supprimer le cache du boitier pour que le worker d'ingestion rattache les trames au bon véhicule
    await this.invalider(device)
    return ctx.response.created({ data: { deviceId: ctx.params.id, vehicleId } })
  }

  //selectionner le boîtier dans le périmètre et le démonter (UPDATE device_assignments)
  private async unassignScoped(ctx: HttpContext, scope: TenantScope) {
    const contexte = toExecutionContext(ctx)

    // Le boîtier est cherché d'abord DANS le périmètre : sans cela, l'UPDATE
    // ci-dessous démontait le boîtier d'une autre organisation connu par son id.
    const device = await this.trouver(ctx, scope)
    if (!device) return this.introuvable(ctx)

    if (!(await this.assignments.unassign(device.id, contexte.actorId ?? null))) {
      return ctx.response.notFound({
        error: { code: 'E_NOT_FOUND', message: 'Aucune affectation en cours', details: {} },
      })
    }
    //supprimer le cache du boitier pour que le worker d'ingestion rattache les trames au bon véhicule
    await this.invalider(device)
    return ctx.response.noContent()
  }

  /*
  méthode permettant de retrouver le dernier message d'un boitier rattaché à flespi (flespiDeviceId non null)
  */
  private async liveTelemetryScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.trouverRattache(ctx, scope)
    if (!device) return
    const message = await this.gateway.lastMessage(device.flespiDeviceId!)
    return ctx.response.ok({ data: { source: 'flespi', message } })
  }

  /*
  Méthode permettant de retrouver les logs d'un boitier rattaché à flespi (flespiDeviceId non null)
  */
  private async liveHistoryScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.trouverRattache(ctx, scope)
    if (!device) return

    const q = await ctx.request.validateUsing(logQueryValidator)
    const from = toFlespiSeconds(q.from)
    const to = toFlespiSeconds(q.to)
    if (from === undefined || to === undefined || from > to) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'E_VALIDATION',
          message: 'Paramètres « from » et « to » requis au format ISO 8601, from ≤ to',
          details: {},
        },
      })
    }

    const messages = await this.gateway.messages(device.flespiDeviceId!, {
      from,
      to,
      count: q.count ?? 1000,
    })
    return ctx.response.ok({ data: { source: 'flespi', count: messages.length, messages } })
  }

  /*
  Méthode permettant de retrouver le statut d'un boitier rattaché à flespi (flespiDeviceId non null) et de renvoyer les informations de diagnostic.
  */
  private async flespiStatusScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.trouverRattache(ctx, scope)
    if (!device) return

    const gw = this.gateway
    const flespi = await gw.get(device.flespiDeviceId!)
    if (!flespi) {
      return ctx.response.ok({
        data: {
          linked: false,
          problems: [
            `Le device flespi ${device.flespiDeviceId} n'existe plus : relancer POST /devices/${device.id}/flespi/sync`,
          ],
        },
      })
    }

    const protocoles = this.catalogue
    const telemetrie = await gw
      .telemetry(device.flespiDeviceId!)
      .catch(() => ({}) as Record<string, { value: unknown; ts: number }>)
    const canalId = device.flespiChannelId ?? sisbmConfig.flespi.channelId
    const canal = canalId ? await this.channels.get(canalId).catch(() => null) : null
    const type = await protocoles
      .deviceType(flespi.protocol_id, flespi.device_type_id)
      .catch(() => null)

    const t = (k: string) => telemetrie[k]?.value ?? null
    const derniereTrame = telemetrie['timestamp']?.value as number | undefined

    const problems: string[] = []
    if (canal && canal.protocol_id !== flespi.protocol_id) {
      problems.push(
        `Protocole du device (${flespi.protocol_id}) ≠ protocole du canal ${canal.id} (${canal.protocol_id}) : ` +
          'le device ne recevra aucun message. Recréer le device avec un type du protocole du canal.'
      )
    }
    if (device.flespiIdent && device.flespiIdent !== flespi.configuration.ident) {
      problems.push(
        `Ident SISBM (${device.flespiIdent}) ≠ ident flespi (${flespi.configuration.ident}) : ` +
          "l'ingestion ne saura pas rattacher les trames."
      )
    }
    if (!derniereTrame) {
      problems.push(
        'Aucune trame reçue. Vérifier : SIM active avec data, APN, serveur programmé sur ' +
          `${canal?.uri ?? "l'URI du canal"}, puis GET /api/v1/flespi/channels/${canalId}/idents.`
      )
    } else if (Date.now() / 1000 - derniereTrame > 3600) {
      problems.push(
        'Dernière trame il y a plus d’une heure : boîtier en veille, hors couverture ou éteint.'
      )
    }
    if (!flespi.configuration.phone) {
      problems.push(
        'Aucun numéro de SIM chez flespi : les commandes par SMS (repli hors GPRS) sont impossibles.'
      )
    }

    return ctx.response.ok({
      data: {
        linked: true,
        device: {
          id: flespi.id,
          name: flespi.name,
          ident: flespi.configuration.ident,
          phone: flespi.configuration.phone ?? null,
          enabled: flespi.enabled,
          deviceTypeId: flespi.device_type_id,
          deviceType: type?.title ?? null,
          protocolId: flespi.protocol_id,
          messagesTtl: flespi.messages_ttl,
        },
        channel: canal ? { id: canal.id, uri: canal.uri, protocolId: canal.protocol_id } : null,
        lastMessageAt: derniereTrame ? new Date(derniereTrame * 1000).toISOString() : null,
        position: {
          latitude: t('position.latitude'),
          longitude: t('position.longitude'),
          speed: t('position.speed'),
          valid: t('position.valid'),
          satellites: t('position.satellites'),
        },
        ignition: t('engine.ignition.status'),
        batteryLevel: t('battery.level'),
        gsmSignal: t('gsm.signal.level'),
        problems,
      },
    })
  }

  /*
  Trouver les logs d'un boitier rattaché à flespi (flespiDeviceId non null)
  */
  private async flespiLogsScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.trouverRattache(ctx, scope)
    if (!device) return
    const q = await ctx.request.validateUsing(logQueryValidator)
    const logs = await this.gateway.logs(device.flespiDeviceId!, {
      from: toFlespiSeconds(q.from),
      to: toFlespiSeconds(q.to),
      count: q.count,
    })
    return ctx.response.ok({ data: logs })
  }

  /*
  Trouver un boitier rattaché à flespi (flespiDeviceId non null) et ses valeurs de télémétrie.
  */
  private async flespiTelemetryScoped(ctx: HttpContext, scope: TenantScope) {
    const device = await this.trouverRattache(ctx, scope)
    if (!device) return
    return ctx.response.ok({ data: await this.gateway.telemetry(device.flespiDeviceId!) })
  }

  /** Boîtier de l'organisation ET rattaché à flespi ; sinon répond (404 / 409) et renvoie null. */
  //troouver les boitiers dans le périmètre d'une organisation (ou de la plateforme) ET rattaché à flespi (flespiDeviceId non null)
  private async trouverRattache(ctx: HttpContext, scope: TenantScope): Promise<DeviceModel | null> {
    const device = await this.trouver(ctx, scope)
    if (!device) {
      this.introuvable(ctx)
      return null
    }
    if (!device.flespiDeviceId) {
      ctx.response.conflict({
        error: {
          code: 'E_NO_FLESPI_DEVICE',
          message: "Ce boîtier n'est pas rattaché à Flespi (POST /devices/:id/flespi/sync)",
          details: {},
        },
      })
      return null
    }
    return device
  }

  // -------------------------------------------------------------------------

  /** Cherché DANS le périmètre : un id d'un autre client donne 404, pas une fuite. */
  //Trouver les boitiers dans le périmètre d'une organisation (ou de la plateforme)
  private trouver(ctx: HttpContext, scope: TenantScope): Promise<DeviceModel | null> {
    const query = DeviceModel.query().where('id', ctx.params.id).whereNull('deleted_at')
    return applyScope(query, scope).first()
  }

  //not found response pour les boitiers introuvables (hors périmètre ou inexistant)
  private introuvable(ctx: HttpContext) {
    return ctx.response.notFound({
      error: { code: 'E_NOT_FOUND', message: 'Boîtier introuvable', details: {} },
    })
  }
}
