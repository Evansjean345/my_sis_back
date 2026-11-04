# SISBM CORE — Immobilisation planifiée, groupes et conducteurs

**Extension du Jalon 3** — application automatique des calendriers d'utilisation au moteur,
immobilisation contrôlée d'un groupe de véhicules, conducteurs et groupes de conducteurs.

Migrations **017** (`create_schedule_enforcement_tables`) et **018** (`create_drivers_tables`).

---

## 1. Immobilisation planifiée

### 1.1 Principe

Un **calendrier** (`usage_schedules`) = un fuseau IANA + des **plages hebdomadaires**
(`schedule_windows`). Il s'applique à des véhicules (`vehicle_schedules`) et/ou à des
**groupes de véhicules** (`vehicle_schedule_groups`, nouveau), avec un **mode** :

| Mode        | Effet                                                                            |
| ----------- | -------------------------------------------------------------------------------- |
| `allowed`   | le véhicule ne roule **que** pendant les plages ; hors plage → immobilisation    |
| `forbidden` | le véhicule ne roule **pas** pendant les plages ; dans la plage → immobilisation |

Un véhicule suit **ses** calendriers et ceux de **tous ses groupes**. Ajouter un véhicule au
groupe « Livraison de nuit » suffit : il hérite du calendrier dès le passage suivant du moteur.

### 1.2 Règle de combinaison (`domain/scheduling/usage_policy.ts`)

1. une plage `forbidden` en cours → **immobilisé** (l'interdiction l'emporte) ;
2. au moins un calendrier `allowed`, aucune de ses plages en cours → **immobilisé** ;
3. sinon → **libre**.

Le véhicule roule pendant l'**union** des plages autorisées **moins** l'union des plages
interdites. Le résultat ne dépend pas de l'ordre des calendriers : empiler des règles donne
toujours la plus restrictive.

### 1.3 Plages horaires

- Jour : **0 = dimanche … 6 = samedi** (convention PostgreSQL `EXTRACT(DOW)`, CHECK existant).
  Luxon numérote 1 = lundi … 7 = dimanche : ne jamais mélanger.
- Heures `HH:MM` (ou `HH:MM:SS`), fin **exclue**. `24:00` est admis comme fin de journée.
- Une plage qui passe minuit se saisit en **deux** fenêtres : lundi `22:00-24:00` puis mardi
  `00:00-06:00` (contrainte `start_time < end_time`).
- Deux plages du même jour qui se chevauchent sont refusées (`E_SCHEDULE_WINDOWS_OVERLAP`).
- Les plages sont lues dans le **fuseau du calendrier**, jamais dans celui du serveur.
- `allowed` sans aucune plage = immobilisation permanente (utile pour préparer, attention en prod).

### 1.4 Le moteur : `node ace sisbm:schedules:enforce`

```bash
node ace sisbm:schedules:enforce --watch            # service, un passage / SCHEDULE_ENFORCE_INTERVAL_SECONDS
node ace sisbm:schedules:enforce                    # un passage (cron / systemd timer)
node ace sisbm:schedules:enforce --dry-run          # décisions affichées, rien n'est émis ni écrit
node ace sisbm:schedules:enforce --dry-run --at=2026-11-03T22:30:00Z
node ace sisbm:schedules:enforce --vehicle=<uuid>   # un véhicule
```

**Processus séparé de l'API**, comme `sisbm:ingest`. Un verrou Redis
(`sisbm:schedules:enforce:lock`) garantit qu'**une seule instance agit** ; une seconde passe son tour.

Chaque passage :

1. réconcilie les commandes en vol avec flespi (`FlespiCommandTracker.syncAll`) ;
2. lit, en **6 requêtes quelle que soit la taille de la flotte**, les calendriers applicables,
   la mémoire du moteur, la dernière commande moteur confirmée, les commandes en vol et la
   dernière intervention humaine ;
3. calcule le verdict, décide, émet si besoin, mémorise.

Aucune passerelle n'est appelée directement : les coupures passent par
`RequestImmobilization` / `RequestEngineRestore` → `DispatchEngineCommand`, **exactement le
chemin de l'opérateur**. Tous les garde-fous s'appliquent : CM-07 (vitesse), CM-09 (une commande
en vol par boîtier), relais présent, `vehicles.immobilization_enabled`, `IMMOBILIZATION_ENABLED`.
Acteur `system`, origine **`schedule`** (nouvelle valeur de `device_commands.origin`).

### 1.5 Les quatre règles de décision (`domain/scheduling/enforcement_policy.ts`)

