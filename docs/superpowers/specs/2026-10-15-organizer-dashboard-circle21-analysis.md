# Tableau de bord organisateur — inventaire, écarts avec Circle21, plan priorisé

Date : 2026-10-15 · Statut : **à valider par le propriétaire avant toute implémentation** · Source : `C:\Users\GIGABYTE\circle21-dashboard-improvement-prompt.md` (étapes 1 à 3)

Choix du propriétaire déjà faits (2026-10-15) et repris ici :
- **front seul** (rien sous `apps/api` ni `apps/admin`) ;
- **version web large** de l'espace organisateur de l'app (approche A : même écran, menu à gauche sur ordinateur), séparée du panneau admin ;
- **téléphone inchangé** (ses 11 onglets restent) ;
- **local seulement** pour l'instant (pas de site publié).

Légende : **F** = faisable en front seul · **B** = demande le backend (hors de ce lot) · [AJOUT] = au-delà de Circle21.

## 1. Inventaire de l'espace organisateur actuel

**Pile technique.** App Expo / React Native (`apps/mobile-rn`), ouverte aussi dans le navigateur (react-native-web). Navigation Expo Router. Données : React Query ; chaque modification invalide `['competitions']` (lot A `useRefreshCompetition`). Composants maison (`core/widgets/kit.tsx`, `common.tsx`, `pickers.tsx` : `Screen`, `Card`, `ListRow`, `ListGroup`, `Chip`, `Segmented`, `Dialog`, `StatusPill`, `EmptyState`, `Loading`, `SkeletonList`, `toast`). Textes FR / EN / AR. Aucun secret côté client (seule l'adresse de l'API, `EXPO_PUBLIC_*`).

**Accès.** Connexion du compte de l'app (jeton Bearer + renouvellement). Route `/competitions/:id/manage` ; visible si `myRoles` contient `ORGANIZER`, sinon « Accès réservé aux organisateurs ». Depuis le 2026-10-15, un lien tapé dans le navigateur ouvre bien la page (après connexion).

**Navigation.** Une rangée de 11 onglets (puces défilantes) en haut, identique sur téléphone et sur ordinateur. Sur ordinateur, le contenu prend **toute la largeur de la fenêtre** (champs de plus de 1 400 px à 1440 px).

