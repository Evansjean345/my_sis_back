import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * =========================================================================
 *  Solde SMS GLOBAL — remplace sms_accounts + sms_transactions
 * =========================================================================
 *
 * AVANT (migration 008) : un compte SMS par organisation (`sms_accounts`) et
 * un grand livre de chaque mouvement (`sms_transactions`).
 *
 * APRÈS : SISBM achète ses crédits auprès de la passerelle pour TOUTE la
 * plateforme. Une seule table, une seule ligne (`id = 1`, garanti par la
 * contrainte `ck_sms_balance_singleton`) :
 *
 *   balance_credits        crédits SMS restants
 *   total_sent             total cumulé des SMS envoyés
 *   low_balance_threshold  seuil d'alerte « solde bas »
 *   last_topup_at          date de la dernière recharge
 *
 * Envoi d'un SMS, en UNE requête atomique (pas de solde négatif possible) :
 *
 *   UPDATE sms_balance
 *      SET balance_credits = balance_credits - :segments,
 *          total_sent      = total_sent + :segments
 *    WHERE id = 1 AND balance_credits >= :segments
 *   -- 0 ligne modifiée = solde insuffisant : ne pas envoyer.
 *
 * Le détail par SMS (destinataire, organisation, segments, statut) reste
 * dans `notifications` (canal `sms`) : c'est de là que la vue
 * `mv_sms_monthly_usage` tire la consommation par organisation et par mois,
 * exigée par le TDR (§II.4 rapports de consommation, §II.6 monétisation).
 * Les recharges sont tracées dans `audit_logs` (action `sms.topup`).
 *
 * Reprise des données : solde = somme des soldes des comptes existants,
 * total envoyé = somme des consommations du grand livre.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      CREATE TABLE sms_balance (
        id                    smallint PRIMARY KEY DEFAULT 1,
        provider              text    NOT NULL DEFAULT 'local_gateway',
        balance_credits       integer NOT NULL DEFAULT 0,
        total_sent            bigint  NOT NULL DEFAULT 0,
        low_balance_threshold integer NOT NULL DEFAULT 100,
        last_topup_at         timestamptz,
        updated_at            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_sms_balance_singleton CHECK (id = 1),
        CONSTRAINT ck_sms_balance_credits   CHECK (balance_credits >= 0),
        CONSTRAINT ck_sms_balance_total     CHECK (total_sent >= 0),
        CONSTRAINT ck_sms_balance_threshold CHECK (low_balance_threshold >= 0)
      );
      CREATE TRIGGER trg_sms_balance_updated_at BEFORE UPDATE ON sms_balance
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();

      INSERT INTO sms_balance (id, provider, balance_credits, total_sent, low_balance_threshold, last_topup_at)
      SELECT 1,
             coalesce((SELECT provider FROM sms_accounts WHERE is_active ORDER BY created_at LIMIT 1),
                      'local_gateway'),
             coalesce((SELECT floor(sum(balance_credits))::integer FROM sms_accounts), 0),
             coalesce((SELECT -sum(quantity) FROM sms_transactions
                        WHERE transaction_type = 'consumption'), 0)::bigint,
             coalesce((SELECT max(low_balance_threshold)::integer FROM sms_accounts), 100),
             (SELECT max(created_at) FROM sms_transactions WHERE transaction_type = 'topup');
    `)

    // La vue matérialisée (database/sql/views) lit sms_transactions : elle
    // doit tomber avant la table. Relancer les scripts SQL la recrée, sur
    // `notifications` cette fois.
    this.schema.raw(`DROP MATERIALIZED VIEW IF EXISTS mv_sms_monthly_usage`)
    this.schema.raw(`DROP TABLE IF EXISTS sms_transactions`)
    this.schema.raw(`DROP TABLE IF EXISTS sms_accounts`)
  }

  /**
   * Recrée la STRUCTURE de la migration 008, avec un compte par organisation
   * portant le solde global sur la première. Le grand livre détaillé, lui,
   * est perdu depuis l'`up`.
   */
  async down() {
    this.schema.raw(`
      CREATE TABLE sms_accounts (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        provider              text NOT NULL,
        label                 text,
        balance_credits       numeric(14,2) NOT NULL DEFAULT 0,
        unit_price_amount     numeric(14,4) NOT NULL DEFAULT 0,
        currency              char(3) NOT NULL DEFAULT 'XOF',
        low_balance_threshold numeric(14,2) NOT NULL DEFAULT 100,
        is_active             boolean NOT NULL DEFAULT true,
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_sms_accounts_balance   CHECK (balance_credits >= 0),
        CONSTRAINT ck_sms_accounts_price     CHECK (unit_price_amount >= 0),
        CONSTRAINT ck_sms_accounts_threshold CHECK (low_balance_threshold >= 0)
      );
      CREATE UNIQUE INDEX uq_sms_accounts_org_provider ON sms_accounts (organization_id, provider);
      CREATE TRIGGER trg_sms_accounts_updated_at BEFORE UPDATE ON sms_accounts
        FOR EACH ROW EXECUTE FUNCTION sisbm_set_updated_at();

      CREATE TABLE sms_transactions (
        id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        sms_account_id    uuid NOT NULL REFERENCES sms_accounts (id) ON DELETE RESTRICT,
        organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
        transaction_type  text NOT NULL,
        quantity          numeric(14,2) NOT NULL,
        unit_price_amount numeric(14,4) NOT NULL DEFAULT 0,
        total_amount      numeric(14,4) NOT NULL DEFAULT 0,
        currency          char(3) NOT NULL DEFAULT 'XOF',
        balance_after     numeric(14,2) NOT NULL,
        notification_id   uuid REFERENCES notifications (id) ON DELETE SET NULL,
        reference         text,
        note              text,
        created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_sms_tx_type CHECK (transaction_type IN ('topup','consumption','adjustment','refund')),
        CONSTRAINT ck_sms_tx_balance CHECK (balance_after >= 0),
        CONSTRAINT ck_sms_tx_sign CHECK (
          (transaction_type = 'consumption' AND quantity < 0) OR
          (transaction_type IN ('topup','refund') AND quantity > 0) OR
          (transaction_type = 'adjustment')
        )
      );
      CREATE INDEX idx_sms_tx_account ON sms_transactions (sms_account_id, created_at DESC);
      CREATE INDEX idx_sms_tx_org_period ON sms_transactions (organization_id, created_at DESC);
      CREATE UNIQUE INDEX uq_sms_tx_notification ON sms_transactions (notification_id)
        WHERE notification_id IS NOT NULL;

      INSERT INTO sms_accounts (organization_id, provider, balance_credits, low_balance_threshold)
      SELECT o.id, b.provider, b.balance_credits, b.low_balance_threshold
        FROM (SELECT id FROM organizations ORDER BY created_at LIMIT 1) o
        CROSS JOIN sms_balance b;
    `)
    this.schema.raw(`DROP TABLE IF EXISTS sms_balance`)
  }
}
