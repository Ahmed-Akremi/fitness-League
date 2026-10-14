# Espace organisateur dans l'app — design

Date : 2026-10-14 · Statut : validé en conversation (option C + publication par l'admin) · Branche : `feat/organizer-space` (depuis `origin/main` `ff5326d`)
Annexe : `docs/superpowers/specs/2026-10-14-organizer-space-gap-analysis.md` (comparaison avec Circle21, étapes 1 et 2 du prompt du propriétaire).

## 0. Intention

**Demandé par le propriétaire**
- Un utilisateur qui veut organiser un événement le crée depuis l'app (« bouton create event »), le prépare, puis l'admin valide avant la mise en ligne.
- S'inspirer du portail organisateur de Circle21 (`Desktop/prompt organisation.txt`) ; « améliore la nouvelle partie, juste le frontend, sans toucher le backend ».

**Choix du propriétaire (questions de cette session)**
- L'organisateur prépare son événement **dans l'app mobile**.
- Découpage : la demande validée par l'admin et l'espace organisateur forment un seul parcours, livré en deux lots (A puis B).
- Contrainte : **frontend seulement**, avec une exception acceptée (option C) : la règle qui laisse tout utilisateur créer un événement.
- Publication : **l'admin publie** (option 2), ce qui ajoute une deuxième règle et un repère « publication demandée ».
- Premier vrai événement : **sur place**. Volume visé : **plus de 10 événements, 300 athlètes ou plus**.

**Hypothèses**
- « Utilisateur » = tout compte de l'app avec un email vérifié ; les comptes juges (`JUDGE`, `HEAD_JUDGE`) n'utilisent pas l'app et ne créent pas d'événement.
- Le jour J sur place (check-in, décharge, saisie des scores au couloir, paiement en ligne) n'est pas dans ce spec : il demande du backend et viendra dans une phase « sur place » avant le premier événement.
- Les annonces et la publication n'envoient pas de notification dans ce lot (pas de backend pour ça).

**Critères de réussite**
- Lot A : un utilisateur normal crée un événement depuis l'app, ajoute bannière, catégories et WODs, demande la publication ; un admin le publie ou le renvoie avec une note depuis le panneau ; l'événement publié apparaît dans les listes publiques et le carrousel de l'accueil.
- Lot B : l'organisateur gère heats, couloirs et planning (avec « Retard »), encaisse les inscriptions, voit son équipe, publie le classement, poste des annonces et gère ses codes promo, le tout depuis l'app.
- Un brouillon n'est jamais visible du public ; un organisateur ne peut pas publier seul.
- Tests API, app et panneau verts ; FR / EN / AR (arabe de droite à gauche) ; écrans vérifiés en capture.

## 1. Écrans de l'app

### 1.1 Entrées
- Page Compétitions : bouton « Créer un événement » en haut à droite (icône, comme « Ajouter ma salle » sur la page Salles). Compte sans email vérifié : message existant `EMAIL_NOT_VERIFIED`.
- « Mes compétitions » (filtre `mine` existant) : badge « Organisateur » et statut : Brouillon · Publication demandée · Renvoyé (note) · puis les statuts publics existants.
- Page d'une compétition dont l'utilisateur est organisateur : bouton « Gérer » qui ouvre l'espace organisateur.

### 1.2 Créer un événement (lot A)
Un écran, champs :
- Nom (3 à 120), description (1 à 5000).
- Format : Sur place · En ligne · Hybride.
- Pays (TN par défaut), ville, lieu (ville et lieu demandés pour Sur place et Hybride).
- Dates : ouverture et fermeture des inscriptions, début et fin de l'événement (sélecteur existant). Règles identiques au serveur : ouverture < fermeture ; début ≤ fin.
- Prix en TND (0 = gratuit ; envoyé en millimes : 35 TND = 35000), places max (facultatif).
- « Créer le brouillon » → `POST /competitions` ; le slug est fabriqué par l'app depuis le nom (minuscules, chiffres, tirets) + 4 caractères aléatoires ; nom sans lettre latine (arabe) → `event-xxxx` ; slug déjà pris (`TAKEN`) → un nouvel essai avec un autre suffixe.
- Succès : ouverture de l'espace organisateur sur le tableau de bord.

### 1.3 Espace organisateur
Écran `/competitions/[id]/manage`, onglets défilants en haut. Visible seulement pour un organisateur de la compétition (les autres : « Accès réservé aux organisateurs »).

**Lot A**
1. **Tableau de bord**
   - Bandeau de statut : Brouillon / Publication demandée (« en attente de l'admin ») / Renvoyé avec la note de l'admin / statut public.
   - Check-list de publication : description, dates, bannière, au moins une catégorie active, au moins un WOD actif ; chaque point manquant a « Aller à… ».
   - « Demander la publication » : actif quand la check-list est complète et la compétition en brouillon sans demande en cours.
   - Chiffres (`GET /:id/dashboard`) : inscrits, payés, à encaisser, revenu, scores en attente de jugement, validés, refusés.
   - Répartition par catégorie et femmes / hommes, courbe des inscriptions par jour (calculées depuis `GET /:id/registrations`, lot B).
   - Une fois publié : « Partager » (feuille de partage native) avec un texte : nom, dates, ville et le lien de l'app `fitness-league://competitions/<id>` (pas encore de page web par événement).
2. **Général** : modifier nom, description, format, lieu, dates, prix, places (`PUT /:id`) ; bannière : choisir une image, aperçu, envoyer (`PUT /:id/cover`, 1440×596), supprimer (`DELETE /:id/cover`) ; supprimer l'événement (`DELETE /:id`) tant qu'il est en brouillon ; après publication, boutons des statuts suivants autorisés par le serveur (fermer les inscriptions, rouvrir, ouvrir les soumissions…).
3. **Catégories** : liste ordonnée (monter / descendre → `PUT` de `sortOrder`), « Ajouter les catégories modèles » (`POST /:id/categories/templates`), créer / modifier (nom, genre, âge min / max, niveau, places, prix spécifique), activer / désactiver.
4. **WODs** : liste ordonnée (`POST /:id/wods/reorder`), créer / modifier (nom, description, standards, type de score, méthode de points, cap, points max / min, mouvements + points par répétition pour le type « reps par mouvement », vidéo, fenêtre de soumission, spécifique par catégorie), supprimer.

**Lot B**
5. **Planning**
   - Heats : filtres jour / catégorie / WOD / athlète ; créer, modifier (nom, WOD, catégorie, début, durée, nombre de couloirs), supprimer ; « Générer automatiquement » (`POST /:id/heats/auto`) ; couloirs : affecter un inscrit, retirer.
   - Time Table : horloge, heat en cours et prochain heat (calculés depuis `startsAt` + `durationMin`), « X sur Y terminés ».
   - **Retard** [AJOUT] : saisir X minutes → l'app décale le début de tous les heats non commencés (un `PUT` par heat, dans l'ordre ; en cas d'échec : liste des heats non décalés + « Réessayer ») puis publie une annonce « Planning décalé de X min » (`POST /:id/announcements`).
6. **Participants** : liste (`GET /:id/registrations`) avec recherche (nom), filtres catégorie et paiement ; onglet « À encaisser » (paiement en attente, plus ancien d'abord) ; « Marquer payé » avec confirmation (`POST /:id/registrations/:rid/mark-paid`) puis reçu texte à partager (WhatsApp) ; export CSV (fichier partagé).
7. **Équipe** : organisateurs, juges principaux, juges (`GET /:id/staff`) ; ajouter un co-organisateur (recherche d'utilisateur existante → `POST /:id/staff` rôle `ORGANIZER`) ; les juges restent gérés dans le panneau (lecture seule ici, avec explication).
8. **Classement** : par catégorie (`GET /:id/leaderboard`), statut provisoire / final ; « Publier le classement » (`POST /:id/publish-leaderboard`) avec confirmation.
9. **Annonces** : liste et nouvelle annonce (titre, texte) ; mention « visible sur la page de l'événement, sans notification ».
10. **Codes promo** : liste avec utilisations, créer (code, % ou montant, catégorie, utilisations max, expiration ; « quantité N » crée N codes `CODE-1`…`CODE-N` un par un, avec bilan), activer / désactiver, top 5 des plus utilisés.

### 1.4 Commun
- FR / EN / AR (droite à gauche), composants existants (`ListGroup`, `StatusPill`, `SectionHeader`, `Segmented`…).
- Listes longues (300 inscrits et plus) en `FlatList`, recherche locale, tirer pour rafraîchir.
- Erreurs : message du serveur traduit quand il existe, sinon message générique avec « Réessayer » ; boutons désactivés pendant l'envoi.
- Démo hors ligne (`assets/demo/api.json`) : une compétition en brouillon organisée par l'utilisateur de démo, avec ses réponses (dashboard, catégories, WODs, inscriptions, heats, staff, classement, annonces, codes promo).

## 2. Backend (seule exception au « front seul »)

| # | Changement | Détail |
|---|---|---|
| 1 | Création ouverte | `POST /competitions` : tout compte de l'app avec email vérifié, sauf `JUDGE` / `HEAD_JUDGE` (`403 FORBIDDEN` « Judge accounts cannot create competitions »). Remplace la règle « admins et gérants de salle ». Brouillon, créateur organisateur : inchangé. |
| 2 | Sortie du brouillon réservée à l'admin | `setStatus` : si la compétition est en `DRAFT` et que l'utilisateur n'est pas admin de la plateforme → `403 FORBIDDEN` « An admin publishes the competition ». Les autres transitions (`NEXT`) restent à l'organisateur. |
| 3 | Demande de publication | Colonnes `publication_requested_at TIMESTAMPTZ NULL` et `publication_note TEXT NULL` sur `competitions` (migration additive). `POST /competitions/:id/publication-request` (organisateur) : en `DRAFT` seulement ; vérifie bannière, au moins une catégorie active, au moins un WOD actif, sinon `409 PRECONDITION_FAILED` avec `missing: ('COVER' \| 'CATEGORY' \| 'WOD')[]` ; enregistre la date, efface la note ; déjà demandée → renvoie l'état (sans erreur). `POST /admin/competitions/:id/publication-request/return` (admin) : corps `{ note }` (3 à 500 caractères), seulement si une demande est en cours, sinon `409` ; efface la date, enregistre la note. Passage de `DRAFT` à `REGISTRATION_OPEN` par l'admin : efface date et note. Les deux champs sont renvoyés dans le détail et la liste « mine » (organisateur) et dans la liste admin. Journal d'audit pour chaque étape. |

Le backend Rust (partie Compétitions) devra reprendre ces trois règles.

## 3. Panneau admin
- Liste des compétitions : badge « Publication demandée » et ces compétitions en tête, plus anciennes demandes d'abord.
- Détail : « Publier » (`PATCH …/status` → `REGISTRATION_OPEN`) ; « Renvoyer au brouillon » avec un champ « note pour l'organisateur » obligatoire ; la note précédente est affichée si l'événement a déjà été renvoyé.
- Erreur « déjà traité » (deux admins) affichée telle quelle, puis liste rechargée.

## 4. Règles et cas limites
- Modifier un brouillon après la demande : la demande reste ; l'admin publie la version actuelle.
- La check-list de l'app et la vérification du serveur portent sur les mêmes éléments (bannière, catégorie active, WOD actif) ; l'app ajoute description et dates, déjà obligatoires à la création.
- Un organisateur qui perd son rôle (retiré par un autre organisateur) voit « Accès réservé aux organisateurs » au prochain chargement.
- Retard : seuls les heats dont le début est après l'heure actuelle sont décalés ; un heat sans heure de début n'est pas touché.
- Codes promo en lot : un code déjà pris est sauté et signalé dans le bilan.
- Montants affichés en TND à partir des millimes ; arrondi à 3 décimales seulement si nécessaire.

## 5. Tests
- **API (intégration)** : création par un utilisateur normal (brouillon + organisateur) ; refus pour un compte juge ; l'organisateur ne sort pas du brouillon, l'admin si ; demande incomplète → liste `missing` ; demande complète enregistrée ; renvoi sans note refusé ; note visible par l'organisateur ; publication efface la demande ; second traitement → `409`.
- **App (Jest)** : formulaire de création (dates dans le désordre, slug arabe, slug pris → nouvel essai) ; check-list et bouton grisé ; états « en attente » et « renvoyé avec note » ; accès refusé à un non-organisateur ; lot B : « Retard » ne décale que les heats futurs et liste les échecs ; « À encaisser » trié et « Marquer payé » ; codes promo en lot avec un code pris.
- **Panneau admin (Vitest)** : badge et tri, « Publier », renvoi avec note obligatoire.
- **Visuel** : captures de la démo web à 390 px en FR et AR (création, tableau de bord, catégories, WODs, planning, participants).

## 6. Livraison
- Lot A : backend (3 changements) + création + tableau de bord + Général + Catégories + WODs + panneau admin. Lot B : Planning + Participants + Équipe + Classement + Annonces + Codes promo. Un plan d'implémentation par lot.
- Docs : README (qui peut créer un événement), `docs/ARCHITECTURE.md` (routes et règles), `handoff.md`.

## 7. Hors périmètre (phase « sur place », backend nécessaire)
Logo de compétition (aucune route d'envoi), check-in, décharge et formulaire d'inscription, paiement en ligne (prestataire à choisir), saisie des scores au couloir et app juge sur place, lieux / plateaux, notifications (annonces, publication, retard), écrans live et diffusion, équipes, liste d'attente, bénévoles, billetterie.
