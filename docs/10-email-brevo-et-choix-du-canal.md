# SISBM CORE — E-mails (Brevo) et choix du canal du code

Suite de `docs/09-sms-twilio-et-mot-de-passe-oublie.md`. Migration **021**
(`extend_otps_for_email`).

## 1. Ce qui change pour l'utilisateur

« Mot de passe oublié » : l'utilisateur saisit **son e-mail ou son téléphone** et **choisit le
canal** de réception du code — SMS (Twilio) ou e-mail (Brevo).

```
POST /api/v1/auth/password/forgot   { "identifier": "evans@sisbm.ci", "channel": "email" }   → 202
POST /api/v1/auth/password/verify   { "identifier": "...", "code": "123456" }                → 200 | 422 | 429
POST /api/v1/auth/password/reset    { "identifier": "...", "code": "...",
                                      "password": "...", "password_confirmation": "..." }    → 204
```

- `identifier` : e-mail **ou** téléphone (`+225…`, `0161…`, `00225…`). `email` et `phone` restent
  acceptés à la place (`{ "phone": … }` = format de la première version, inchangé).
- `channel` : `sms` | `email`. Absent → le canal de l'identifiant (e-mail → e-mail, téléphone → SMS).
- Le canal choisit l'adresse **parmi celles du compte** : saisir son e-mail et demander `sms`
  envoie le code au téléphone enregistré — jamais à une adresse fournie dans la requête.
- La réponse 202 porte `channel` (pour le message du front) et reste identique que le compte
  existe ou non. Canal `sms` sur un compte sans téléphone : même réponse, rien ne part (trace
  d'audit `identity.password_reset.no_recipient`).
- Délai de renvoi et quota horaire sont **communs aux deux canaux** : passer de SMS à e-mail ne
  les contourne pas. Un nouveau code (quel que soit le canal) invalide le précédent.
- `verify` / `reset` acceptent n'importe quel identifiant du compte : code reçu par e-mail,
  saisie du téléphone à l'écran suivant → accepté.
- L'alerte « mot de passe modifié » part **par le canal du code utilisé** (e-mail si le code a
  été reçu par e-mail).

## 2. Architecture

```
RequestPasswordReset ─┐                      ┌─ SmsSender ── TwilioSmsGateway | LogSmsGateway
IdentityNotifications ┴─ NotificationDispatcher ┤   (solde sms_balance)
       (outbox)          (le canal décide)    └─ EmailSender ── BrevoEmailGateway | LogEmailGateway
                                                    (pas de solde plateforme)
domain/notification/channel_messages.ts  ← un fait métier, un modèle par canal
domain/notification/email_templates.ts   ← HTML + texte, données échappées, code masqué au journal
```

- `NotificationDispatcher` : point d'entrée unique ; un futur canal (WhatsApp) s'y ajoute sans
  toucher aux cas d'usage.
- Journal commun : `notifications` (`channel = 'email'`, `subject`, `provider = 'brevo'`,
  `provider_message_id = messageId Brevo`), même idempotence (`dedup_key`).
- Le handler `identity_sms_notifications.ts` devient `identity_notifications.ts`
  (`IdentityNotifications`) : création et suspension restent par SMS.

## 3. Brevo

```
MAIL_PROVIDER=brevo                 # log = console (dev), interdit en production
BREVO_API_KEY=xkeysib-…             # clé API v3 — jamais commitée
MAIL_FROM_EMAIL=no-reply@sisbm.ci   # expéditeur VÉRIFIÉ dans Brevo
MAIL_FROM_NAME=SISBM CORE
MAIL_REPLY_TO=support@sisbm.ci      # facultatif
```

- Appel : `POST https://api.brevo.com/v3/smtp/email`, en-tête `api-key`, corps JSON (`sender`,
  `to`, `subject`, `htmlContent`, `textContent`, `tags`, `replyTo`, en-tête `X-Sisbm-Ref` =
  id de la ligne `notifications`). Réponse 201 `{ messageId }`.
- Réessai : POST rejoué **uniquement** sur 429 ; jamais sur 5xx / délai dépassé (l'e-mail a pu
  partir).
- **Expéditeur** : l'adresse doit être vérifiée dans Brevo (*Senders, Domains & Dedicated IPs*)
  et le domaine `sisbm.ci` authentifié (SPF + DKIM, enregistrements DNS fournis par Brevo).
  Sans cela, refus de Brevo ou classement en indésirables.
- Au démarrage de chaque processus : `[email] passerelle : brevo` / `[sms] passerelle : twilio`
  dans les journaux — vérifier ces lignes si « rien ne part ».

## 4. Exploitation

```bash
node ace migration:run                    # 021 : otps accepte channel = 'email'
# relancer l'API ET node ace sisbm:outbox:dispatch --watch après changement du .env
```

Diagnostic :

```sql
SELECT queued_at, channel, provider, status, provider_message_id, error_message
  FROM notifications ORDER BY queued_at DESC LIMIT 10;
```

| `error_message`             | Cause                                  |
| --------------------------- | -------------------------------------- |
| `E_EMAIL_NOT_CONFIGURED`    | `BREVO_API_KEY` ou `MAIL_FROM_EMAIL` vide |
| `brevo:unauthorized`        | clé API invalide / révoquée            |
| `brevo:invalid_parameter`   | expéditeur non vérifié, adresse refusée |
| `brevo:http_429`            | débit dépassé (un nouvel essai est fait) |

Non inclus : webhooks de délivrabilité Brevo (`delivered`, `hard_bounce`, `spam`…) vers
`notifications.delivered_at` — même principe que le webhook Twilio, à ajouter si besoin.
