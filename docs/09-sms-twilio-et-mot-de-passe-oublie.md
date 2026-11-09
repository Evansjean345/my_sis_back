# SISBM CORE — SMS (Twilio), notifications de compte et mot de passe oublié

Trois fonctionnalités sur un socle commun :

| Fonctionnalité                       | Déclencheur                                  | Canal                         |
| ------------------------------------ | -------------------------------------------- | ----------------------------- |
| SMS « votre compte a été créé »      | événement `identity.user.created`            | outbox → `sisbm:outbox:dispatch` |
| SMS « votre compte a été suspendu »  | événement `identity.user.suspended`          | outbox → `sisbm:outbox:dispatch` |
| Mot de passe oublié par code SMS     | `POST /auth/password/forgot`                 | direct (l'utilisateur attend) |
| SMS « mot de passe modifié » (alerte) | événement `identity.user.password_reset`    | outbox → `sisbm:outbox:dispatch` |

Migration **020** (`create_otps_table`).

---

## 1. Architecture

```
presentation ── AuthController (/auth/password/*) ── UserController.suspend ── SmsController (admin)
      │                                                                    └─ TwilioWebhookController
      ▼
application ── RequestPasswordReset ─┐   SuspendUserAccount ─(événement)─▶ outbox
               VerifyPasswordResetCode│                                       │
               ResetPassword ─────────┤ OtpVerifier                           ▼
                                      └──────────────▶ SmsSender ◀── IdentitySmsNotifications
                                                          │   (solde + journal + passerelle)
      ▼                                                   ▼
infrastructure ── LucidOtpRepository · LucidNotificationJournal · LucidSmsBalanceLedger
                  TwilioSmsGateway · TwilioAccountGateway · LogSmsGateway · OutboxDispatcher
domain ── otp_policy (tentatives, expiration, renvoi) · sms_message (segments GSM-7/UCS-2) · sms_templates
```

**`SmsSender` est le point de passage unique de tout SMS** : il réserve la ligne
`notifications`, débite `sms_balance` (atomique, jamais négatif), appelle la passerelle hors
transaction, puis marque `sent` ou `failed` (avec recrédit). Les futures alertes SMS (Jalon
alertes) passeront par lui.

### 1.1 Pourquoi l'outbox pour les SMS de compte

Les événements `identity.*` étaient déjà écrits dans `outbox_messages` dans la transaction de
création — mais rien ne les consommait. Le dispatcher (`app/infrastructure/messaging/
outbox_dispatcher.ts`) est la moitié manquante du pattern :

- un SMS ne part **jamais** pour un compte dont la création ou la suspension a été annulée ;
- une panne Twilio ou un solde vide n'échoue pas la requête de l'administrateur : le message
  est **reporté** (délai exponentiel, 8 essais par défaut) ;
- `SKIP LOCKED` : plusieurs workers peuvent tourner sans doublon ;
- seuls les topics d'un handler enregistré sont réservés ; les événements de télémétrie
  restent `pending` pour leur futur consommateur.

**Idempotence** : `notifications.dedup_key = <topic>:<id outbox>` (index unique existant
`uq_notifications_dedup`). Un message rejoué après une panne ne produit pas un second SMS.

### 1.2 Suspension promue en cas d'usage

`POST /users/:id/suspend` et `POST /admin/users/:id/suspend` passent désormais par
`SuspendUserAccount` : statut + révocation des sessions + événement, en une transaction, avec
une trace `identity.user.suspended` dans `audit_logs` (absente jusqu'ici). Réponse HTTP
**inchangée**. Un compte déjà suspendu ne génère ni événement ni SMS.

---

## 2. Mot de passe oublié

### 2.1 Parcours

```
POST /api/v1/auth/password/forgot   { "phone": "+2250161899990" }          → 202 (toujours)
POST /api/v1/auth/password/verify   { "phone": "...", "code": "123456" }   → 200 | 422 | 429
POST /api/v1/auth/password/reset    { "phone": "...", "code": "123456",
                                      "password": "...", "password_confirmation": "..." } → 204
```

`verify` est facultatif (confort d'écran) : il ne consomme pas le code, mais ses échecs
comptent sur le même plafond que `reset`.

Formats de numéro acceptés (normalisés en E.164) : `+2250161899990`, `+225 01 61 89 99 90`,
`00225…`, `0161899990` (indicatif `SMS_DEFAULT_DIAL_CODE`, 225 par défaut).

### 2.2 Règles de sécurité

| Règle                         | Valeur par défaut | Variable                       |
| ----------------------------- | ----------------- | ------------------------------ |
| Longueur du code              | 6 chiffres        | `OTP_LENGTH`                   |
| Durée de vie                  | 10 min            | `OTP_TTL_SECONDS`              |
| Tentatives par code           | 5                 | `OTP_MAX_ATTEMPTS`             |
| Délai entre deux envois       | 60 s              | `OTP_RESEND_COOLDOWN_SECONDS`  |
| Codes par heure et par compte | 5                 | `OTP_MAX_PER_HOUR`             |
| Demandes par IP               | 5 / 15 min        | `start/limiter.ts` (`otpRequest`) |
| Saisies par IP                | 10 / 15 min       | `start/limiter.ts` (`otpVerify`)  |

- **Non-divulgation** : `forgot` répond 202 avec le même corps que le numéro existe ou non,
  que le compte soit suspendu, que le délai de renvoi soit écoulé ou non. `verify`/`reset`
  répondent `E_OTP_INVALID` pour un numéro inconnu comme pour un code faux.
- **Code jamais stocké en clair** : `otps.code_hash = HMAC-SHA256(code, dérivée d'APP_KEY)`.
  Dans `notifications.body`, le code est masqué (`******`).
- **Un seul code actif** par compte (index `uq_otps_active`) ; un nouveau code invalide le
  précédent. Tentatives comptées **sous verrou** (`FOR UPDATE`).
- **Réinitialisation** : mot de passe changé, compteur d'échecs et verrouillage levés,
  **toutes les sessions révoquées**, code consommé — en une transaction — puis SMS d'alerte
  au titulaire. Un compte **suspendu n'est pas réactivé**.

### 2.3 Codes d'erreur

| Code                       | HTTP | Sens                                              |
| -------------------------- | ---- | ------------------------------------------------- |
| `E_OTP_INVALID`            | 422  | code faux / inconnu — `details.remainingAttempts` |
| `E_OTP_EXPIRED`            | 422  | code expiré : en redemander un                    |
| `E_OTP_ATTEMPTS_EXCEEDED`  | 429  | plafond atteint, code invalidé                    |
| `E_SELF_SUSPEND`           | 409  | (inchangé) auto-suspension                        |

---

## 3. Twilio

### 3.1 Configuration (`.env`)

```
SMS_PROVIDER=twilio                 # log = console (dev), interdit en production
TWILIO_ACCOUNT_SID=AC…              # dans l'URL
TWILIO_API_KEY_SID=SK…              # authentification Basic
TWILIO_API_KEY_SECRET=…
TWILIO_FROM=SISBM                   # Sender ID alphanumérique (11 car. max)
TWILIO_AUTH_TOKEN=…                 # uniquement pour vérifier les webhooks
TWILIO_STATUS_CALLBACK_URL=https://<api publique>/api/v1/webhooks/twilio/sms-status
```

Corrections par rapport aux requêtes Insomnia :

1. l'URL porte le SID du **compte** (`/Accounts/AC…/Messages.json`), la clé `SK…` ne sert qu'à
   l'authentification ;
2. l'essai WhatsApp a reçu `401 / 20003` parce que la clé était envoyée comme **nom**
   d'en-tête ; le client envoie `Authorization: Basic base64(SK…:secret)` ;
3. un POST n'est rejoué que sur **429** (message non créé) ; jamais sur 5xx ou délai dépassé
   (le SMS a pu partir : on n'envoie pas deux codes).

### 3.2 Sender ID en Côte d'Ivoire

Twilio exige un **Sender ID pré-enregistré** pour la Côte d'Ivoire ; un ID non enregistré est
envoyé « au mieux », peut être remplacé par un expéditeur générique, ou rejeté (erreur
**30018**). Le statut `queued` renvoyé à l'envoi ne prouve donc **pas** la remise : configurer
`TWILIO_STATUS_CALLBACK_URL` pour recevoir `delivered` / `undelivered` dans `notifications`.

### 3.3 WhatsApp

Non branché dans cette livraison. L'expéditeur `whatsapp:SISBM CORE` de l'essai n'est pas
valide : WhatsApp exige un **numéro** WhatsApp Business rattaché au compte Twilio, et un
message initié par l'entreprise (OTP, alerte) exige un **modèle approuvé** (Content SID). Les
tables (`notifications.channel`, `otps.channel`) acceptent déjà `whatsapp`.

### 3.4 Solde

| Solde                       | Unité        | Rôle                                         | Lecture                       |
| --------------------------- | ------------ | -------------------------------------------- | ----------------------------- |
| `sms_balance` (plateforme)  | crédits = segments | ce que SISBM s'autorise à consommer     | `GET /admin/sms/balance`      |
| Compte Twilio               | USD          | ce que Twilio acceptera d'envoyer            | idem, bloc `provider`         |

Recharge des crédits : `POST /admin/sms/topup { credits, reference?, note? }` (trace
`sms.topup`). `SMS_ENFORCE_BALANCE=false` désactive le débit (recette uniquement).

Un SMS de 160 caractères GSM-7 = 1 crédit ; un seul caractère hors alphabet GSM (ê, ç, ô,
« », emoji) fait passer le message en UCS-2 (70 caractères) — les modèles
(`domain/notification/sms_templates.ts`) sont testés pour rester en GSM-7.

---

## 4. Exploitation

```bash
node ace migration:run                       # migration 020 (+ régénère database/sql/schema/otps.ts)
node ace sisbm:outbox:dispatch --watch       # NOUVEAU processus (pm2 / systemd), à côté de sisbm:ingest
```

Purge des codes expirés (à planifier, quotidienne) :

```sql
SELECT sisbm_purge_otps();                   -- supprime les codes expirés depuis plus de 7 jours
```

Diagnostic :

```sql
-- SMS des dernières 24 h
SELECT template_code, status, error_message, queued_at FROM notifications
 WHERE channel = 'sms' AND queued_at > now() - interval '1 day' ORDER BY queued_at DESC;
-- événements en attente / en échec
SELECT topic, status, attempts, last_error FROM outbox_messages
 WHERE topic LIKE 'identity.%' AND status <> 'published';
```

En développement, `SMS_PROVIDER=log` écrit les SMS (code OTP compris) dans la console : aucun
crédit Twilio n'est consommé, mais `sms_balance` est débité si `SMS_ENFORCE_BALANCE=true`.
