# Salles, sports CrossFit/Hyrox, WODs de coach et app mobile complète — design

Date : 2026-09-27 · Statut : proposé · Réf. : `docs/ARCHITECTURE.md`

## 0. Intention

**Demandé par l'utilisateur**
- Une liste des salles de sport et un profil de salle avec logo (ex. « Bodynade »).
- Les sports CrossFit et Hyrox, complets (séances, records, scoring, salles).
- Un coach peut créer des WODs personnalisés dans la ligue de sa salle.
- Terminer l'app mobile (tous les écrans manquants) avec une UI améliorée, puis la voir tourner.
- Terminer le backend (phase 2 : médias, Gym Wars/défis/badges, fil social, push/temps réel).

**Hypothèses (validées pendant le brainstorming)**
- Salles de démo fictives, logos originaux générés (aucune marque réelle).
- Un score de WOD de coach compte pour le classement de la salle + l'XP d'une séance, jamais pour les records ni la ligue nationale.
- Les scores de WOD sont acceptés automatiquement ; le coach peut invalider (audité).
- Stockage des fichiers : disque local en dev, S3/MinIO en prod (Docker n'est pas actif localement).

**Découpage**
- **Ce document** : sous-projet A (salles, médias, sports, WODs de coach) + sous-projet B (app mobile complète et refonte UI).
- **Plus tard, spec séparée** : sous-projet C, backend phase 2 hors médias (Gym Wars, défis/badges, fil d'activité, push FCM, Socket.IO).

**Critères de réussite**
- L'app web (vue mobile) montre la liste des salles avec logos, le profil Bodynade, ses WODs et leur classement.
- Un utilisateur peut enregistrer un WOD CrossFit « for time » et une course Hyrox, et voir un record personnel.
- Un coach de démo peut créer un WOD et invalider un score.
- Tous les endpoints du backend phase 1 ont un écran mobile.
- Tests unitaires, d'intégration (API) et de widgets (mobile) verts ; lint et typecheck propres.

## 1. Backend — médias et logos

**Stockage** : `StorageService` (`put(key, bytes, mime)`, `url(key)`, `delete(key)`), deux pilotes choisis par `STORAGE_DRIVER` :
- `local` (défaut en dev) : fichiers dans `apps/api/storage/` (ignoré par git), servis par `GET /media/*` avec `Cache-Control: public, max-age=31536000, immutable` (les clés contiennent un hash, donc un nouveau logo = nouvelle clé).
- `s3` : SDK S3 v3 vers MinIO/S3 (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `MEDIA_PUBLIC_BASE_URL`).

**Schéma** : `MediaPurpose` += `GYM_LOGO`. `Gym.logoMediaId` existe déjà (ajout de la relation vers `Media`).

**Endpoints**
- `PUT /gyms/:id/logo` (multipart, champ `file`) : gérant de la salle ou staff. Types acceptés PNG/JPEG/WebP, 2 Mo max, contrôle par les octets magiques (pas seulement le `Content-Type`). Redimensionnement en carré 512×512 WebP via `sharp`. L'ancien média passe en `DELETED` et son fichier est supprimé. Audit `GYM_LOGO_UPDATED`.
- `DELETE /gyms/:id/logo`.
- `GET /gyms`, `GET /gyms/:id` : ajout de `logoUrl` (ou `null`).

**Dépendances nouvelles** : `sharp`, `@aws-sdk/client-s3`, `multer` (adaptateur Express, déjà utilisé par Nest ici) ; côté mobile `image_picker`, `cached_network_image`.

**Erreurs** : problem+json existant (`413` trop gros, `415` type refusé, `403` pas gérant).

## 2. Backend — liste des salles

`GET /gyms` gagne `q` (recherche insensible à la casse et aux accents sur le nom : la migration active l'extension `unaccent`, requête `unaccent(name) ILIKE unaccent('%q%')` avec échappement de `%` et `_`), `sport` (code de sport) et `sort=name|members` (défaut `name`). La pagination par curseur signé reste inchangée ; pour `sort=members`, le curseur encode `(membersCount, id)`.

Réponse par salle : `id`, `name`, `slug`, `city`, `governorate`, `status`, `logoUrl`, `sports[]` (`code`, `name`, `icon`), `membersCount`, `level`.

`GET /gyms/:id` ajoute : `addressLine`, `socialLinks` (le téléphone et l'email restent privés, règle existante testée dans `gyms.int-spec.ts`), `rank` (rang de la salle au classement des salles de la saison, calculé par la somme des LP des membres, `null` si aucun), `topMembers` (5 premiers du classement salle), `myMembership` (`NONE | PENDING | APPROVED`, rôle `MEMBER | COACH`), `canManage`.

## 3. Backend — sports CrossFit et Hyrox

**Schéma**
- Table `gym_sports` (`gym_id`, `sport_id`, PK composite). `CreateGymDto` / `UpdateGymDto` : `sportIds?: string[]` (1 à 10, sports actifs).
- Métrique `FINISH_TIME` (unité `s`, `LOWER_IS_BETTER`).
- Exercices : colonnes nouvelles `group` (optionnelle, `MOVEMENT | BENCHMARK_WOD | HYROX_STATION | HYROX_RACE`, pour grouper la saisie mobile) et `description_i18n` (JSON, défaut `{}`). `GET /reference/exercises` renvoie les deux.

**Catalogue** (`infra/seed-data/catalog.json`, seed idempotent)
- Sport `HYROX` (`FUNCTIONAL`, `MIXED`, icône `hyrox`, fr/en/ar).
- CrossFit, mouvements : `THRUSTER`, `CLEAN_AND_JERK`, `SNATCH`, `KETTLEBELL_SWING` (charge → `MAX_WEIGHT`, `E1RM`, `REPS_AT_WEIGHT`) ; `WALL_BALL`, `BOX_JUMP`, `DOUBLE_UNDER`, `TOES_TO_BAR`, `PULL_UP`, `MUSCLE_UP` (→ `MAX_REPS`). Les exercices déjà présents sont réutilisés, pas dupliqués.
- CrossFit, WODs de référence : `WOD_FRAN`, `WOD_GRACE`, `WOD_HELEN`, `WOD_DIANE`, `WOD_ISABEL`, `WOD_MURPH` (→ `FINISH_TIME`) ; `WOD_CINDY` (AMRAP 20 min, total de répétitions → `MAX_REPS`). Description en fr/en/ar dans `description_i18n`.
- Hyrox, course : `HYROX_OPEN`, `HYROX_PRO` (→ `FINISH_TIME`).
- Hyrox, stations (→ `FINISH_TIME`) : `HYROX_SKIERG_1000`, `HYROX_SLED_PUSH`, `HYROX_SLED_PULL`, `HYROX_BURPEE_BROAD_JUMP`, `HYROX_ROW_1000`, `HYROX_FARMERS_CARRY`, `HYROX_SANDBAG_LUNGES`, `HYROX_WALL_BALLS`, `HYROX_RUN_1K`.

**Saisie** : un exercice `FINISH_TIME` se saisit comme **une série** avec `durationS`. Une course Hyrox complète = un exercice `HYROX_OPEN`/`HYROX_PRO` (temps total) + optionnellement les stations (temps intermédiaires).

**Scoring** (`engine/observations.ts`)
- Si l'exercice suit `FINISH_TIME` et qu'une série a `durationS > 0` : observation `FINISH_TIME = durationS` (meilleur = plus bas).
- `lowerIsBetter` se base sur la direction de la métrique (`MetricDirection`), plus sur le préfixe du code.
- `FINISH_TIME` s'ajoute à `XP_METRICS` et à `PR_PRIORITY` (après `TIME_21K`).

**Anti-triche** : plausibilité par exercice `{"hold_s": X, "reject_s": Y}` pour `FINISH_TIME` (en dessous de `reject_s` = refusé, en dessous de `hold_s` = modération). Valeurs : `HYROX_OPEN` 3300/3000, `HYROX_PRO` 3400/3100, `WOD_FRAN` 120/100, `WOD_GRACE` 75/60, `WOD_HELEN` 390/330, `WOD_MURPH` 1980/1800, `WOD_DIANE` 110/90, `WOD_ISABEL` 60/50 ; stations : 60 % du record connu = reject, 75 % = hold. Pour `WOD_CINDY` : `MAX_REPS` hold 700 / reject 900.

**Règles v2** (`infra/seed-data/ruleset-v2.json`) : copie de la v1 + progression attendue `FINISH_TIME` sur 28 jours : débutant −4 %, intermédiaire −1,5 %, avancé −0,5 % ; `changeNote` explicite. La v1 n'est pas modifiée (règles jamais rétroactives). Le seed active la v2.

## 4. Backend — coachs et WODs de salle

**Schéma**
- `GymMember.role` : enum `GymMemberRole { MEMBER, COACH }`, défaut `MEMBER`.
- `gym_wods` : `id`, `gym_id`, `created_by`, `title` (3–80), `description` (1–2000), `score_type` (`FOR_TIME | AMRAP | MAX_LOAD`), `time_cap_s?`, `starts_at`, `ends_at`, `status` (`DRAFT | PUBLISHED | ARCHIVED`), `sport_id?`, timestamps. Index `(gym_id, status, ends_at)`.
- `gym_wod_scores` : `id`, `wod_id`, `user_id`, `division` (`RX | SCALED`), `value` (numeric : secondes, répétitions totales ou kg), `rounds?`, `reps?`, `workout_id`, `status` (`VALID | INVALIDATED`), `invalidated_by?`, `invalidation_reason?`, timestamps. Unique `(wod_id, user_id)`. Index `(wod_id, division, status, value)`.

**Droits**
- Coach = membre `APPROVED` avec `role = COACH`, ou gérant de la salle, ou staff.
- Nommer/retirer : `POST|DELETE /gyms/:id/members/:userId/coach` (gérant ou staff ; la cible doit être membre approuvé). Audit.
- WODs visibles et scores soumis uniquement par les membres approuvés ; `DRAFT` visible seulement des coachs.

**Endpoints**
- `POST /gyms/:id/wods`, `PATCH /gyms/:id/wods/:wodId` (coach). `ends_at > starts_at`, durée ≤ 31 jours.
- `GET /gyms/:id/wods?when=active|upcoming|past` (curseur), `GET /gyms/:id/wods/:wodId`.
- `PUT /gyms/:id/wods/:wodId/score` (membre) : `{ division, timeS? | rounds?+reps? | loadKg?, performedAt, clientId }`.
  - Refus hors fenêtre (`409 WOD_CLOSED`), refus si `FOR_TIME` et `timeS > time_cap_s`.
  - Garde le meilleur score (selon le type) ; un nouveau score moins bon est accepté comme séance mais ne remplace pas le classement.
  - Crée une séance `workoutType = GYM_WOD` (idempotente par `clientId`) avec la durée réelle (ou le time cap / 20 min pour l'AMRAP), qui passe l'anti-triche de couche 1 et reçoit l'XP normale. Aucune observation de métrique (donc aucun PR, aucun LP national).
- `GET /gyms/:id/wods/:wodId/leaderboard?division=RX|SCALED` (curseur) + `.../leaderboard/me`. Tri : `FOR_TIME` croissant, `AMRAP` et `MAX_LOAD` décroissants ; égalités départagées par la date de soumission.
- `POST /gyms/:id/wods/:wodId/scores/:scoreId/invalidate` (coach) `{ reason }` : statut `INVALIDATED`, écriture inverse de l'XP dans le ledger, notification in-app au membre, audit.

## 5. Mobile — refonte UI

**Direction** : garder l'identité actuelle (graphite sombre d'abord, accent citron `#C6F432`, gros chiffres) et la rendre plus riche et cohérente.
- **Typographie** : police display `Barlow Condensed` (titres, chiffres) + `Inter` (texte), embarquées dans `assets/fonts` (pas de téléchargement à l'exécution).
- **Kit de composants** (`core/widgets/`) : `StatTile`, `SectionHeader`, `GymLogo` (image réseau + repli initiales sur couleur dérivée du nom), `SportChip`, `AvatarBadge` (avatar + division), `DivisionBadge`, `SkeletonList`, `EmptyState` (icône + texte + action), `TimeField` (`mm:ss` / `h:mm:ss`), `CountdownText`, `RankRow` (ligne de classement avec position, avatar, valeur, surlignage « moi »).
- **Mouvement** : transitions de page partagées, animation d'apparition des listes, compteurs animés sur les chiffres clés ; tout respecte « réduire les animations » du système.
- **Accessibilité** : cibles ≥ 48 dp, contraste AA dans les deux thèmes, `Semantics` sur les chiffres et rangs, RTL arabe vérifié.

**Écrans refaits** : Accueil (carte hero LP/division de la semaine, carte « Ma salle » avec logo et WOD en cours, raccourcis), Entraînement, Ligue (podium top 3 + liste, portée salle cliquable), Objectifs, Profil (en-tête avec avatar, division, salle), Connexion/Inscription/Onboarding (mise en page plus aérée, étapes visibles).

## 6. Mobile — écrans nouveaux ou manquants

**Navigation** : 5 onglets conservés (Accueil, Entraînement, Ligue, Objectifs, Profil). Cloche de notifications (avec compteur non lus) dans l'en-tête de l'Accueil. Les autres écrans sont des routes empilées.

- **Salles** : `/gyms` (recherche, puces sports et gouvernorats, cartes avec logo, sports, membres, pagination infinie) ; `/gyms/:id` (bandeau, logo 96 px, stats, sports, adresse et réseaux, top 5, WODs de la salle, bouton Rejoindre/En attente/Membre/Quitter, « Changer le logo » pour le gérant via `image_picker`) ; `/gyms/:id/members` (gérant : demandes à approuver/refuser, « Nommer coach »).
- **WODs de salle** : `/gyms/:id/wods/:wodId` (description, compte à rebours, onglets Rx/Scaled, classement, ma position, « Soumettre mon score ») ; `/gyms/:id/wods/new` (coach) ; appui long sur un score → « Invalider » (coach).
- **Saisie de séance** : exercices groupés (Mouvements / WODs de référence / Stations Hyrox / Course Hyrox), `TimeField` pour les exercices `FINISH_TIME`, assistant « Course Hyrox complète » (8 stations + course, total calculé et modifiable).
- **Social** : `/friends` (amis, demandes reçues/envoyées, accepter/refuser, retirer), `/search` (recherche d'athlètes), `/u/:username` (profil public : division, niveau, salle, records visibles, boutons Ajouter / Suivre / Défier / Bloquer).
- **Friend Battles** : `/battles` (en cours, invitations, terminées), `/battles/new` (ami, métrique, durée), `/battles/:id` (scores des deux côtés, rafraîchissement toutes les 30 s, accepter/refuser/annuler).
- **Notifications** : `/notifications` (liste paginée, marquer comme lues, tap → écran concerné).
- **Progrès** : `/records` (records personnels par exercice, y compris `FINISH_TIME` en `mm:ss`), `/me/body` (mesures corporelles + graphique), baselines visibles dans Progrès.
- **Réglages** : `/settings` (langue, thème, unités, visibilité, consentements, export des données, suppression du compte avec confirmation).
- **Auth** : `/forgot-password`, écran « vérifie ton email » avec renvoi.

**Données** : un repository Riverpod par fonctionnalité (même structure `data/` + `presentation/` que l'existant). Aucune logique de points côté app.

## 7. Démo

`apps/api/scripts/demo-data.ts` étendu (jamais en production) :
- 8 salles fictives vérifiées avec logos générés (SVG → PNG → pipeline `StorageService`) : **Bodynade** (Tunis — CrossFit, Hyrox, Musculation), **Carthage Strength Lab** (Musculation, Force athlétique), **Sahel Iron Club** (Sousse), **Sfax Hybrid Box** (CrossFit, Hyrox), **Nabeul Run & Row** (Course, Hyrox), **Ariana Fit House**, **Bizerte Barbell**, **Monastir Move**. Les salles du catalogue existant sont réutilisées.
- Bodynade : `ahmed` gérant et coach, `yassine` et `nour` membres ; WOD « Bodynade Burner » (for time, cap 15 min, en cours) et « Friday AMRAP 20 » (terminé), avec scores Rx/Scaled.
- Séances de démo : un Fran et une course Hyrox Open pour `ahmed` (records visibles).
- Une Friend Battle en cours, une invitation d'ami, quelques notifications.

## 8. Tests

- **API unitaires** : extraction `FINISH_TIME`, direction de métrique, plausibilité par exercice, tri du classement WOD par type, validation fenêtre et time cap.
- **API intégration** : upload de logo (droits, 413, 415, octets falsifiés, remplacement), liste `q`/`sport`/`sort=members` avec pagination, nommer coach, CRUD WOD (droits), soumission de score (membre/non-membre, fenêtre, meilleur score conservé, séance idempotente), invalidation (ledger inversé, notification, audit), séance Hyrox → PR.
- **Mobile widgets** : liste des salles (filtres, repli du logo), profil (états du bouton), écran WOD (onglets, soumission), `TimeField`, assistant Hyrox, amis, battles, notifications, réglages ; RTL arabe sur la liste des salles et le classement.
- **Vérification finale** : build web, API + démo en local, parcours manuel en vue mobile (390×844) avec captures d'écran.

## 9. Hors périmètre

Gym Wars, défis et moteur de badges, fil d'activité, push FCM, Socket.IO (sous-projet C) ; paiements ; vrais logos de marques ; lancement sur appareil physique ou store.