| Règle                                        | Comportement                                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Agir sur les transitions**                 | une action n'est armée qu'à l'entrée / la sortie de plage, pas à chaque minute                                                                                                                         |
| **Insister jusqu'à l'objectif**              | la coupure reste armée jusqu'à l'**acquittement** du boîtier ; véhicule encore en mouvement (CM-07) → nouvelle tentative au passage suivant, coupure dès l'arrêt                                       |
| **Ne jamais libérer ce qu'on n'a pas coupé** | le rétablissement automatique n'a lieu que si la dernière coupure confirmée est d'origine `schedule`. Une immobilisation **manuelle** (vol, impayé) n'est **jamais** levée par l'ouverture d'une plage |
| **L'opérateur a le dernier mot**             | toute commande moteur manuelle après l'armement annule l'action en attente (dérogation) ; le moteur ne revient à la charge qu'à la transition suivante                                                 |

Délais entre tentatives : `SCHEDULE_ENFORCE_RETRY_SECONDS` (60 s) pour un refus passager
(`E_VEHICLE_IN_MOTION`, `E_NO_POSITION`, `E_COMMAND_IN_FLIGHT`…),
`SCHEDULE_ENFORCE_BACKOFF_SECONDS` (900 s) pour un refus durable (pas de relais, immobilisation
désactivée sur le véhicule, échec flespi).

