# Espace organisateur — analyse des écarts avec Circle21 (étapes 1 et 2)

Date : 2026-10-14 · Statut : à valider par le propriétaire · Source : `Desktop/prompt organisation.txt`

**Contrainte du propriétaire (2026-10-14) : frontend uniquement, sans toucher le backend.**
D'où une colonne de plus : **Front seul ?** — « Oui » si l'API actuelle (`apps/api`) suffit, « Non » si une table ou une route serveur manque.

Légende : [AJOUT] = au-delà de Circle21 · [HYPOTHÈSE] = écran Circle21 non observé · [À VÉRIFIER] = à confirmer dans l'app.

## 0. Fitness League aujourd'hui (rempli depuis le code)

| Sujet | Aujourd'hui |
|---|---|
| Description | App de progression sportive (LP, classements, salles, Gym Wars) + module Compétitions (qualifications en ligne jugées sur vidéo YouTube). |
| Modules compétition (API) | Compétition, catégories (+ modèles), WODs (types de score, points par répétition, cap, standards, vidéo), heats + couloirs (création, génération auto), inscriptions + « marquer payé », coupons, prix, staff (organisateur, juge, juge principal), affectation des juges, jugement des vidéos, réclamations, classement + publication, annonces de compétition, bannière. |
| Stack | API NestJS + Prisma + PostgreSQL (backend Rust en cours, même contrat) · app mobile React Native (Expo) · panneau admin React (Vite). Pas de temps réel (pas de WebSocket). |
| Apps | App athlète (mobile) · panneau web pour admins, juges et juges principaux · aucun écran organisateur. |
| Marché | Tunisie d'abord · FR / AR / EN · TND · paiement manuel (l'organisateur marque payé), aucun prestataire en ligne. |
| Qui peut organiser | API : admins de la plateforme et gérants de salle (`GYM_ADMIN`) créent ; tout organisateur d'une compétition peut en ajouter un autre. Aucun écran pour le faire hors panneau admin. |
| Volume visé | **À me donner** (voir questions). |

## 1. Analyse des écarts

