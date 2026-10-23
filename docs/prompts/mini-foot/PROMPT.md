# Prompt : mode « Tournoi mini-foot » dans l'espace organisateur (frontend seul)

> Colle tout ce qui est sous la ligne dans Claude Code, lancé depuis la racine du dépôt `fitness-league`.
>
> **Décisions de la propriétaire (2026-10-21), à ne pas rouvrir :**
> - format **Coupe du monde** : phase de poules, puis élimination directe ;
> - **pas de catégories** : un tournoi = une seule compétition, toutes les équipes ensemble ;
> - un **capitaine** inscrit son équipe dans l'app ; ses joueurs **n'ont pas besoin de compte** ;
> - **effectif : 7 joueurs sur le terrain et 3 remplaçants au plus**, soit **7 joueurs minimum** (le capitaine et 6 autres) et **10 au maximum** ; le capitaine est un joueur et compte dans l'effectif ;
> - **le prix par équipe est fixé par l'organisateur**, qui peut le changer quand il veut (0 = gratuit) ; une équipe déjà inscrite garde le prix qu'elle a vu au moment de son inscription ;
> - **paiement et codes promo exactement comme pour le CrossFit** : mêmes codes promo, même « À encaisser » et « Marquer payé » par l'organisateur ;
> - un **arbitre** invité saisit le match **en direct** (buts, buteurs, exclusions), et l'organisateur peut corriger ;
> - **pas de cartons** : ni jaune, ni suspension pour les matchs suivants, ni fair-play. Un **rouge = exclusion temporaire de 5 minutes dans le match** : le joueur sort, son équipe joue à un de moins, puis il revient après 5 minutes ;
> - **égalité en phase finale : tirs au but directement, sans prolongation** ;
> - **frontend seul** : pas de backend dans ce travail.

---

## Rôle et objectif

Tu travailles sur l'app `apps/mobile-rn` (Expo SDK 57, React Native 0.86, expo-router), dans l'**espace organisateur** (`/competitions/:id/manage`), sur téléphone et sur ordinateur (`useWideWeb()`).

Aujourd'hui, une compétition est pensée pour le CrossFit : des athlètes inscrits seuls, des WODs, des heats, des couloirs et des juges au sol. Ton travail est d'ajouter un **deuxième type de compétition, le tournoi de mini-foot**, avec :

- des équipes et leurs joueurs ;
- des poules et leurs classements ;
- un calendrier de matchs réparti sur plusieurs terrains ;
- une feuille de match tenue en direct par un arbitre ;
- un tableau final (huitièmes, quarts, demies, petite finale, finale) ;
- les statistiques des buteurs.

**Frontend seul.** L'API n'a ni équipes ni matchs, et on n'en ajoute pas. Tu construis donc :

1. les écrans, branchés sur une **interface de données** (`FootballRepo`) ;
2. une implémentation **locale** de cette interface (AsyncStorage) et les données de démo, pour que tout soit utilisable dans l'app aujourd'hui, sur un seul appareil ;
3. un **contrat d'API** écrit, que le backend suivra plus tard (l'API NestJS, puis le backend Rust dans sa partie 4, Compétitions). Il suffira alors d'écrire `HttpFootballRepo` sans toucher aux écrans.

## À lire avant d'écrire quoi que ce soit

