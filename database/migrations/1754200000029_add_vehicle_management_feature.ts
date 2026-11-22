import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  CATALOGUE — fonctionnalité « Gestion de véhicules »
 * =========================================================================
 *
 *   Gestion de véhicules
 *     vehicles        Véhicules             /dashboard/vehicles
 *     vehicle_groups  Groupes de véhicules  /dashboard/group_vehicle
 *
 * Les deux pages existent déjà dans les tableaux de bord du distributeur
 * (admin) et du client final (opérateur), où elles étaient visibles par
 * tous. Elles deviennent soumises à l'offre : pour qu'aucune organisation ne
 * les perde, la migration les inclut dans TOUTES les offres existantes. On
 * les retire ensuite offre par offre (matrice du Super Admin).
 */
const FONCTIONNALITE = 'Gestion de véhicules'

export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      INSERT INTO features (name) VALUES ('${FONCTIONNALITE}');

      INSERT INTO sub_features (feature_id, key, label, path)
      SELECT f.id, v.key, v.label, v.path
      FROM (VALUES
        (1, 'vehicles', 'Véhicules', '/dashboard/vehicles'),
        (2, 'vehicle_groups', 'Groupes de véhicules', '/dashboard/group_vehicle')
      ) AS v(ord, key, label, path)
      CROSS JOIN features f
      WHERE f.name = '${FONCTIONNALITE}'
      ORDER BY v.ord;

      INSERT INTO offer_sub_features (offer_id, sub_feature_id)
      SELECT o.id, s.id
      FROM offers o
      CROSS JOIN sub_features s
      WHERE s.key IN ('vehicles', 'vehicle_groups')
      ON CONFLICT DO NOTHING;
    `)
  }

  async down() {
    // ON DELETE CASCADE : sous-fonctionnalités et rattachements aux offres partent avec.
    this.schema.raw(`DELETE FROM features WHERE name = '${FONCTIONNALITE}'`)
  }
}