| Onglet | Données (routes appelées) | Actions |
|---|---|---|
| Tableau de bord | `GET /competitions/:id`, `GET …/dashboard`, `GET …/registrations` | bandeau de statut, check-list de publication avec « Aller à… », « Demander la publication » (`POST …/publication-request`), chiffres (inscrits, payés, à encaisser, revenu, scores à juger, validés, refusés), répartition par catégorie, femmes / hommes / mixtes (nombres), inscriptions par jour (barres), « Partager » |
| Général | `PUT /competitions/:id`, `PUT/DELETE …/cover`, `PATCH …/status`, `DELETE /competitions/:id` | nom, description, format, lieu, 4 dates, prix, places, bannière, statuts suivants (avec confirmation), suppression du brouillon |
| Catégories | `POST/PUT …/categories`, `POST …/categories/templates` | liste ordonnée (monter / descendre), modèles, création / modification, activer / désactiver |
| WODs | `POST/PUT/DELETE …/wods`, `POST …/wods/reorder` | liste ordonnée, formulaire (type de score, méthode de points, cap, mouvements + points par répétition, vidéo, fenêtre, versions par catégorie, date de publication) |
| Planning | `GET/POST/PUT/DELETE …/heats`, `POST …/heats/auto`, `POST/DELETE …/heats/:h/lanes` | horloge du jour + « Retard » (+ annonce), filtres jour / catégorie / WOD / athlète, heat (créer, modifier, supprimer), génération auto, couloirs |
| Participants | `GET …/registrations`, `POST …/registrations/:r/mark-paid` | recherche sans accents, filtres paiement / catégorie, « À encaisser », « Marquer payé » (+ reçu partagé), CSV partagé en texte |
| Équipe | `GET/POST/DELETE …/staff`, `GET /search/athletes`, `GET /me` | organisateurs, juges principaux, juges (lecture), ajouter (avec confirmation) / retirer un co-organisateur |
| Classement | `GET …/leaderboard?categoryId=` | par catégorie, provisoire / final, lecture seule (publication par le juge principal dans le panneau) |
| Annonces | `GET/POST …/announcements` | publier, liste (aussi sur la page publique de l'événement) |
| Codes promo | `GET/POST …/coupons`, `POST …/coupons/:c/activate|deactivate` | top 5, liste, un code ou un lot CODE-1…N avec bilan, activer / désactiver |

**Transversal aujourd'hui.**
- Export : un seul, le CSV des participants, partagé en texte (pas de fichier).
- Temps réel : aucun sur les compétitions (rechargement après chaque modification, tirer pour rafraîchir sur Participants).
- Retours : confirmations avant suppression ou action lourde (heat, événement, co-organisateur, statut, « Marquer payé ») ; toasts seulement pour les annonces ; erreurs traduites sous le formulaire ; double tap bloqué partout.
- Chargement : roue (`Loading`) ; pas de squelette dans l'espace organisateur.
- Listes longues : `FlatList` pour les inscriptions et le choix des couloirs ; heats et codes en liste simple.
- Accessibilité : boutons icône avec libellé (`IconButton label`), puces avec rôle et état « sélectionné » ; pas de vérification du focus clavier ni du contraste des textes secondaires sur le web.

## 2. Analyse des écarts avec la référence

| Capacité | Référence (Circle21) | Nous | Gravité | Effort | Recommandation |
|---|---|---|---|---|---|
| Architecture de l'information | menu à gauche groupé par étape (Overview, General, Participants, Planning, Scoring, Messaging, Tools) | 11 onglets à plat en haut | Haute | M | menu groupé sur ordinateur (déjà validé, approche A) — **F** |
| Largeur et densité sur ordinateur | pages et tableaux pensés pour l'écran large | contenu étiré sur toute la fenêtre, listes de téléphone | Haute | S | conteneur centré (page ≤ 1200 px, formulaires ≤ 720 px), tableaux sur écran large — **F** |
| Vue d'ensemble | tuiles KPI, divisions, top 5 clubs / pays, genre en % ou nombres, partage, invitation | chiffres, catégories, genre en nombres, par jour, partage | Moyenne | S | ajouter juges, bascule % / nombres, grille — **F** ; clubs / pays — **B** (pas dans les inscriptions) |
| Finances | revenu brut, frais, remboursé, net, transactions + export | revenu payé seulement | Haute | M | page Finances depuis les inscriptions (brut, remises, encaissé, à encaisser, gratuits, remboursé) + transactions — **F** ; frais en ligne — **B** |
| Fiche athlète (divulgation progressive) | ligne résumée → panneau détaillé (licence, contact d'urgence, solde, décharge, mineurs) | une ligne, aucun détail | Moyenne | M | panneau de détail : catégorie, prix, remise, paiement, date, heats et couloirs de l'athlète, actions — **F** ; décharge, urgence, mineurs — **B** |
| Actions en lot | import / export, actions groupées | aucune (sauf codes promo en lot) | Moyenne | M | sélection multiple « À encaisser » → « Marquer payé » en lot avec bilan (comme les codes) — **F** |
| Filtres et recherche | filtres division / genre / pays / club, recherche partout | participants et heats : recherche + filtres ; classement : catégorie | Basse | S | recherche d'athlète sur le classement ; filtre genre sur les participants — **F** |
| Moteur d'export | un seul flux d'export partout (athlètes, équipes, heats, finances, juges, codes…) | CSV participants en texte | Haute | S | un seul `exportCsv` : fichier téléchargé sur le web, partage sur téléphone ; branché sur Participants, Finances, Heats (feuille des couloirs), Codes promo, Équipe, Classement — **F** ; Excel natif (.xlsx) — nouvelle dépendance, non |
| Retours CRUD | cache + invalidation, toasts de succès, confirmations | cache + invalidation, confirmations ; toasts rares | Basse | S | toast de succès après chaque enregistrement / suppression — **F** |
| Mises à jour optimistes | oui | non | Basse | S | bascule actif / inactif des codes promo en optimiste (retour arrière si erreur) — **F** |
| Temps réel | Pusher (chat, live, classement) | aucun | Moyenne | S (F) / L (B) | rafraîchissement auto toutes les 30 s sur Time Table et Classement tant que la page est ouverte — **F** ; vrai temps réel — **B** |
| Formulaires | constructeur de formulaires, candidatures | aucun | Basse | L | — **B** |
| États vides / chargement / erreur | états vides qui guident (« Create at least one Division ») | messages simples ; roue de chargement | Moyenne | S | états vides avec action vers la bonne page ; squelettes de liste — **F** |
| Planning | WOD très riche, heats, time table, export PDF | WOD + versions + date de publication ; heats ; horloge + « Retard » [AJOUT] | Basse | M | séparer Heats / Time Table sur ordinateur, liste des heats du jour — **F** ; rounds, tie-breaks, multiplicateurs — **B** |
| Scoring | figer / rafraîchir, modifier les scorecards, revue head judge, notes | classement en lecture | Moyenne | — | export par catégorie + recherche — **F** ; le reste — **B** (et déjà au panneau des juges) |
| Messaging | chat temps réel + diffusion | annonces sans notification | Moyenne | — | — **B** (notifications) |
| Tools (live) | overlays de diffusion, slider, timers | aucun | Basse | L | — **B** / plus tard |
| Responsive téléphone | oui | oui (conçu pour le téléphone) | — | — | inchangé (choix du propriétaire) |
| Accessibilité (WCAG 2.2) | — | libellés présents ; focus clavier et contraste non vérifiés sur le web | Moyenne | S | focus visible au clavier sur le web, cibles ≥ 24 px (2.5.8), contraste des textes secondaires ≥ 4,5:1, ordre de tabulation menu → contenu — **F** |
| Performance | SPA, pagination | `FlatList` sur les longues listes ; heats et codes en liste simple | Basse | S | tableau des participants en `FlatList` aussi sur ordinateur ; pas de changement ailleurs |
| Sécurité (anti-modèle de la référence) | jeton Vimeo dans le JS client | aucun secret client | — | — | garder la règle : aucun secret dans l'app |

## 3. Plan priorisé (front seul, en version web large sauf mention)

Ordre : gains rapides d'abord, puis gros impact. Chaque point reprend un modèle de la référence.

### Gains rapides

1. **Mise en page large et conteneur centré.** Problème : sur ordinateur, tout est étiré. Changement : sur le web à partir de 1024 px, page centrée ≤ 1200 px, formulaires ≤ 720 px, grilles pour les cartes. Modèle : pages denses de la référence. Acceptation : à 1440 px, aucun champ plus large que 720 px, pas de défilement horizontal ; à 390 px, rendu identique à aujourd'hui.
2. **Moteur d'export unique.** Problème : un seul export, en texte. Changement : `exportCsv(nom, lignes)` (cellules protégées contre les formules) → téléchargement d'un fichier `<slug>-<liste>.csv` sur le web, feuille de partage sur téléphone ; bouton « Exporter » identique sur Participants, Finances, Heats (feuille des couloirs), Codes promo, Équipe, Classement. Modèle : export engine. Acceptation : chaque liste a « Exporter » ; le fichier s'ouvre dans un tableur avec les bons accents (UTF-8 avec BOM).
3. **États vides qui guident.** Problème : messages sans suite. Changement : WODs / Heats sans catégorie → « Crée d'abord une catégorie » + bouton ; Heats sans WOD → « Ajoute un WOD » ; Time Table sans heat à l'heure → bouton vers Heats ; Classement sans WOD → bouton vers WODs. Modèle : « Create at least one Division ». Acceptation : chaque cas a un test d'écran qui suit le bouton.
4. **Toasts de succès et squelettes.** Problème : retours inégaux, roue de chargement. Changement : toast après chaque enregistrement / suppression ; `SkeletonList` sur les listes. Acceptation : chaque mutation de l'espace organisateur affiche un toast traduit.
5. **Accessibilité web.** Changement : focus visible au clavier, cibles ≥ 24 px, contraste des textes secondaires vérifié, ordre de tabulation menu → contenu. Acceptation : parcours clavier complet d'une page sans souris ; contraste ≥ 4,5:1 mesuré sur les deux thèmes.

### Gros impact

6. **Menu groupé + barre du haut (approche A).** Menu à gauche : Tableau de bord (Vue d'ensemble, Finances) · Général (Infos, Catégories, Codes promo, Équipe) · Participants · Planning (WODs, Heats, Time Table) · Classement · Messages (Annonces). Barre du haut : nom, format, statut, dates d'inscription, « Aperçu », « Demander la publication », « Partager ». Repères dans le menu (point si la check-list manque un élément, nombre « À encaisser »). Acceptation : chaque page s'ouvre depuis le menu ; « Aller à… » ouvre la bonne sous-page ; en réduisant la fenêtre on retrouve les 11 onglets.
7. **Vue d'ensemble enrichie.** Tuiles KPI (dont juges), genre en nombres ou en %, catégories, inscriptions par jour, partage. Acceptation : les chiffres concordent avec ceux de `/dashboard` et des inscriptions ; la bascule % / nombres fonctionne.
8. **Finances.** Brut, remises des codes, encaissé, à encaisser, gratuits, remboursé ; tableau des transactions (date, nom, catégorie, prix, remise, montant, paiement) avec recherche, filtre et export. Mention « paiement manuel, pas de frais ». Acceptation : somme des montants = encaissé + à encaisser + remboursé sur les données de démo.
9. **Participants en tableau + fiche détaillée + lot.** Tableau sur ordinateur ; clic sur une ligne → panneau (catégorie, prix, remise, paiement, date, heats et couloirs) avec « Marquer payé » et reçu ; sélection multiple dans « À encaisser » → « Marquer payé » en lot, une requête à la fois, bilan (payées, déjà réglées, erreur qui arrête). Modèle : rich per-athlete record, bulk actions. Acceptation : deux taps ne lancent qu'un lot ; un 409 au milieu est compté « déjà réglée » et le reste continue.
10. **Planning : Heats et Time Table séparés.** Time Table : horloge, « Retard », liste des heats du jour (terminé / en cours / à venir). Acceptation : la liste suit la même règle de jour que « Retard ».
11. **Rafraîchissement auto** toutes les 30 s sur Time Table et Classement, seulement quand la page est affichée. Modèle : leaderboard refresh. Acceptation : un test vérifie le second appel après 30 s et aucun appel une fois la page quittée.
12. **Classement : recherche + export par catégorie ; codes promo : bascule optimiste.** Acceptation : la recherche sans accents trouve l'athlète ; une erreur de bascule remet l'état d'avant et l'explique.

### Demandent le backend (pas dans ce lot)

Import et ajout manuel d'athlètes, contact d'urgence, décharge et signature, mineurs, équipes, liste d'attente, top clubs / pays, candidatures de juges et bénévoles, sponsors, constructeur de formulaires, « organisé par », règlement, réseaux, contact, vidéo de présentation, WOD avancé (rounds, tie-breaks, multiplicateurs), figer le classement, modifier les scorecards, notes internes, chat et notifications, écrans live, paiement en ligne et frais, analytique (GA / Pixel), assistant IA, reconnaissance faciale, export Excel natif (nouvelle dépendance).

## 4. Proposition de découpage

- **Lot web 1** : points 1, 6, 2, 3 (la structure, l'export, les états vides) — c'est ce qui change le plus la sensation « outil d'ordinateur ».
- **Lot web 2** : points 7, 8, 9, 10 (les pages riches).
- **Lot web 3** : points 4, 5, 11, 12 (finitions, accessibilité, rafraîchissement).

Chaque lot : une spec courte si besoin, un plan, tests d'abord, captures FR / AR à 1440 px, revue indépendante à la fin.