- `handoff.md` §0 et §1, puis `README.md` ;
- `apps/mobile-rn/AGENTS.md` (règles Expo : docs versionnées SDK 57, `npx expo install`, pas de modification à la main dans les dossiers natifs) ;
- `docs/superpowers/specs/2026-10-14-organizer-space-design.md` (l'espace organisateur, la publication par l'admin) ;
- `docs/superpowers/specs/2026-10-21-floor-judging-design.md` (l'arbitre suit le même modèle que le juge au sol : invitation, acceptation, écran de jugement, envoi hors ligne avec `clientId`) ;
- `apps/mobile-rn/src/features/competitions/organizer/` :
  - `logic.ts` (`ManageTab`, check-list, `TAB_FOR`) ;
  - `web.ts` et `web-shell.tsx` (`ORG_MENU`, layout ordinateur) ;
  - `manage.tsx`, `create.tsx`, `dashboard.tsx`, `finances.tsx`, `participants.tsx`, `payments.tsx`, `coupons.tsx`, `planning.tsx`, `timetable.tsx`, `team.tsx`, `leaderboard.tsx`, `announcements.tsx`, `export.ts` ;
- `apps/mobile-rn/src/features/competitions/{screens.tsx,api.ts,my-heats.tsx}` et `judge/{api.ts,logic.ts,screens.tsx}` ;
- `apps/mobile-rn/src/app/competitions/` (les routes existantes) et, dans `features/competitions/screens.tsx`, l'écran d'inscription (route `[id]/register.tsx`) : le parcours de paiement et de code promo CrossFit à reprendre ;
- `apps/api/src/modules/competitions/competitions.dto.ts` (`CouponCheckDto`, `CategoryDto`), en lecture seule, pour savoir ce que le serveur exige ;
- `src/core/api/demo-backend.ts` et `assets/demo/api.json` (démo hors ligne) ;
- `src/core/widgets/{kit,common,chart,pickers}.tsx`, `src/core/theme/index.ts`, `src/core/i18n/index.ts` et `{en,fr,ar}.json` ;
- `test/{harness.tsx,fake-api.ts,organizer-fixtures.ts,wide-web.ts}` et les tests de `test/screens/` qui touchent aux compétitions.

## Règles (ne pas les enfreindre)

- **Frontend seul.** Ne change rien sous `apps/api`, `apps/backend`, `apps/admin` ou `apps/landing`, et n'ajoute aucune route. Les appels HTTP existants (`POST /competitions`, bannière, staff, codes promo, annonces, publication) restent utilisés tels quels.
- **Le mode CrossFit ne bouge pas.** Une compétition qui n'est pas en mode mini-foot s'affiche et se gère exactement comme aujourd'hui, au pixel près, avec tous ses tests verts.
- **Aucun nouveau paquet.** AsyncStorage est déjà installé (`@react-native-async-storage/async-storage`). Le tableau final et les tableaux de classement sont faits avec des `View`.
- **Textes :** chaque nouvelle chaîne va dans `en.json`, `fr.json` et `ar.json`, avec les mêmes clés et les mêmes placeholders. Le français utilise « tu ». Les nombres utilisent les pluriels ICU déjà utilisés par l'app (`{count, plural, =0{…} =1{…} other{…}}`). Les téléphones s'affichent en miroir en arabe : `marginStart` / `End`, jamais `left` / `right`. Sur ordinateur, le layout n'est pas inversé (règle existante).
- **Garde tous les `testID` existants** et donne-en un à chaque nouveau contrôle.
- **Pas de refactor hors sujet.**
- **Git en local seulement :**
  - `git fetch`, puis une nouvelle branche `feat/mini-foot` depuis `origin/main` (jamais depuis le `main` local, qui est en retard) ;
  - un commit par lot ;
  - **ne pousse jamais.**

## 1. La seule question à poser à la propriétaire avant de coder

Tout le reste est décidé (voir le haut du prompt). Si elle ne répond pas, applique la réponse recommandée et note-la dans la section « Décisions » du spec.

| # | Question | Recommandé |
|---|---|---|
| Q1 | Le serveur refuse la demande de publication tant qu'il manque un WOD actif (`409 missing: WOD`). La catégorie technique (lot 2) règle `CATEGORY`, mais un tournoi de foot n'a pas de WOD. Comment le publier sans backend ? | Ne pas créer de faux WOD. Dans ce travail, le tournoi reste un **brouillon de démonstration**, et le bouton « Demander la publication » explique que la publication des tournois de foot arrive avec le backend. |

**Décision technique déjà prise : la catégorie technique.** Le serveur exige un `categoryId` pour vérifier un code promo (`POST /competitions/:id/coupon/validate`, `CouponCheckDto`). À la création d'un tournoi de foot, l'app crée donc **une seule catégorie technique** (`POST /competitions/:id/categories`, nom « Tournoi », genre `MIXED`). Elle n'est **jamais affichée** en mode mini-foot (ni à l'organisateur, ni au capitaine, ni au public). Elle sert seulement aux codes promo. Le contrat d'API demandera au backend de s'en passer.

## 2. Lot 0 : spec et contrat d'API (avant le code)

Écris `docs/superpowers/specs/2026-10-2X-mini-foot-design.md`, en français et dans le style des specs existants. Il contient :

- l'intention ;
- les décisions (celles du haut du prompt, plus la réponse à Q1) ;
- les écrans ;
- les règles et les cas limites ;
- les tests ;
- les lots ;
- le hors périmètre ;
- le **contrat d'API** : routes, corps, réponses et codes d'erreur, rédigé dans le style de `docs/ARCHITECTURE.md`, pour que le backend n'ait plus qu'à le suivre.

Fais-le relire à la propriétaire avant le lot 1.

### 2.1 Types (`src/features/competitions/football/types.ts`)

Montants en millimes (35 TND = 35000), comme le reste de l'app.

