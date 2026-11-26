# 11 — Socket.IO : lecture et suivi des trajets

Ce document décrit la connexion persistante Socket.IO qui permet aux tableaux de bord de lire l'historique des trajets et de suivre les trajets en cours.

Le flux SSE existant (Transmit) est conservé : il continue de diffuser les positions et l'état des boîtiers. Socket.IO s'ajoute pour les **trajets** :

- la lecture de l'historique, page par page, sur la même connexion ;
- le suivi en direct des trajets en cours.

## 1. Architecture

```
 sisbm:ingest (processus séparé)                 API (1..N instances)
 ─────────────────────────────                   ──────────────────────────────
 IngestTelemetryFrames                           Serveur HTTP AdonisJS :3333
   └─ trajet ouvert / points / clôture             └─ Socket.IO  /socket.io  espace /trips
        │  (après COMMIT)                                 │
        ▼                                                 │  passerelle (presentation/realtime)
 CompositeBroadcaster                                     │    → ListTrips, GetTrip,
   ├─ TransmitBroadcaster (SSE, inchangé)                 │      ReadTripPoints, FollowVehicles
   └─ SocketIoBroadcaster ── @socket.io/redis-emitter ──▶ Redis ──▶ @socket.io/redis-adapter
                                                                      → connexions des salles
```

- **Couche domaine.**
  - Le référentiel `domain/telemetry/code_legacy/trip/` contient les types, les limites et les types de mises à jour en direct.
  - `trip_reading_policy.ts` ne contient que des fonctions (période, bornes, cloisonnement, instantané).
- **Couche application.**
  - Le port `TripReader` décrit la lecture.
  - Quatre cas d'usage : `ListTrips`, `GetTrip`, `ReadTripPoints` et `FollowVehicles`.
  - Le port `RealtimeBroadcaster` gagne `publishTrip`.
  - L'ingestion publie les trajets **après le COMMIT** : un trajet annulé par un ROLLBACK n'est jamais annoncé.
- **Couche infrastructure.**
  - Le serveur Socket.IO (`socket_io_server.ts`) et l'émetteur (`socket_io_broadcaster.ts`).
  - L'authentification par jeton (`socket_authenticator.ts`).
  - Le lecteur SQL (`persistence/readers/trip_reader.ts`).
  - Le contrat commun des événements et des salles (`socket_contract.ts`).
- **Couche présentation.** La passerelle `realtime/trip_gateway.ts` joue le rôle d'un contrôleur : authentification, habilitation, validation, puis acquittement.
- **Démarrage.**
  - `providers/socket_provider.ts` démarre Socket.IO avec le serveur HTTP (environnement `web` seulement).
  - Les commandes `ace` et les tests n'ouvrent aucun serveur.

## 2. Connexion

```ts
import { io } from 'socket.io-client'

const socket = io(`${API_URL}/trips`, {
  path: '/socket.io',
  auth: { token }, // jeton de POST /api/v1/auth/login (sisbm_…)
  transports: ['websocket', 'polling'],
})

socket.on('connect_error', (err) => {
  // err.data?.code : E_UNAUTHORIZED | E_FORBIDDEN | E_INTERNAL
})
```

Règles d'accès :

- **Jeton.** Le jeton passe dans `auth.token`, jamais dans l'URL : il n'apparaît donc pas dans les journaux de Nginx. Les outils en ligne de commande peuvent aussi envoyer l'en-tête `Authorization: Bearer …`.
- **Habilitation.** Il faut `vehicle:read`. Les trois rôles l'ont : super admin, admin et opérateur.
- **Compte d'organisation.** Il ne voit que son organisation. Il rejoint d'office la salle `org:<id>`, qui reçoit l'ouverture et la clôture des trajets.
- **Exploitant de la plateforme (joker `*`).** Il voit tout et choisit les organisations qu'il suit.
- **Fin de session.** Le jeton est revérifié toutes les 60 s (`SOCKET_IO_SESSION_CHECK_SECONDS`). Une déconnexion, une suspension ou un rôle réduit ferme la connexion ouverte, avec l'événement `session:ended` `{ code, message }`. C'est aussi le cas à l'expiration du jeton (7 jours).

## 3. Demandes : toutes avec acquittement

La réponse est `{ data }` en cas de succès, ou `{ error: { code, message, details? } }` sinon. C'est le même format d'erreur que l'API HTTP.

```ts
const r = await socket.timeout(5000).emitWithAck('trips:list', { from, to })
if ('error' in r) toast.error(r.error.message)
```

| Événement | Charge | Réponse `data` |
|---|---|---|
| `trips:list` | `{ from, to, vehicleId?, status?, page?, perPage?, organizationId? }` | `{ data: TripSummary[], meta: { total, page, perPage } }` |
| `trip:get` | `{ tripId }` | `TripSummary` |
| `trip:points` | `{ tripId, after?, limit? }` | `{ tripId, points: TripPoint[], nextCursor, done }` |
| `vehicles:follow` | `{ vehicleIds }` | `{ accepted, rejected, following }` |
| `vehicles:unfollow` | `{ vehicleIds }` | `{ following }` |
| `organization:follow` | `{ organizationId }` | exploitant seulement |
| `organization:unfollow` | `{ organizationId }` | exploitant seulement |

