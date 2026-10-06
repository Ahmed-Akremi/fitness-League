# App mobile : espacements resserrés et rendu plus premium — design

Date : 2026-10-06 · Statut : proposé · Périmètre : `apps/mobile-rn` uniquement

## 0. Intention

**Demandé par le propriétaire**
- « Upgrade the UI and fix the UX, too much spaces between text and cards. »
- Priorité : l'app mobile des athlètes (pas le panneau admin).
- Objectif : un rendu plus pro / premium, même structure et même navigation.
- Approche retenue : **A** — corriger à la source (valeurs d'espacement communes + composants partagés), puis passer tous les écrans dessus.

**Constaté sur les captures (390×844, mode démo) et dans le code**
1. Les titres de section flottent à égale distance des cartes : ~32 px au-dessus, ~20 px au-dessous. `SectionHeader` ajoute `paddingTop: 20` + `paddingBottom: 8` au `gap: 12` de `Screen` ; son lien d'action est un `Button` de 40 px de haut.
2. Les listes sont très aérées : les `ListRow` sont posées une par une sur le fond (Profil : 9 lignes de ~64 px, 52 px + 12 px d'écart), sans regroupement.
3. ~50 px vides sous le titre des onglets (« Train », petit, police système) avant le contenu.
4. Lignes d'entraînement hautes pour une seule ligne de texte ; statut « Accepted » en gros contour répété.
5. Raccourcis de l'Accueil tronqués (« Person… », « Compet… »).
6. Bug : l'onglet Objectifs affiche « Something went wrong » en démo hors ligne (`GET /challenges` absent de `assets/demo/api.json` → 404).

**Critères de réussite**
- Un titre de section est visiblement rattaché à son contenu : 12 px titre → contenu, 24 px contenu → section suivante.
- Les listes d'actions (Profil, Réglages, etc.) sont regroupées dans des cartes avec séparateurs fins.
- Aucun texte tronqué sur les raccourcis de l'Accueil à 390 px de large.
- L'onglet Objectifs s'affiche en démo (état vide, pas d'erreur).
- 73 tests RN (+ nouveaux) et typecheck verts ; les `testID` existants sont conservés.
- Captures avant/après des écrans principaux fournies au propriétaire.

**Hors périmètre** : panneau admin, navigation et onglets, nouvelles dépendances, animations, refonte du thème clair (il reçoit seulement les nouveaux jetons).

## 1. Jetons (`src/core/theme/index.ts`)

- `space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }` — seules valeurs d'espacement utilisées dans les composants partagés et les écrans retouchés.
- `Colors.border` : séparateurs et contours fins. Sombre `#FFFFFF14`, clair `#0000000F`.
- `radius` inchangé (`card: 20`, `field: 14`, `pill: 999`).

## 2. Composants partagés

`src/core/widgets/kit.tsx`
- **`Screen`** : `gap: space.md`, `padding: space.lg`, `paddingTop: space.sm` (le titre d'en-tête donne déjà l'air nécessaire).
- **`Card`** : contour `1 px colors.border` en plus du fond `surface` (relief sans ombre, lisible en sombre).
- **`ListRow`** : `minHeight: 48`, `paddingVertical: 10` (au lieu de 52 / 12). Icône à gauche dans `colors.outline` sauf `danger`.
- **`ListGroup`** (nouveau) : `<ListGroup>{lignes}</ListGroup>` — une `Card` à `paddingVertical: space.xs`, `paddingHorizontal: space.sm`, avec un séparateur `hairline colors.border` entre deux enfants (aligné après l'icône, `marginStart: 48`). Les enfants `null`/`false` sont ignorés (pas de séparateur orphelin).
- **`LinkButton`** (nouveau, exporté) : texte `colors.primary`, 14 px gras, `hitSlop: 12`, sans hauteur minimale. Utilisé par `SectionHeader`.

`src/core/widgets/common.tsx`
- **`SectionHeader`** : `paddingTop: space.md`, `paddingBottom: 0`, `paddingHorizontal: space.xs`, action = `LinkButton`. Dans un `Screen` (gap 12) cela donne 24 px au-dessus du titre et 12 px entre le titre et son contenu.
  - Écart volontaire avec la proposition orale (`Section` enveloppante) : corriger `SectionHeader` sur place donne le même résultat visuel sans toucher ses 42 usages. Les rares usages hors `Screen` (conteneur sans `gap`, en-tête de `FlatList`) reçoivent l'espacement de leur conteneur pendant la passe écran par écran.
- **`StatCard`** : `padding: space.lg`, libellé → contenu `marginBottom: 6` (au lieu de 18 / 10), contour `colors.border` comme `Card`.
- **`StatusPill`** (nouveau) : `{ label, color }` — fond `color + '24'`, texte `color` 12 px gras, `paddingHorizontal: 10`, `paddingVertical: 4`, `radius.pill`. Remplace les statuts en contour (entraînements, salles en attente, soumissions de compétition).

## 3. En-têtes (`src/app/(tabs)/_layout.tsx`, `src/features/shell/root.tsx`)

- `headerTitleStyle: { fontFamily: fonts.display, fontSize: 26 }` sur les onglets et la pile, comme l'en-tête de l'Accueil.
- Pas d'autre changement de navigation.

## 4. Passe écran par écran

Règle commune : valeurs d'espacement → `space.*` ; suites de `ListRow` posées sur le fond → `ListGroup` ; statuts en contour → `StatusPill` ; vérifier que chaque `SectionHeader` a 12 px avant son contenu.

| Écran | Changements spécifiques |
|---|---|
| Accueil (`home/screen.tsx`) | Raccourcis : libellé sur 2 lignes max, 12 px, centré, tuile `surface` + contour `border`. Tuiles de rang : `padding: space.md`. |
| Profil (`home/screen.tsx` `ProfileScreen`) | 3 `ListGroup` titrés : **Progression** (progrès, records [Expander], tous les records, badges), **Social** (amis, battles, compétitions), **Compte** (ajouter ma salle, corps, réglages). Nouvelles clés i18n `profileGroupProgress`, `profileGroupSocial`, `profileGroupAccount` (en/fr/ar). |
| Entraînement (`workouts/screens.tsx`) | `WorkoutTile` compact : pastille d'icône 40 px (`sportIcon` si le sport est connu, sinon `fitness-center`), titre date · durée, sous-titre volume/distance, `StatusPill`. `Card` à `padding: space.md`. |
| Ligue, Objectifs/Défis, Compétitions, Salles, WODs de salle, Battles, Social/Amis/Fil, Réglages, Progrès, Badges, Notifications, Ligues, Gym Wars, Saisie de séance, Onboarding/Connexion | Règle commune uniquement. |

## 5. Démo hors ligne

- `assets/demo/api.json` : ajout de `GET /challenges?status=ACTIVE` et `GET /challenges?status=ENDED` → `[]` (l'écran affiche son état vide).

## 6. Tests et vérification

- Nouveaux tests (fichier de tests des widgets existant, sinon `test/core/widgets.test.tsx`) :
  - `ListGroup` : n lignes → n − 1 séparateurs ; un enfant `null` ne crée pas de séparateur.
  - `SectionHeader` : l'action est rendue et appelle `onAction`.
- `test/core/demo.test.ts` : `GET /challenges?status=ACTIVE` répond 200 avec `[]`.
- Tests d'écrans existants inchangés (mêmes `testID`, mêmes textes) ; ceux qui cherchent un statut ou un libellé déplacé sont adaptés si besoin.
- `typecheck` et `test` de `apps/mobile-rn` verts.
- Captures 390×844 avant/après (Accueil, Accueil défilé, Entraînement, Ligue, Objectifs, Profil, Compétition, Salle) copiées dans `Desktop/ui-avant-apres/` pour le propriétaire.

## 7. Risques

- `Card` et `ListRow` sont utilisés ~100 fois : le changement de contour et de hauteur touche toute l'app. Atténuation : captures avant/après de tous les onglets et des écrans les plus chargés.
- `react-native-web` peut rendre `hairlineWidth` à 0 px : utiliser `1` px sur web si les séparateurs disparaissent.
