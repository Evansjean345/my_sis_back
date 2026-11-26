import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  RÈGLES — retrait de trois événements déclencheurs
 * =========================================================================
 *
 * `towing` (remorquage), `tamper` (sabotage du boîtier) et `harsh_driving`
 * (conduite brutale) ne déclenchent plus de règle (référentiel
 * `domain/code_legacy/rule/rule_event_types.ts`).
 *
 * Les règles qui les utilisaient ne peuvent plus exister avec la nouvelle
 * contrainte : elles sont supprimées, avec leurs actions, cibles et
 * historique d'exécution (ON DELETE CASCADE). Le nombre supprimé est tracé
 * dans le journal de migration (NOTICE).
 */
const KEPT = `'overspeed','geofence_exit','geofence_entry','schedule_violation','power_cut',
  'disconnection','sos','jamming','engine_start','engine_stop'`

export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      DO $$
      DECLARE removed integer;
      BEGIN
        DELETE FROM policies WHERE trigger_type IN ('towing', 'tamper', 'harsh_driving');
        GET DIAGNOSTICS removed = ROW_COUNT;
        RAISE NOTICE 'règles supprimées (towing, tamper, harsh_driving) : %', removed;
      END $$;

      ALTER TABLE policies DROP CONSTRAINT ck_policies_trigger;
      ALTER TABLE policies ADD CONSTRAINT ck_policies_trigger CHECK (trigger_type IN (${KEPT}));
    `)
  }

  /** Les règles supprimées ne sont pas restaurées. */
  async down() {
    this.schema.raw(`
      ALTER TABLE policies DROP CONSTRAINT ck_policies_trigger;
      ALTER TABLE policies ADD CONSTRAINT ck_policies_trigger CHECK (trigger_type IN (
        ${KEPT}, 'towing', 'tamper', 'harsh_driving'
      ));
    `)
  }
}