Détail des paramètres :

- **`trips:list`.**
  - Elle rend les trajets qui **chevauchent** la période : un trajet commencé la veille et encore en cours y figure.
  - La période dure 31 jours au plus, sinon l'erreur `E_INVALID_TRIP_RANGE` est renvoyée.
  - Il y a 25 trajets par page par défaut, 100 au plus.
  - Seul l'exploitant peut passer `organizationId`.
- **`trip:points`.**
  - Le tracé se lit par curseur : repassez `nextCursor` dans `after` jusqu'à `done: true`.
  - Une page contient 500 points par défaut, 2 000 au plus.
  - Une lecture interrompue (réseau mobile) reprend là où elle s'est arrêtée.
  - Seuls les points valides du boîtier du trajet sont lus.
- **`vehicles:follow`.**
  - Il est limité à 200 véhicules par connexion.
  - Un véhicule d'un autre client ressort dans `rejected`.

Un trajet d'un autre client répond `E_NOT_FOUND`, comme un identifiant inconnu : son existence même n'est pas révélée.

### Lire un trajet complet

```ts
async function lireTrace(tripId: string) {
  const points: TripPoint[] = []
  let after: string | undefined
  for (;;) {
    const r = await socket.timeout(10000).emitWithAck('trip:points', { tripId, after, limit: 1000 })
    if ('error' in r) throw new Error(r.error.message)
    points.push(...r.data.points)
    if (r.data.done) return points
    after = r.data.nextCursor
  }
}
```

## 4. Direct

| Événement | Salles | Charge `TripLiveUpdate` |
|---|---|---|
| `trip:started` | `org:<id>` et `vehicle:<id>` | `{ type, trip, points: [] }` |
| `trip:progress` | `vehicle:<id>` seulement | `{ type, trip, points: [nouveaux points] }` |
| `trip:closed` | `org:<id>` et `vehicle:<id>` | `{ type, trip, points: [] }` |

`trip` donne l'état du trajet au moment de la mise à jour : distance, vitesse maximale et moyenne, nombre de points, statut et motif de clôture.

Les points ne vont qu'aux écrans qui **suivent le véhicule** (`vehicles:follow`). Une liste de flotte ne reçoit que les ouvertures et les clôtures.

Pour afficher un trajet en cours sans trou, procédez dans cet ordre :

1. Lancez `vehicles:follow`.
2. Lisez le tracé avec `trip:points` jusqu'à `done`.
3. Ajoutez ensuite les points de `trip:progress`, en ignorant ceux dont `recordedAt` est inférieur ou égal au dernier point lu.

À la reconnexion, Socket.IO ne rejoue pas les événements manqués. Rappelez `vehicles:follow`, puis relisez avec `trip:points` depuis le dernier point affiché.

## 5. Déploiement (Docker + Nginx)

Les services `api` et `ingest` utilisent déjà le même Redis : rien à changer dans `docker-compose.yml`.

Nginx doit relayer la mise à niveau WebSocket. À ajouter dans le bloc `server` de `api.sisbm-core.com` :

```nginx
location /socket.io/ {
    proxy_pass         http://127.0.0.1:3333;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    # Supérieur au battement de cœur (25 s + 20 s) : Nginx ne coupe pas une connexion vivante.
    proxy_read_timeout 75s;
    proxy_send_timeout 75s;
}
```

**Plusieurs instances de l'API.** L'adaptateur Redis partage les salles entre instances. En revanche, le repli long-polling exige des sessions collantes : ajoutez `ip_hash;` dans le bloc `upstream`. Sinon, limitez les clients à `transports: ['websocket']`. Une seule instance n'a besoin d'aucun réglage.

## 6. Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `SOCKET_IO_ENABLED` | `true` | désactiver Socket.IO sans toucher au code |
| `SOCKET_IO_PATH` | `/socket.io` | chemin du serveur (le même côté client) |
| `SOCKET_IO_CORS_ORIGIN` | `*` | origines autorisées, séparées par des virgules (ex. `https://admin.sisbm-core.com,https://client.sisbm-core.com`) |
| `SOCKET_IO_SESSION_CHECK_SECONDS` | `60` | revérification des jetons des connexions ouvertes |

La connexion Redis `realtime` (dans `config/redis.ts`) n'a pas de `keyPrefix` : l'API et l'ingestion doivent publier et écouter exactement les mêmes canaux.

## 7. Vérifications

- **Tests unitaires** (`tests/unit/trip_reading.spec.ts`) :
  - les règles de lecture ;
  - les cas d'usage ;
  - la diffusion pendant l'ingestion (ouverture, points, clôture, dans cet ordre) ;
  - l'absence de diffusion si le COMMIT échoue ;
  - l'isolation des diffuseurs.
- **Scénario réel avec `socket.io-client`** :
  - connexion refusée sans jeton ;
  - lecture paginée ;
  - cloisonnement entre clients ;
  - suivi en direct pendant une **ingestion réelle lancée dans un autre processus** ;
  - fermeture de la connexion après une déconnexion HTTP ;
  - repli long-polling ;
  - réception sur une **seconde instance** de l'API.
