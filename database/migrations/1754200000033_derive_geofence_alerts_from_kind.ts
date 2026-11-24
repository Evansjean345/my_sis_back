import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  ZONES — l'événement surveillé dépend du type de zone
 * =========================================================================
 *
 * Aligné sur l'écran « Zones géographiques » :
 *   - zone INTERDITE → les règles se déclenchent à l'entrée ;
 *   - zone AUTORISÉE → à la sortie.
 * Une zone vaut pour tous les véhicules du client : le ciblage d'un véhicule
 * ou d'une flotte se fait dans les conditions des règles.
 *
 * ① Les zones existantes reprennent l'événement de leur type.
 * ② Les véhicules surveillés (`geofence_assignments`) sont retirés : ils
 *   restreindraient une zone sans que l'écran ne le montre.
 * ③ Contrainte : les deux réglages restent cohérents avec le type (les
 *   points d'intérêt `poi`, hors écran, ne sont pas concernés).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      UPDATE geofences
      SET alert_on_entry = (kind = 'forbidden'),
          alert_on_exit  = (kind = 'authorized')
      WHERE kind IN ('authorized', 'forbidden');

      DELETE FROM geofence_assignments;

      ALTER TABLE geofences ADD CONSTRAINT ck_geofences_alert_kind CHECK (
        kind = 'poi' OR (alert_on_entry = (kind = 'forbidden') AND alert_on_exit = (kind = 'authorized'))
      );
    `)
  }

  /** Les véhicules surveillés retirés ne sont pas restaurés. */
  async down() {
    this.schema.raw(`ALTER TABLE geofences DROP CONSTRAINT IF EXISTS ck_geofences_alert_kind`)
  }
}