```ts
type CompetitionKind = 'CROSSFIT' | 'FOOTBALL';

// Fixé par la propriétaire, pas réglable par l'organisateur.
const PLAYERS_ON_FIELD = 7;          // 7 sur le terrain
const MAX_SUBSTITUTES = 3;           // 3 remplaçants au plus
const MIN_SQUAD = 7;                 // le capitaine + 6 autres
const MAX_SQUAD = 10;                // 7 + 3
const EXCLUSION_MINUTES = 5;         // rouge = 5 min dehors, puis retour

interface FootballSettings {
  halfMinutes: number;               // 20 par défaut, 2 mi-temps
  halfTimeMinutes: number;           // 5
  points: { win: number; draw: number; loss: number }; // 3 / 1 / 0
  groupCount: number;                // ex. 4 poules
  teamsPerGroup: number;             // ex. 4 équipes
  qualifiersPerGroup: number;        // ex. 2
  bestThirds: number;                // 0 par défaut (meilleurs 3es repêchés)
  thirdPlaceMatch: boolean;          // petite finale
  tieBreakers: GroupTieBreaker[];    // ordre réglable
  pitches: string[];                 // ['Terrain 1', 'Terrain 2']
  slotMinutes: number;               // durée d'un créneau (match + changement)
  minRestMinutes: number;            // repos mini entre deux matchs d'une équipe
  forfeitScore: { winner: number; loser: number }; // 3-0
}
// Le prix et les codes promo ne sont PAS ici : ce sont ceux de la compétition, comme en CrossFit
// (prix dans « Général », codes dans « Codes promo »).

type GroupTieBreaker = 'POINTS' | 'GOAL_DIFF' | 'GOALS_FOR' | 'HEAD_TO_HEAD' | 'DRAW_LOTS';
type KnockoutStage = 'R32' | 'R16' | 'QF' | 'SF' | 'THIRD' | 'FINAL';

interface Team {
  id: string; competitionId: string;
  name: string; shortName: string;   // 3 lettres, ex. « BDN »
  color: string;                     // hex 6 chiffres
  logoUri?: string;
  captainUserId: string;             // compte de l'app
  players: Player[];                 // 7 à 10, le capitaine compris
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'WITHDRAWN';
  // Mêmes champs de paiement qu'une inscription CrossFit :
  paymentStatus: 'PENDING' | 'PAID' | 'FREE';
  originalPrice: number; discount: number; finalPrice: number; couponCode?: string;
  registeredAt: string;
}

interface Player {                   // pas de compte
  id: string; firstName: string; lastName: string;
  number: number;                    // 1–99, unique dans l'équipe
  isCaptain: boolean; isGoalkeeper: boolean;
  phone?: string;                    // visible par l'organisateur seulement
}

interface Group { id: string; name: string /* A, B… */; teamIds: string[] }

interface Match {
  id: string;
  stage: 'GROUP' | KnockoutStage; groupId?: string; round: number;
  home: Slot; away: Slot;            // une équipe, ou une source : « 1er A », « Vainqueur QF1 »
  pitch: string; startsAt: string | null;
  refereeStaffId: string | null;
  status: 'SCHEDULED' | 'LIVE' | 'HALF_TIME' | 'FINISHED' | 'FORFEIT' | 'POSTPONED';
  period: 0 | 1 | 2;                 // 0 avant le match, 1 et 2 les mi-temps (pas de prolongation)
  periodStartedAt: string | null;
  score: { home: number; away: number };
  penalties?: { home: number; away: number }; // phase finale seulement, en cas d'égalité
  events: MatchEvent[];
  confirmedAt: string | null;        // capitaines ont confirmé la feuille
}

type Slot = { teamId: string } | { source: { kind: 'GROUP_RANK'; groupId: string; rank: number } | { kind: 'BEST_THIRD'; index: number } | { kind: 'WINNER' | 'LOSER'; matchId: string } };

interface MatchEvent {
  clientId: string;                  // pour les renvois hors ligne et l'annulation
  type: 'GOAL' | 'OWN_GOAL' | 'EXCLUSION' | 'PERIOD_START' | 'PERIOD_END' | 'SHOOTOUT_KICK';
  teamId?: string; playerId?: string | null; // null = buteur inconnu
  scored?: boolean;                  // SHOOTOUT_KICK : tir réussi ou manqué
  minute: number; at: string;        // `at` sert au compte à rebours de l'exclusion
  byStaffId: string;
  cancelled?: boolean;               // annulation = nouvel état, jamais d'effacement
}
```

Le mode d'une compétition (`CompetitionKind`) et ses réglages sont stockés localement, par id de compétition. Le contrat d'API prévoit un champ `kind` sur la compétition.

### 2.2 Contrat d'API à écrire (préfixe `/competitions/:id/football`)

À écrire dans le spec, sans l'implémenter :

- `GET` et `PUT /settings` ;
- `GET` et `POST /teams` (le corps accepte `couponCode`, avec le même calcul de remise que `POST /competitions/:id/register`), `PUT` et `DELETE /teams/:teamId`, `POST /teams/:teamId/mark-paid` ;
- `GET /teams/mine` (le capitaine) ;
- `POST /draw` (tirage des poules), `PUT /groups/:groupId` (modification à la main) ;
- `POST /schedule/auto`, `PUT /matches/:matchId` ;
- `POST /matches/:matchId/events` `{clientId,…}` (idempotent), `POST /matches/:matchId/events/:clientId/cancel` ;
- `POST /matches/:matchId/period` `{action: START|END}`, `POST /matches/:matchId/finish`, `POST /matches/:matchId/forfeit` ;
- `GET /standings`, `GET /bracket`, `GET /stats` (buteurs) ;
- l'arbitre : `POST /competitions/:id/staff` avec le nouveau rôle `REFEREE`, et `GET /competitions/football-refereeing` (mes matchs à arbitrer) ;
- la publication : la vérification `missing` du serveur doit, pour un tournoi de foot, remplacer `CATEGORY` et `WOD` par `TEAMS_SETTINGS` (règlement complet) ;
- les codes promo : pour un tournoi de foot, `coupon/validate` et l'inscription d'équipe se passent de `categoryId`, et la catégorie technique disparaît ; l'inscription d'une équipe enregistre l'utilisation du code, comme une inscription CrossFit.

