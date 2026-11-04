import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  CONDUCTEURS — organisation FACULTATIVE
 * =========================================================================
 *
 * Un conducteur peut exister sans organisation : vivier géré par
 * l'exploitant SISBM (chauffeurs indépendants, intérimaires), rattaché plus
 * tard à un client — ou jamais.
 *
 * ① drivers.organization_id devient NULLABLE.
 *
 * ② Unicité du permis et du matricule : `NULLS NOT DISTINCT` (PostgreSQL ≥ 15).
 *    Sans cette clause, deux conducteurs SANS organisation pourraient porter
 *    le même numéro de permis (NULL ≠ NULL pour un index unique classique).
 *    Le vivier sans organisation forme donc un périmètre d'unicité à part
 *    entière, comme chaque organisation.
 *
 * ③ Cloisonnement conducteur ↔ véhicule : la règle ne s'applique que si le
 *    conducteur A une organisation. Un conducteur sans organisation peut être
 *    rattaché au véhicule de n'importe quel client (c'est l'exploitant qui
 *    fait ce rattachement : les routes client ne voient pas le vivier).
 *
 * Les groupes de conducteurs restent cloisonnés : un conducteur sans
 * organisation n'entre dans aucun groupe (le trigger de la migration 018 le
 * refuse déjà, `NULL IS DISTINCT FROM <org>`).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      ALTER TABLE drivers ALTER COLUMN organization_id DROP NOT NULL;

      DROP INDEX uq_drivers_org_license;
      CREATE UNIQUE INDEX uq_drivers_org_license
        ON drivers (organization_id, license_number) NULLS NOT DISTINCT
        WHERE license_number IS NOT NULL AND deleted_at IS NULL;

      DROP INDEX uq_drivers_org_employee_code;
      CREATE UNIQUE INDEX uq_drivers_org_employee_code
        ON drivers (organization_id, employee_code) NULLS NOT DISTINCT
        WHERE employee_code IS NOT NULL AND deleted_at IS NULL;

      -- vivier de l'exploitant (GET /admin/drivers?withoutOrganization=true)
      CREATE INDEX idx_drivers_without_organization ON drivers (status)
        WHERE organization_id IS NULL AND deleted_at IS NULL;
    `)

    this.schema.raw(`
      CREATE OR REPLACE FUNCTION sisbm_check_driver_vehicle_tenant()
      RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        org_vehicule uuid;
      BEGIN
        -- pas de véhicule, ou conducteur sans organisation : rien à cloisonner
        IF NEW.vehicle_id IS NULL OR NEW.organization_id IS NULL THEN
          RETURN NEW;
        END IF;
        SELECT organization_id INTO org_vehicule FROM vehicles WHERE id = NEW.vehicle_id;
        IF org_vehicule IS DISTINCT FROM NEW.organization_id THEN
          RAISE EXCEPTION 'CM-17 : le conducteur (%) et le vehicule (%) appartiennent a des organisations differentes',
            NEW.organization_id, org_vehicule
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;
    `)
  }

  /**
   * Le rollback REFUSE de s'exécuter tant qu'il reste des conducteurs sans
   * organisation : les rattacher ou les supprimer d'abord. Effacer des
   * données en silence pour satisfaire un NOT NULL n'est pas une option.
   */
  async down() {
    this.schema.raw(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM drivers WHERE organization_id IS NULL) THEN
          RAISE EXCEPTION 'Rollback impossible : des conducteurs n''ont pas d''organisation. Les rattacher ou les supprimer avant.';
        END IF;
      END $$;

      DROP INDEX IF EXISTS idx_drivers_without_organization;

      DROP INDEX uq_drivers_org_license;
      CREATE UNIQUE INDEX uq_drivers_org_license ON drivers (organization_id, license_number)
        WHERE license_number IS NOT NULL AND deleted_at IS NULL;

      DROP INDEX uq_drivers_org_employee_code;
      CREATE UNIQUE INDEX uq_drivers_org_employee_code ON drivers (organization_id, employee_code)
        WHERE employee_code IS NOT NULL AND deleted_at IS NULL;

      ALTER TABLE drivers ALTER COLUMN organization_id SET NOT NULL;

      CREATE OR REPLACE FUNCTION sisbm_check_driver_vehicle_tenant()
      RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      DECLARE
        org_vehicule uuid;
      BEGIN
        IF NEW.vehicle_id IS NULL THEN
          RETURN NEW;
        END IF;
        SELECT organization_id INTO org_vehicule FROM vehicles WHERE id = NEW.vehicle_id;
        IF org_vehicule IS DISTINCT FROM NEW.organization_id THEN
          RAISE EXCEPTION 'CM-17 : le conducteur (%) et le vehicule (%) appartiennent a des organisations differentes',
            NEW.organization_id, org_vehicule
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $fn$;
    `)
  }
}
