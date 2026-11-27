import db from '@adonisjs/lucid/services/db'
import type { ClientSpaceReader, ClientSpaceSummary } from '#application/admin/ports'

/**
 * Résumé d'un espace client en UNE requête : identité de l'organisation et
 * compteurs de chaque rubrique (lignes non supprimées seulement).
 */
export class LucidClientSpaceReader implements ClientSpaceReader {
  async summary(organizationId: string): Promise<ClientSpaceSummary | null> {
    const r = await db.rawQuery(
      `SELECT o.id, o.name, o.code, o.is_active,
              (SELECT count(*) FROM subscriptions s
                WHERE s.organization_id = o.id AND s.deleted_at IS NULL AND s.status = 'active') AS active_subscriptions,
              (SELECT count(*) FROM drivers d
                WHERE d.organization_id = o.id AND d.deleted_at IS NULL) AS drivers,
              (SELECT count(*) FROM usage_schedules u
                WHERE u.organization_id = o.id AND u.deleted_at IS NULL AND u.is_active) AS active_schedules,
              (SELECT count(*) FROM usage_schedules u
                WHERE u.organization_id = o.id AND u.deleted_at IS NULL) AS schedules,
              (SELECT count(*) FROM vehicles v
                WHERE v.organization_id = o.id AND v.deleted_at IS NULL) AS vehicles,
              (SELECT count(*) FROM geofences g
                WHERE g.organization_id = o.id AND g.deleted_at IS NULL) AS zones,
              (SELECT count(*) FROM speed_policies sp
                WHERE sp.organization_id = o.id AND sp.deleted_at IS NULL) AS speed_policies,
              (SELECT count(*) FROM policies p
                WHERE p.organization_id = o.id AND p.deleted_at IS NULL) AS rules,
              (SELECT count(*) FROM incidents i
                WHERE i.organization_id = o.id AND i.status IN ('open', 'in_progress')) AS open_incidents
         FROM organizations o
        WHERE o.id = :id AND o.deleted_at IS NULL`,
      { id: organizationId }
    )
    const l = (r.rows ?? [])[0] as Record<string, unknown> | undefined
    if (!l) return null
    const n = (v: unknown) => Number(v ?? 0)
    return {
      organization: {
        id: String(l.id),
        name: String(l.name),
        code: String(l.code),
        isActive: Boolean(l.is_active),
      },
      counts: {
        activeSubscriptions: n(l.active_subscriptions),
        drivers: n(l.drivers),
        activeSchedules: n(l.active_schedules),
        schedules: n(l.schedules),
        vehicles: n(l.vehicles),
        zones: n(l.zones),
        speedPolicies: n(l.speed_policies),
        rules: n(l.rules),
        openIncidents: n(l.open_incidents),
      },
    }
  }
}