Les notifications, la diffusion en direct (socket) et l'audit sont à décrire pour le backend.

## 3. Lot 1 : logique pure et dépôt de données

`src/features/competitions/football/logic.ts` contient des fonctions pures, sans React, toutes testées avec Jest. Le backend devra les reproduire à l'identique.

- **Tirage des poules** :
  - aléatoire avec une graine (pour des tests reproductibles), ou avec chapeaux (têtes de série) ;
  - les écarts de taille entre poules sont d'au plus une équipe ;
  - le tirage est refusé si le nombre d'équipes confirmées ne suffit pas.
- **Matchs de poule** : tous contre tous par la méthode du cercle. Chaque équipe joue une fois par journée. Avec un nombre impair d'équipes, une équipe est exempte à chaque journée.
- **Classement de poule** :
  - colonnes J, G, N, P, BP, BC, Diff, Pts ;
  - départage dans l'ordre de `tieBreakers` ;
  - la confrontation directe ne compte que les matchs entre les équipes à égalité ;
  - le tirage au sort est marqué « à départager par l'organisateur ».
- **Meilleurs 3es** : comparés entre poules par points, puis diff, puis buts marqués. Si les poules sont inégales, on ne garde contre la dernière que les matchs joués par toutes.
- **Tableau final** :
  - croisements classiques (1er A contre 2e B, 1er B contre 2e A…) ;
  - deux équipes d'une même poule ne se retrouvent pas avant le tour le plus tardif possible ;
  - les places du tableau se remplissent dès que la source est connue ;
  - « Vainqueur QF1 » et « Perdant SF1 » (pour la petite finale) se mettent à jour automatiquement.
- **Vainqueur d'un match à élimination** : le score à la fin du temps réglementaire, et en cas d'égalité, **directement les tirs au but** (jamais de prolongation).
- **Séance de tirs au but** :
  - 5 tirs par équipe, en alternance ;
  - la séance s'arrête dès qu'une équipe ne peut plus être rattrapée ;
  - s'il y a encore égalité après 5 tirs, mort subite tir par tir.
- **Forfait** : score `forfeitScore`. Aucun buteur n'est compté.
- **Calendrier automatique** :
  - les créneaux sont remplis terrain par terrain, à partir de l'heure de début et de `slotMinutes` ;
  - une équipe ne joue jamais deux matchs en même temps et respecte `minRestMinutes` ;
  - une journée de poule est terminée avant la suivante ;
  - la phase finale commence après le dernier match de poule ;
  - les matchs qui ne rentrent pas sont listés.
- **Retard** : décale tous les matchs non commencés d'un même terrain, ou de tous les terrains. C'est le même principe que le « Retard » du planning actuel.
- **Feuille de match (reducer)** :
  - les événements s'appliquent dans l'ordre ;
  - l'annulation enlève l'effet d'un événement sans l'effacer ;
  - le score est toujours recalculé depuis les événements, jamais saisi à la main ;
  - le chrono est calculé depuis `periodStartedAt` et l'heure de l'appareil.
- **Exclusion temporaire (rouge)** :
  - à un instant donné, les joueurs exclus de chaque équipe, avec le temps restant (`EXCLUSION_MINUTES` à partir de `at`) ;
  - le nombre de joueurs sur le terrain (7 moins les exclus en cours) ;
  - le temps d'exclusion ne s'écoule que pendant le jeu (il est gelé à la mi-temps, et ce qui reste continue en 2e mi-temps) ;
  - un joueur exclu ne peut pas marquer tant que son exclusion court ;
  - l'exclusion ne compte pour aucun match suivant, et rien n'apparaît dans les classements.
- **Statistiques** : classement des buteurs (les buts contre son camp et les tirs au but ne comptent pas pour le joueur).
- **Validation de l'effectif** :
  - entre `MIN_SQUAD` (7) et `MAX_SQUAD` (10) joueurs, **le capitaine compris** ;
  - numéros uniques ;
  - exactement un capitaine ;
  - au moins un gardien.

`src/features/competitions/football/repo.ts` :

- l'interface `FootballRepo`, qui suit le contrat d'API ;
- `LocalFootballRepo`, sur AsyncStorage, avec des lectures et écritures entourées de try/catch et une clé par compétition ;
- un hook `useFootballRepo()` qui choisit l'implémentation. Il n'y en a qu'une aujourd'hui.

## 4. Lot 2 : création, règlement, équipes et inscription du capitaine

**Création (`create.tsx`)** :