| Module | Fonctionnalité (Circle21) | Fitness League aujourd'hui | Écart | Priorité | Effort | Front seul ? |
|---|---|---|---|---|---|---|
| Barre globale | Nom de l'organisateur + type d'événement | Partiel (format En ligne/Sur place/Hybride) | Pas d'écran organisateur | P0 | S | Oui |
| Barre globale | Preview / Publish Event | Partiel (statut `DRAFT` → `REGISTRATION_OPEN` via `PATCH /:id/status`) | Pas de bouton, pas de check-list | P0 | S | Oui |
| Barre globale | États vides qui guident (« Create at least one Division ») | Non | — | P0 | S | Oui [AJOUT check-list de publication] |
| Dashboard | Total Athletes / Judges | Partiel (`/dashboard` : inscrits, paiements, soumissions ; `/staff`) | Pas d'écran | P0 | S | Oui |
| Dashboard | Total Teams / Volunteers | Non (pas d'équipes ni de bénévoles) | Modèle absent | P2 | L | Non |
| Dashboard | Courbe des inscriptions par date | Partiel (`registeredAt` dans `/registrations`) | Calcul côté app | P2 | S | Oui |
| Dashboard | Divisions / Top 5 pays / Top 5 clubs | Partiel (catégories ; club = salle [À VÉRIFIER] dans la réponse `/registrations`) | Calcul côté app | P2 | S | Oui (divisions), [À VÉRIFIER] (clubs) |
| Dashboard | Femmes / Hommes en % ou nombres | Partiel (genre de la catégorie) | Calcul côté app | P2 | S | Oui |
| Dashboard | Facebook Pixel | Non | — | P2 | M | Non |
| Dashboard | Share Event link | Non | — | P1 | S | Oui (partage natif) |
| Dashboard | Send Invitation | Non | — | P2 | M | Non |
| Finance | Gross / Fees / Refunded / Net | Partiel (revenu des inscriptions payées) | Pas de frais ni remboursements (pas de paiement en ligne) | P1 | S | Oui (brut + en attente), Non (frais, remboursements) |
| Finance | Transactions : recherche + export | Partiel (`/registrations` avec statut de paiement) | Recherche, export | P1 | M | Oui (export CSV partagé) |
| Check-in | Athletes / Judges checked-in, par division | Non | Modèle absent | P0 (on-site) | M | **Non** |
| General | Description de l'événement (texte riche)* | Partiel (texte simple) | Pas de mise en forme | P1 | S | Oui (texte simple) |
| General | Organized by (entité légale)* | Non | Champ absent | P1 | S | Non |
| General | Vidéo YouTube de la landing page | Non (vidéo seulement par WOD) | Champ absent | P2 | S | Non |
| General | Rulebook téléchargeable | Non | — | P1 | M | Non |
| General | Contact (email, site)* / réseaux sociaux | Non | Champs absents | P1 | S | Non |
| General | Connect Qualification Event | Non | — | P2 | L | Non |
| General | Suppression de la compétition | Oui (`DELETE /:id`) | Pas d'écran | P1 | S | Oui |
| Divisions | Liste + Re-order + Create Division | Oui (CRUD, `sortOrder`, modèles de catégories) | Pas d'écran organisateur | P0 | M | Oui |
| Divisions | Format Individuals / Team | Partiel (individuel seulement) | Équipes absentes | P1 | L | Non |
| Divisions | Max Participants | Oui | — | P0 | S | Oui |
| Divisions | Lock for Invites (code OTP) | Non | — | P2 | M | Non |
| Divisions | Âge From/To | Oui (`minAge`, `maxAge`) | — | P0 | S | Oui |
| Divisions | Division Standards (texte riche) | Partiel (niveau ; les standards sont sur les WODs) | — | P1 | S | Oui (via WODs) |
| Divisions | Couleur, visibilité | Partiel (`active`) | Couleur absente | P2 | S | Oui (visibilité), Non (couleur) |
| Divisions | Prix par division | Oui (`registrationPriceOverride`) [AJOUT déjà présent] | — | P1 | S | Oui |
| Pricing | Connect Stripe / collecte par la plateforme | Non (paiement manuel) | Prestataire à choisir | P0 | L | **Non** |
| Pricing | Frais plateforme absorbés ou répercutés | Non | — | P2 | M | Non |
| Pricing | TVA | Non | — | P2 | M | Non |
| Pricing | Acompte | Non | — | P2 | M | Non |
| Pricing | Marquer une inscription payée | Oui (`mark-paid`) [AJOUT, utile en Tunisie] | Pas d'écran | P0 | S | Oui |
| Media | Logo 400×400* | Partiel (champ `logoMediaId`, **aucune route d'envoi**) | Envoi impossible | P1 | S | **Non** |
| Media | Couverture 1440×600* | Oui (`PUT /:id/cover`, 1440×596) | Pas d'écran organisateur | P0 | S | Oui |
| Media | Image de l'email de confirmation | Non | — | P2 | S | Non |
| Waiver & Form | Formulaire d'inscription, décharge, mineurs, médical, documents | Non | Modèle absent | P0 (on-site) | L | **Non** |
| Waiver & Form | AI Face Recognition | Non | — | P2 | L | Non |
| Promo Codes | Liste, filtre, recherche | Oui (`/coupons`) | Pas d'écran | P1 | S | Oui |
| Promo Codes | Création : % ou montant, divisions, quantité | Oui (type, valeur, catégorie, `maxUses`, expiration) | Génération en lot | P1 | S | Oui (création répétée côté app) |
| Promo Codes | Stats + top 5 | Partiel (`usedCount`) | Calcul côté app | P2 | S | Oui |
| Promo Codes | Export | Non | — | P2 | S | Oui (CSV partagé) |
| Organization | Équipe organisatrice | Partiel (staff `ORGANIZER`, co-organisateurs possibles) | Structure, rôle libre, t-shirt | P1 | S | Oui (liste + ajout), Non (champs en plus) |
| Settings | Max Individuals | Oui (`maxParticipants`) | — | P0 | S | Oui |
| Settings | Masquer le nombre d'inscrits, onglet Athletes, coach | Non | — | P2 | M | Non |
| Settings | Liste d'invités / inscription réservée | Non | — | P2 | M | Non |
| Settings | Email de confirmation personnalisé, notification par inscription | Non | — | P2 | M | Non |
| Settings | Brand colors, Meta Business, drapeau neutre, partenariats | Non | — | P2 | M | Non |
| Participants | Individuals | Oui (`/registrations`) | Pas d'écran | P0 | S | Oui |
| Participants | Teams / Waiting List | Non | — | P1 | L | Non |
| Participants | Judges : liste, rôle | Partiel (`/staff`, juges = comptes du panneau) | Ajout réservé aux comptes juges | P0 | S | Oui (liste), Partiel (ajout : comptes juges existants) |
| Participants | Volunteers, Host/Manager, Sponsors | Non | — | P2 | M | Non |
| Staff | Forms + Applications (candidatures) | Non | — | P2 | L | Non |
| Planning | Workouts : Create Workout | Oui (CRUD, ordre, mouvements + points par rép., cap, standards, vidéo) | Pas d'écran organisateur | P0 | M | Oui |
| Planning | Locations / Stages | Non (heats sans lieu) | Modèle absent | P1 (un seul plateau suffit au début) | M | Non |
| Planning | Heats : création, auto, couloirs | Oui (`/heats`, `/heats/auto`, `/lanes`) | Pas d'écran | P0 | M | Oui |
| Planning | Heats : filtres jour/division/workout/athlète | Partiel | Calcul côté app | P0 | S | Oui |
| Planning | Heats : Publish | Partiel (heats visibles dès qu'ils existent [À VÉRIFIER côté athlète]) | Pas de brouillon de planning | P1 | S | Non |
| Planning | Time Table : horloge, heat actif, X sur Y terminés | Partiel (`startsAt`, `durationMin`) | Calcul côté app | P0 | S | Oui |
| Scoring | Leaderboard + filtres + recherche | Oui (`/leaderboard`) | Pas d'écran organisateur | P0 | S | Oui |
| Scoring | Saisie by HEAT's (juge au couloir) | Non (scores = soumission vidéo de l'athlète, revue par le juge) | Saisie sur place absente | P0 (on-site) | L | **Non** |
| Scoring | Visibility Policy | Partiel (provisoire / final, publication) | Ordre aléatoire, masqué | P1 | S | Oui (publier), Non (le reste) |
| Scoring | Live Scoring (mot de passe app juge) | Non | — | P0 (on-site) | L | Non |
| Scoring | Import Results | Non | — | P2 | M | Non |
| Scoring | Nombre de finalistes, filtres d'âge, représentation | Non | — | P2 | M | Non |
| Messaging | Direct Chat + étiquettes | Non | — | P2 | L | Non |
| Messaging | Mass Messaging (email + notif) | Partiel (annonces de compétition : stockées et affichées, **sans notification**) | Pas de notification | P0 | S | Oui (annonce), Non (notification) |
| Tools | Overlays de diffusion | Non | — | P2 | L | Non |
| Tools | Integration (leaderboard intégrable) | Non | — | P2 | M | Non |
| Tools | Timer local | Non | — | P1 | S | Oui |
| Tools | Timer piloté à distance | Non | Temps réel absent | P2 | L | Non |
| Tools | Écrans live (slider, leaderboard, heat actif, couloir) | Non | — | P1 | M | Partiel [HYPOTHÈSE : écran web connecté avec le compte organisateur, rafraîchi toutes les 15 s] |
| Spectators | Billetterie | Non | — | P2 | L | Non |
| Shop | Boutique | Non | — | P2 | L | Non |

**Ce que la contrainte « front seul » laisse de côté parmi les P0 :** check-in, décharge et formulaire d'inscription, paiement en ligne, saisie des scores au couloir et app juge on-site, notifications des annonces. Ce sont les briques d'un événement **sur place**. En front seul, l'espace organisateur couvre très bien un événement **en ligne** (le cas actuel de Fitness League) et prépare la partie sur place (WODs, heats, planning).

## 2. Au-delà de Circle21 (solutions qui restent en front seul quand c'est possible)

| Faiblesse Circle21 | Proposition [AJOUT] | Front seul ? |
|---|---|---|
| 1. Pas de validation des scores par le head judge | Déjà dans Fitness League : revue des vidéos (approuvé / refusé / en revue), juge principal, journal d'audit, classement provisoire puis final. Dans l'espace organisateur : carte « Jugement » (en attente / validés / refusés, depuis `/dashboard`) et lien vers le panneau des juges. | Oui |
| 2. Pas de décalage en cascade | Bouton « Retard » sur le Time Table : saisir X minutes, l'app décale `startsAt` de tous les heats suivants (un `PUT` par heat, avec reprise si l'un échoue) puis publie une annonce « Planning décalé de X min ». La notification push viendra quand le backend l'enverra. | Oui (décalage + annonce), Non (notification) |
| 3. Réclamations par simples étiquettes | Déjà dans Fitness League : réclamation liée à la soumission, raison, statut, réponse, date limite (`appealDeadline`). Dans l'espace organisateur : liste des réclamations (`/appeals`) avec la vidéo et le score ; la décision reste aux juges. | Oui (lecture) |
| 4. Hors-ligne non documenté | Organisateur : écrans lisibles hors ligne à partir des dernières données (cache local), actions mises en file et renvoyées au retour du réseau. Juges : nécessite le backend. | Partiel |
| 5. Interface en anglais seulement | Déjà résolu : FR / AR (droite à gauche) / EN dans l'app et la landing page. | Oui |
| 6. Paiement centré sur Stripe | Paiement manuel déjà là (« marquer payé », coupons, prix par division). Ajout front : liste « À encaisser » triée, encaissement en un geste, reçu à partager sur WhatsApp. Prestataires locaux (Konnect, Flouci, D17) : backend + choix du propriétaire. | Oui (manuel), Non (en ligne) |
| 7. Doublons Volunteers / Staff | Un seul écran « Équipe » (organisateurs, juges principaux, juges) au lieu de deux menus. | Oui |

**Spécificités du marché tunisien :** paiement en espèces ou virement (encaissement manuel, reçu WhatsApp) ; partage par WhatsApp plutôt que par email ; club = salle (déjà dans l'app) ; arabe de droite à gauche ; TND par défaut ; horaires de heats compatibles avec le Ramadan (planning facile à décaler).

## 3. Proposition de périmètre « front seul » (à valider)

Espace organisateur **dans l'app mobile**, ouvert depuis « Mes compétitions » pour les compétitions où l'utilisateur est organisateur. Onglets proposés, tous servis par l'API actuelle :

1. **Tableau de bord** : chiffres clés, check-list de publication, partage du lien.
2. **Général** : infos, dates, prix, bannière, statut (publier, fermer les inscriptions…), suppression.
3. **Catégories** : liste, ordre, création depuis un modèle, âge, places, prix par catégorie.
4. **WODs** : création et ordre, mouvements et points par répétition.
5. **Planning** : heats, couloirs, génération auto, Time Table avec bouton « Retard ».
6. **Participants** : inscrits, recherche, « À encaisser », marquer payé, export.
7. **Équipe** : organisateurs, juges principaux, juges (lecture ; ajout d'un co-organisateur).
8. **Classement** : par catégorie, publication.
9. **Annonces** : publier une annonce de compétition.
10. **Codes promo** : liste, création (y compris en lot), statistiques.

Restent hors périmètre tant que le backend ne bouge pas : la demande de compétition validée par l'admin (partie 1), le logo de la compétition, le check-in, la décharge, le paiement en ligne, la saisie des scores sur place, les notifications.