Si l'émission échoue **avant l'envoi**, la commande créée est **annulée**
(`CancelEngineCommand`, nouveau cas d'usage) : une commande `approved` orpheline bloquerait le
boîtier indéfiniment (CM-09) — aucun balayage n'expire les commandes `approved`.

### 1.6 Mémoire du moteur : `vehicle_schedule_states`

Une ligne par véhicule géré : verdict (`desired_state`, `cause`, calendrier décisif), action en
attente (`pending_action`, `pending_since`, `next_attempt_at`, `attempts`), dernier refus
(`last_error_code`, `last_error_message`), dernière commande, dernière issue (`last_outcome`).
**Réécrite seulement quand elle change** : pas d'UPDATE par véhicule et par minute.

Les transitions, dérogations et coupures manuelles conservées sont tracées dans `audit_logs`
(`scheduling.enforcement.<issue>`, ressource `vehicle`) : « pourquoi ce moteur a-t-il été coupé à 22 h ? ».

### 1.7 Retrait d'un calendrier

Suppression logique ou détachement : au passage suivant, les véhicules que le moteur avait
immobilisés et qui ne relèvent plus d'aucun calendrier sont **rétablis** (`cause = no_schedule`).
Ceux qu'un opérateur a coupés restent coupés.

---

## 2. Routes — calendriers

Lecture : `vehicle:read`. **Écriture et rattachement : `policy:write`** (admin, super_admin).
Programmer des coupures automatiques est plus engageant qu'une coupure ponctuelle : l'opérateur,
qui peut couper un moteur à la main, ne programme pas de coupures. Aucune migration de rôle.

| Route                                                         | Rôle                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `GET    /api/v1/usage-schedules`                              | liste (+ plages, effectifs) `?search=&isActive=`                      |
| `POST   /api/v1/usage-schedules`                              | création, plages incluses (atomique)                                  |
| `GET    /api/v1/usage-schedules/:id`                          | détail, plages, véhicules et groupes                                  |
| `PATCH  /api/v1/usage-schedules/:id`                          | `windows`, si fourni, remplace la semaine                             |
| `DELETE /api/v1/usage-schedules/:id`                          | suppression logique                                                   |
| `PUT    /api/v1/usage-schedules/:id/windows`                  | remplace toutes les plages                                            |
| `GET    /api/v1/usage-schedules/:id/preview?at=`              | **simulation** : décision du moteur à l'instant donné                 |
| `GET/POST /api/v1/usage-schedules/:id/vehicles`               | `{ vehicleIds, mode? }` idempotent                                    |
| `DELETE /api/v1/usage-schedules/:id/vehicles/:memberId`       |                                                                       |
| `GET/POST /api/v1/usage-schedules/:id/vehicle-groups`         | `{ vehicleGroupIds, mode? }` — **calendrier de groupe**               |
| `DELETE /api/v1/usage-schedules/:id/vehicle-groups/:memberId` |                                                                       |
| `GET    /api/v1/vehicles/:id/schedule-status`                 | calendriers applicables (et leur origine), verdict, mémoire du moteur |
| `GET    /api/v1/vehicle-groups/:id/schedules`                 | calendriers appliqués au groupe                                       |

Admin (`*`) : `GET/POST /api/v1/admin/usage-schedules` (filtre `organizationId`, création avec
`organizationId` dans le corps) ; le reste réutilise les fonctions client.

Rattachement : réponse `{ applied, updated, unchanged, rejected }`. Un identifiant d'une autre
organisation ressort en `rejected`, comme un identifiant inconnu ; si rien n'est exploitable →
`422 E_TARGETS_OUT_OF_SCOPE`.

## 3. Immobilisation contrôlée d'un groupe — commande immédiate

| Route                                                      | Habilitation         |
| ---------------------------------------------------------- | -------------------- |
| `POST /api/v1/security/vehicle-groups/:id/immobilizations` | `command:immobilize` |
| `POST /api/v1/security/vehicle-groups/:id/restorations`    | `command:immobilize` |

Body : `{ "reason": "…" }`. Chaque véhicule passe par le **chemin unitaire** (`store` / `restore`,
factorisés dans `ImmobilizationController.executer`) : un véhicule qui roule est refusé (CM-07)
sans empêcher les autres. Réponse : `{ total, succeeded, failed, results: [...] }` par véhicule.
Plafond **100 véhicules** par appel (`E_GROUP_TOO_LARGE`) ; au-delà, utiliser un calendrier.
Limitation de débit `sensitive`. Tracé sous `security.vehicle_group.immobilization.requested`.

---

## 4. Conducteurs et groupes de conducteurs

### 4.1 Tables (migration 018)

- **`drivers`** : organisation, véhicule rattaché (facultatif, `ON DELETE SET NULL`), prénom, nom,
  `full_name` (colonne **générée**), téléphone E.164, e-mail, matricule, permis (numéro,
  catégories `A A1 B C D E F`, expiration), statut `active | inactive | suspended`.
  Uniques par organisation : numéro de permis, matricule. Plusieurs conducteurs peuvent partager
  un véhicule (équipes).
- **`driver_groups`** / **`driver_group_members`** : symétriques des groupes de véhicules et de
  boîtiers ; troisième famille du socle commun `GroupControllerBase`.
- Cloisonnement par trigger : conducteur ↔ véhicule (`sisbm_check_driver_vehicle_tenant`) et
  membre ↔ groupe (`sisbm_check_group_member_tenant`, nouvelle branche).

### 4.2 Routes

Habilitations `vehicle:read` / `vehicle:write` : gérer les conducteurs, c'est gérer la flotte.

| Route                                 | Rôle                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| `GET    /api/v1/drivers`              | `?search=&status=&vehicleId=&driverGroupId=&unassigned=`    |
| `POST   /api/v1/drivers`              | création (véhicule de la même organisation)                 |
| `GET    /api/v1/drivers/:id`          | fiche, véhicule, groupes                                    |
| `PATCH  /api/v1/drivers/:id`          | `null` efface un champ                                      |
| `DELETE /api/v1/drivers/:id`          | suppression logique (détaché du véhicule)                   |
| `PUT    /api/v1/drivers/:id/vehicle`  | `{ vehicleId: uuid \| null }`                               |
| `GET    /api/v1/vehicles/:id/drivers` | conducteurs d'un véhicule                                   |
| `/api/v1/driver-groups…`              | mêmes routes que `/vehicle-groups`, membres sous `/drivers` |

Admin (`*`) : `/api/v1/admin/drivers` et `/api/v1/admin/driver-groups` (`indexAll` / `storeAll`).

Le rattachement au véhicule est audité avant / après (`fleet.driver.vehicle_assigned`…) :
c'est l'historique « qui conduisait ce véhicule à telle date ».

---

## 5. Codes d'erreur ajoutés

| Code                                  | HTTP | Cause                                                  |
| ------------------------------------- | ---- | ------------------------------------------------------ |
| `E_INVALID_SCHEDULE_WINDOW`           | 422  | jour hors 0-6, heure illisible, fin ≤ début            |
| `E_SCHEDULE_WINDOWS_OVERLAP`          | 422  | deux plages du même jour se chevauchent                |
| `E_INVALID_TIMEZONE`                  | 422  | fuseau non IANA                                        |
| `E_SCHEDULE_NAME_TAKEN`               | 409  | nom de calendrier déjà utilisé (insensible à la casse) |
| `E_TARGETS_OUT_OF_SCOPE`              | 422  | aucun véhicule / groupe exploitable                    |
| `E_GROUP_EMPTY` / `E_GROUP_TOO_LARGE` | 422  | commande de groupe impossible                          |
| `E_DRIVER_LICENSE_TAKEN`              | 409  | permis déjà attribué dans l'organisation               |
| `E_DRIVER_EMPLOYEE_CODE_TAKEN`        | 409  | matricule déjà attribué                                |
| `E_VEHICLE_OUT_OF_SCOPE`              | 422  | véhicule inconnu ou d'une autre organisation           |

## 6. Configuration

```dotenv
SCHEDULE_ENFORCEMENT_ENABLED=true     # coupe le seul moteur planifié (manuel inchangé)
SCHEDULE_ENFORCE_INTERVAL_SECONDS=60
SCHEDULE_ENFORCE_RETRY_SECONDS=60
SCHEDULE_ENFORCE_BACKOFF_SECONDS=900
```

`IMMOBILIZATION_ENABLED=false` empêche le démarrage du moteur (aucune coupure ne pourrait partir).

## 7. Mise en production

1. `node ace migration:run` (017, 018) ;
2. créer les calendriers, **vérifier avec `preview`** et `--dry-run` avant de rattacher ;
3. lancer le moteur sous superviseur (PM2 / systemd), **une seule instance** :
   `node ace sisbm:schedules:enforce --watch` ;
4. garder `node ace sisbm:flespi:sync-commands` planifié ou laisser le moteur réconcilier
   (il appelle `syncAll` à chaque passage).