- premier choix « Type de compétition » : **CrossFit / fonctionnel** (comportement actuel) ou **Tournoi mini-foot** ;
- en mini-foot, le format est forcé sur « Sur place », et la ville et le lieu sont obligatoires ;
- le prix et les places se saisissent comme aujourd'hui. En mini-foot, le prix s'entend **par équipe** (« Prix par équipe, en TND ») et les places sont un **nombre d'équipes** ; les libellés le disent ;
- « Créer le brouillon » appelle toujours `POST /competitions`, crée la catégorie technique (voir §1), puis enregistre localement `kind: FOOTBALL`, l'id de la catégorie technique et les réglages par défaut. Si la catégorie échoue, l'écran propose « Réessayer » sans recréer la compétition.

**Espace organisateur en mode mini-foot**. Menu (`ORG_MENU` et onglets téléphone) propre au mode :

| Section | Pages |
|---|---|
| Tableau de bord | Tableau de bord, Finances |
| Général | Général, **Règlement** (les réglages), Codes promo, Équipe (staff et arbitres) |
| Équipes | **Équipes** (remplace Participants) |
| Tournoi | **Poules**, **Calendrier**, **Matchs en direct** (remplacent WODs, Planning et Time Table) |
| Résultats | **Classements**, **Tableau final**, **Buteurs** |
| Messages | Annonces |

Il n'y a **pas de page Catégories** en mode mini-foot.

**Check-list de publication en mode mini-foot** : description, dates, bannière, règlement complet. Catégorie et WOD disparaissent (voir Q1).

**Règlement** :

- un formulaire découpé en sections : durée du match, points, poules et qualification, phase finale (petite finale oui / non), terrains et créneaux ;
- un rappel en lecture seule des règles fixes : « 7 joueurs sur le terrain, 3 remplaçants au plus, rouge = 5 minutes d'exclusion, égalité en phase finale = tirs au but » ;
- chaque champ a des bornes et une aide d'une ligne ;
- un **aperçu** montre en direct ce que donnent les réglages : « 16 équipes · 4 poules de 4 · 24 matchs de poule · quarts de finale · 32 matchs au total · environ 6 h 40 sur 2 terrains ».

**Prix par équipe (fixé par l'organisateur)** :

- l'organisateur le saisit à la création et **le change quand il veut** dans « Général » (`PUT /competitions/:id`, champ `registrationPrice` existant, en millimes) ; 0 = inscription gratuite ;
- le même champ est aussi affiché en haut de la page « Règlement », avec un lien « Modifier le prix » vers « Général », pour que l'organisateur le trouve là où il règle son tournoi ;
- chaque équipe garde le prix **figé au moment de son inscription** (`originalPrice`, `discount`, `finalPrice`) : changer le prix ne modifie ni les équipes déjà inscrites, ni ce qu'elles doivent payer ;
- avant d'enregistrer un nouveau prix, une confirmation le rappelle : « Nouveau prix : 120 TND par équipe. Les 9 équipes déjà inscrites gardent leur prix. » ;
- dans « Équipes » et dans « Finances », chaque équipe montre le prix qu'elle doit vraiment payer ; si des équipes ont des prix différents, les Finances l'indiquent (« 3 équipes inscrites à l'ancien prix ») ;
- la page publique et l'écran d'inscription du capitaine affichent toujours le prix actuel.

**Codes promo** : la page `coupons.tsx` existante. En mini-foot, la remise s'applique au prix de l'équipe, et le choix de catégorie du formulaire et de la liste est masqué (les codes valent pour tout le tournoi). Limite à signaler : sans backend, le compteur d'utilisations d'un code n'augmente pas quand une équipe l'utilise, puisque l'inscription de l'équipe reste locale.

**Équipes (organisateur)**, sur le modèle de `participants.tsx` et `payments.tsx` :

- liste avec recherche et filtres (paiement, statut) ;
- onglet « À encaisser », le plus ancien d'abord ;
- « Marquer payé » avec confirmation, puis reçu à partager, exactement comme pour une inscription CrossFit ;
- fiche d'une équipe : effectif, capitaine, téléphone des joueurs, prix, remise, code promo utilisé ;
- l'organisateur peut **ajouter une équipe à la main** (inscription sur place) et modifier un effectif ;
- « Retirer l'équipe », avec confirmation ;
- export CSV : une ligne par joueur.

**Finances** : mêmes chiffres qu'en CrossFit (revenu, encaissé, à encaisser, remises), calculés sur les équipes.

**Inscription du capitaine (côté athlète)** : sur la page publique d'un tournoi de foot, « Inscrire mon équipe » remplace « S'inscrire ». Le parcours reprend l'écran d'inscription CrossFit (`screens.tsx`, route `[id]/register.tsx`), sans l'étape catégorie :

1. **Équipe** : nom, sigle de 3 lettres, couleur, logo facultatif.
2. **Joueurs** : prénom, nom, numéro, gardien, téléphone facultatif.
   - Le capitaine est le premier joueur, prérempli avec son propre nom ; il compte dans l'effectif.
   - Il ajoute **au moins 6 autres joueurs** (7 au total, l'équipe sur le terrain) et **au plus 9** (10 au total : 7 titulaires et 3 remplaçants).
   - Un compteur indique « 5 / 7 minimum » puis « 8 / 10 » ; « Continuer » reste grisé sous 7, et « Ajouter un joueur » disparaît à 10.
3. **Paiement**, comme en CrossFit :
   - récapitulatif avec le prix de l'équipe ;
   - champ code promo, vérifié par la route existante `POST /competitions/:id/coupon/validate` avec l'id de la catégorie technique, et le même affichage de la remise et des erreurs ;
   - validation : l'équipe est enregistrée avec le paiement « en attente » (ou « gratuit » si le prix final est 0) ;
   - elle n'est **confirmée** que lorsque l'organisateur a cliqué « Marquer payé ».

Ensuite, la page **« Mon équipe »** montre :

- le statut (« Paiement en attente » ou « Confirmée ») ;
- l'effectif, modifiable jusqu'à la fermeture des inscriptions, toujours entre 7 et 10 joueurs ;
- les matchs de l'équipe.

## 5. Lot 3 : poules et calendrier

**Poules** :

- « Tirer au sort », avec ou sans chapeaux, et une animation simple (les équipes tombent une par une, désactivée quand le système demande moins d'animations, comme le fait déjà `src/core/widgets/common.tsx`) ;
- glisser une équipe d'une poule à l'autre : sur ordinateur par glisser-déposer, sur téléphone avec « Déplacer vers… » ;
- « Refaire le tirage », avec confirmation, n'est possible que tant qu'aucun match n'a commencé ;
- le tirage est refusé tant qu'il reste des équipes non confirmées, avec un lien vers « À encaisser ».

**Calendrier** :

- « Générer le calendrier » (logique du lot 1), avec la liste des matchs non placés s'il y en a ;
- vue par terrain et par heure, en colonnes sur ordinateur et en liste groupée sur téléphone ;
- filtres : poule, équipe, phase ;
- modifier un match (heure, terrain, arbitre) ;
- échanger deux créneaux ;
- « Retard » ;
- reporter un match ;
- annonce automatique « Calendrier décalé de X min » (`POST /competitions/:id/announcements`, existant).

## 6. Lot 4 : arbitres et feuille de match en direct

**Inviter un arbitre** : dans **Équipe**, une section « Arbitres », construite comme « Juges sur place » : recherche d'un utilisateur, invitation, statut, retrait. Sans backend, l'invitation et l'acceptation sont simulées dans `LocalFootballRepo`. Le rôle `REFEREE` est écrit dans le contrat d'API.

**Affecter les arbitres** : un arbitre par match, choisi dans le calendrier. « Répartir les arbitres » remplit automatiquement les matchs sans arbitre. Un arbitre ne siffle jamais un match de sa propre équipe et ne peut pas avoir deux matchs en même temps.

**Écran arbitre** (`/competitions/[id]/referee`, puis `/referee/[matchId]`) :

- **Mes matchs** : à venir, en cours et terminés, avec le terrain et l'heure.
- **Avant le match** : la feuille de match montre les deux effectifs avec leurs numéros. Une équipe qui n'a pas 7 joueurs présents est signalée, et l'arbitre peut déclarer le forfait. Bouton « Coup d'envoi ».
- **Pendant le match** :
  - un grand chrono, calculé depuis `periodStartedAt` ;
  - le score en très gros ;
  - deux grands boutons « But » (couleur de chaque équipe), puis le choix du buteur dans l'effectif, ou « Contre son camp », ou « Inconnu » ;
  - un bouton **« Rouge · 5 min »** par équipe, puis le choix du joueur :
    - le joueur apparaît dans un bandeau « Exclu » avec un compte à rebours de 5:00 ;
    - l'équipe affiche « 6 joueurs sur le terrain » (ou moins si plusieurs exclusions) ;
    - à 0:00, un signal visuel « Peut revenir » apparaît, et le joueur redevient disponible ;
    - le compte à rebours se fige à la mi-temps et reprend avec la 2e mi-temps ;
    - **aucun carton jaune**, et rien n'est reporté sur les matchs suivants ;
  - « Mi-temps », « Reprise », « Fin du match » ;
  - en phase finale, en cas d'égalité à la fin du match : **séance de tirs au but directement** (pas de prolongation), tir par tir, réussi ou manqué, avec mort subite après 5 tirs ;
  - « Annuler le dernier événement », toujours visible ;
  - le fil des événements, du plus récent au plus ancien.
- **Fin du match** :
  - récapitulatif ;
  - « Les capitaines confirment », un appui avec le nom des deux capitaines (comme « Je confirme mon score » du juge au sol) ;
  - le match passe à « Terminé » ;
  - classements et tableau final se mettent à jour.
- **Hors ligne** : chaque événement a un `clientId`. Ce qui n'est pas parti reste sur l'appareil, marqué « en attente d'envoi » (même modèle que le juge au sol). Pas de nouvelle dépendance native (ni keep-awake, ni vibrations).
- **Accessibilité** : boutons d'au moins 44 pt, lisibles en plein soleil (contraste fort), et le score est annoncé par VoiceOver et TalkBack.

**Correction par l'organisateur** : dans **Matchs en direct**, il voit tous les matchs en cours (score et minute), ouvre n'importe quelle feuille, ajoute ou annule un événement, déclare un forfait et rouvre un match terminé. Chaque correction garde l'auteur et l'heure dans l'événement.

**Limite à écrire dans l'écran et dans le spec** : sans backend, l'arbitre et l'organisateur doivent utiliser **le même appareil** pour voir les mêmes données. La synchronisation entre téléphones arrive avec l'API et le socket temps réel.

## 7. Lot 5 : pages publiques et résultats

Sur la page d'une compétition en mode mini-foot (`screens.tsx`), ces onglets remplacent ceux du CrossFit :

- **Matchs** :
  - par jour et par heure ;
  - badge « EN DIRECT » avec la minute ;
  - score, tirs au but entre parenthèses ;
  - filtre « Mon équipe » ;
  - un match ouvre son détail : buts et exclusions, compositions, arbitre et terrain.
- **Poules** : un tableau par poule (J G N P BP BC Diff Pts). Les qualifiés et les repêchés sont mis en évidence, et la couleur n'est jamais la seule indication : on ajoute une icône ou un libellé.
- **Tableau final** : l'**arbre de compétition** de la phase finale (voir ci-dessous).
- **Équipes** : liste et fiche (effectif avec numéros, sans les téléphones).
- **Buteurs** : classement des buteurs, meilleure attaque et meilleure défense.

### 7.1 L'arbre de compétition (phase finale)

Un composant `BracketTree` (`football/bracket.tsx`), utilisé à deux endroits : l'onglet public « Tableau final » et la page organisateur « Tableau final ». Il dessine l'arbre de la phase finale : chaque match est une case, et des traits relient chaque case au match suivant, jusqu'à la finale et au vainqueur. Tout est construit avec des `View` (cases, traits horizontaux et verticaux), sans SVG ni nouveau paquet.

**Forme sur ordinateur (≥ 1024 px)** : l'arbre est symétrique et converge vers la finale au centre. Exemple avec des quarts de finale :

```
  QUARTS           DEMIES           FINALE           DEMIES           QUARTS

┌─────────┐                                                        ┌─────────┐
│ BDN   2 │──┐                                                  ┌──│ CAB   3 │
│ CSS   1 │  │  ┌─────────┐                        ┌─────────┐  │  │ OBJ   0 │
└─────────┘  ├──│ BDN   3 │──┐                  ┌──│ CAB   1 │──┤  └─────────┘
┌─────────┐  │  │ EST   1 │  │  ┌───────────┐   │  │ RCA   0 │  │  ┌─────────┐
│ EST 1(4)│──┘  └─────────┘  ├──│ BDN     2 │───┤  └─────────┘  └──│ RCA   2 │
│ ASM 1(3)│                     │ CAB     1 │                      │ USM   1 │
└─────────┘                     └───────────┘                      └─────────┘
                                     │
                                 🏆 BDN
                             (vainqueur du tournoi)

                               PETITE FINALE
                               ┌───────────┐
                               │ EST     2 │
                               │ RCA     1 │
                               └───────────┘
```

Lecture : BDN bat CSS en quart, EST bat ASM aux tirs au but (1-1, 4 tirs à 3), BDN bat EST en demie, puis CAB en finale. Les perdants des demies, EST et RCA, jouent la petite finale. Avant que les poules soient finies, chaque place affiche sa source (« 1er A », « 2e B ») à la place du sigle.

**Forme sur téléphone** :

- l'arbre se lit de gauche à droite, une colonne par tour, avec un **défilement horizontal** ;
- une barre de tours en haut (« 8es · Quarts · Demies · Finale ») amène directement à la colonne choisie ;
- en arabe, l'arbre se lit de droite à gauche (la finale est à gauche).

**Une case de match** :

- les deux équipes, l'une au-dessus de l'autre : pastille de couleur, sigle (« BDN ») et nom si la place le permet, score à droite ;
- s'il y a eu des tirs au but : score des tirs entre parenthèses, par exemple « 1 (4) » ;
- le **vainqueur** est en gras et le perdant est grisé (pas seulement par la couleur : graisse du texte et icône) ;
- tant que l'équipe n'est pas connue, la place affiche sa source : « 1er A », « 2e B », « Meilleur 3e », « Vainqueur QF1 » ;
- sous la case : l'heure et le terrain ; « EN DIRECT 34' » avec le score qui change pendant le match ;
- un appui ouvre le détail du match (buts, exclusions, tirs au but).

**Le trait du vainqueur** : quand un match est terminé, le trait qui part du vainqueur vers le tour suivant prend la couleur d'accent (`config.accent`), et le nom du vainqueur apparaît dans la case suivante. On voit ainsi le parcours de chaque équipe jusqu'à la finale.

**Autour de l'arbre** :

- la **finale** est mise en avant (case plus grande) et le **vainqueur** est affiché après elle, avec un trophée ;
- la **petite finale** est affichée à part, sous la finale, avec son propre titre ;
- le filtre **« Mon équipe »** (capitaine) ou un appui long sur une équipe surligne son parcours dans l'arbre et grise le reste ;
- **avant la fin des poules**, l'arbre est déjà affiché, avec les sources dans chaque place (« 1er A contre 2e B »), pour que tout le monde voie à quoi s'attendre ;
- la taille de l'arbre suit le règlement : 4 équipes (demies), 8 (quarts), 16 (8es) ou 32 (16es).

**Côté organisateur**, la page « Tableau final » montre le même arbre, avec en plus :

- l'heure, le terrain et l'arbitre de chaque match, modifiables depuis la case ;
- « Départager » sur une place bloquée par un tirage au sort de poule ;
- un rappel quand un match de phase finale n'a pas encore d'heure ou d'arbitre.

**Accessibilité** : chaque case est lue comme une phrase (« Quart de finale 1, Bodynade 2, CSS 1, Bodynade qualifié »), et l'ordre de lecture suit les tours.

**Classements (organisateur)** : comme `leaderboard.tsx`, avec « Publier les résultats » qui affiche un podium final (1er, 2e, 3e) et des égalités à départager à la main quand le règlement arrive au tirage au sort.

**Tableau de bord en mode mini-foot** :

- équipes inscrites, payées et à encaisser ;
- revenu et remises des codes promo ;
- matchs joués sur le total ;
- buts marqués ;
- prochain match par terrain.

## 8. Lot 6 : démo, vérification et documentation

- **Démo** (`EXPO_PUBLIC_DEMO=true`) : un tournoi mini-foot en brouillon organisé par l'utilisateur de démo.
  - 16 équipes fictives aux noms tunisiens inventés, de 7 à 10 joueurs chacune ; 2 équipes en attente de paiement et 1 qui a utilisé un code promo ;
  - 4 poules tirées, la 1re journée jouée, un match en direct avec une exclusion en cours ;
  - un arbre de phase finale avec des places encore en attente (« 1er A ») ; un deuxième tournoi de démo, terminé, montre l'arbre complet jusqu'au vainqueur, avec une demie gagnée aux tirs au but.
  - Données injectées par `LocalFootballRepo` au premier lancement de la démo.
- **Tests Jest** :
  - toute la logique du lot 1, avec des cas limites : poule de 3, nombre impair d'équipes, égalité à trois, meilleurs 3es avec des poules inégales, forfait, annulation d'un but ;
  - tirs au but : victoire avant le 5e tir, mort subite ;
  - exclusion : le compte à rebours se fige à la mi-temps, deux exclusions en même temps (5 joueurs sur le terrain), le joueur redevient disponible à 5:00 ;
  - arbre : sources affichées avant la fin des poules, vainqueur qui avance au tour suivant après le match (y compris aux tirs au but), perdant des demies envoyé en petite finale, arbre de 4, 8 et 16 équipes, sens inversé en arabe sur téléphone ;
  - écrans : création en mode foot, check-list sans catégorie ni WOD, inscription du capitaine (6 joueurs refusé, 7 accepté, 10 accepté, 11 impossible, numéro en double), code promo valide et invalide, « Marquer payé » qui confirme l'équipe, changement de prix par l'organisateur (les équipes déjà inscrites gardent leur ancien prix, la nouvelle équipe paie le nouveau), tirage refusé avec des équipes non payées, feuille de match (but, annulation, rouge 5 min, tirs au but), mode CrossFit inchangé.
- **Vérification visuelle** : captures de la démo web en FR et en AR, à 390 px et en layout ordinateur (≥ 1024 px). Écrans : création, règlement, équipes, inscription du capitaine, poules, calendrier, feuille de l'arbitre, arbre de la phase finale (en cours et terminé). Regarde-les avant de dire que c'est fini.
- Dans `apps/mobile-rn` (npm, hors workspace pnpm) : `npm run typecheck` et `npm test` au vert.
- **Docs** : le spec (avec le contrat d'API), `README.md` (le mode mini-foot existe en frontend, avec stockage local) et `handoff.md`. Dans le `handoff.md`, ajoute à la partie 4 du backend Rust (Compétitions) : reprendre le contrat mini-foot, le rôle `REFEREE` et la publication des tournois de foot.

## 9. Hors périmètre de ce travail

- tout le backend : tables, routes, notifications, socket temps réel ;
- le paiement en ligne (comme pour le CrossFit aujourd'hui) ;
- la synchronisation entre appareils ;
- les catégories ;
- les cartons jaunes, les suspensions d'un match à l'autre et le fair-play ;
- la prolongation ;
- les comptes joueurs et les statistiques personnelles ;
- la diffusion vidéo et l'écran géant ;
- les licences et certificats médicaux ;
- le championnat seul (tous contre tous sans phase finale) et l'élimination directe seule.

## 10. Quand tu as fini

En quelques lignes :

- ce qui marche ;
- ce qui est simulé (stockage local, invitations d'arbitres) ;
- les décisions prises sans la propriétaire ;
- la prochaine étape : le backend du mode mini-foot, d'après le contrat d'API.
