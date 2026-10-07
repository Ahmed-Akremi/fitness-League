# Accueil : carrousel des compétitions et actualités de l'admin — design

Date : 2026-10-06 · Statut : validé (approche A) · Branche : `feat/home-news`

## 0. Intention

**Demandé par le propriétaire**
- Sur l'Accueil de l'app, une nouvelle compétition apparaît avec sa bannière.
- L'admin publie des publications ; les utilisateurs ne commentent pas, ils réagissent seulement ; une publication = une photo ou du texte, jamais de vidéo.
- Rendu « plus rentable et attractif pour la communauté sportive dans le monde ».

**Choix du propriétaire (questions du brainstorming)**
- Disposition : bannières + fil séparé ; la carte « LP saison » reste **tout en haut** de l'Accueil, le carrousel vient juste en dessous.
- Carrousel : compétitions **publiées et pas finies** (tout sauf `DRAFT`, `FINISHED`, `CANCELLED`).
- Réaction : un seul **❤️ J'aime** (une fois par personne, retirable).
- Photo : **une au maximum** par publication.
- Notification : **oui, dans la cloche**, à chaque publication.
- Approche : **A** — module « publications » séparé du fil social.

**Hypothèses**
- « Admin » = rôles `ADMIN` et `SUPER_ADMIN`, depuis le panneau web.
- Pas de modification d'une publication : on la supprime et on republie.
- « Attractif » s'applique aux nouvelles sections de l'Accueil (carrousel plein écran, cartes d'actualité soignées, J'aime animé, horodatage relatif, états vides et chargement) ; pas de refonte du reste de l'app dans ce lot.

**Critères de réussite**
- Un admin publie depuis le panneau « Publications » (texte, photo, ou les deux) ; un athlète la voit dans « Actualités » sur l'Accueil, avec sa photo, et peut l'aimer / ne plus l'aimer.
- Aucune route ne permet de commenter une publication ; une vidéo ou un fichier non image est refusé (415).
- Chaque athlète actif reçoit une notification `ANNOUNCEMENT` ; juges, admins et comptes suspendus n'en reçoivent pas.
- Les compétitions publiées et pas finies apparaissent dans le carrousel avec leur bannière (ou la bannière par défaut).
- Tests API (unitaires + intégration), admin et RN verts ; lint et typecheck propres.

## 1. Données (`apps/api/prisma`)

```prisma
model Announcement {
  id           String    @id @db.Uuid
  authorId     String    @map("author_id") @db.Uuid
  body         String?                       // ≤ 2000 caractères ; null si photo seule
  imageMediaId String?   @unique @map("image_media_id") @db.Uuid
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz
  author       User      @relation("AnnouncementAuthor", fields: [authorId], references: [id])
  image        Media?    @relation("AnnouncementImage", fields: [imageMediaId], references: [id])
  likes        AnnouncementLike[]
  @@index([createdAt(sort: Desc)])
  @@map("announcements")
}

model AnnouncementLike {
  announcementId String   @map("announcement_id") @db.Uuid
  userId         String   @map("user_id") @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz
  announcement   Announcement @relation(fields: [announcementId], references: [id], onDelete: Cascade)
  user           User         @relation("AnnouncementLiker", fields: [userId], references: [id], onDelete: Cascade)
  @@id([announcementId, userId])
  @@map("announcement_likes")
}
```

- `MediaPurpose` + `ANNOUNCEMENT_IMAGE`. Migration additive `20261006120000_announcements`.
- Photo : PNG/JPEG/WebP (`sniffImage`), ≤ 5 Mo, rotation EXIF appliquée, redimensionnée à 1440 px de large au maximum (proportions conservées, jamais agrandie), WebP qualité 85, clé `announcements/<id>/<hash16>.webp` ; `width`/`height` enregistrés pour que l'app réserve la place.

## 2. API (`src/modules/announcements/`)

| Route | Rôles | Effet |
|---|---|---|
| `POST /admin/announcements` (multipart : `body?`, `file?`) | ADMIN, SUPER_ADMIN (jeton panneau) | Crée ; 422 `VALIDATION` si ni texte ni photo ou texte > 2000 ; 415 si pas une image ; 413 si > 5 Mo. Audit `announcement.published`. Événement outbox `AnnouncementPublished`. |
| `GET /admin/announcements` | ADMIN, SUPER_ADMIN | Liste paginée (curseur) avec `likeCount`. |
| `DELETE /admin/announcements/:id` | ADMIN, SUPER_ADMIN | Suppression douce + média `DELETED` + fichier supprimé ; audit `announcement.deleted` ; 204. |
| `GET /announcements` | utilisateur de l'app | Paginé, plus récentes d'abord, sans les supprimées : `{ id, body, imageUrl, imageWidth, imageHeight, createdAt, likeCount, likedByMe }`. |
| `PUT /announcements/:id/like` | utilisateur de l'app | Idempotent ; renvoie `{ likeCount, likedByMe: true }`. 404 si supprimée/inconnue. |
| `DELETE /announcements/:id/like` | utilisateur de l'app | Idempotent ; renvoie `{ likeCount, likedByMe: false }`. |

- Aucune route de commentaire (c'est la garantie « pas de commentaire »).
- **Notification** : le gestionnaire de l'événement `AnnouncementPublished` (dans le worker) crée, par lots de 1000 (`createMany`), une notification `ANNOUNCEMENT` `{ announcementId, excerpt }` (80 premiers caractères du texte) pour chaque compte de l’app (`role` ∈ {`USER`, `GYM_ADMIN`} — les propriétaires de salle s’entraînent aussi), `status = ACTIVE`, `deletedAt = null`. Pas d'événement `NotificationCreated` par ligne (pas de push configuré) ; la cloche se met à jour à son rafraîchissement.
- **Compétitions** : `GET /competitions?filter=CURRENT` → statut ∉ {`DRAFT`, `FINISHED`, `CANCELLED`}, tri par `eventStart` croissant (même carte que la liste : `coverUrl`, `title`, `status`, `eventStart`, `city`…).

## 3. Panneau admin (`apps/admin`)

- Page **Publications** (`/announcements`, admins seulement, lien dans la barre).
- Formulaire : zone de texte (compteur /2000), choix d'une photo (image seulement, aperçu, retirer), bouton **Publier** désactivé si les deux sont vides ; message d'erreur lisible.
- Liste : date, extrait, miniature, nombre de ❤️, bouton **Supprimer** (confirmation).

## 4. App (`apps/mobile-rn`)

Ordre de l'Accueil : salutation → **LP saison** → **carrousel des compétitions** → rangs → ma salle → objectif → raccourcis → **Actualités** → bouton « Enregistrer une séance ».

- **Carrousel** (`features/home/competition-carousel.tsx`) : pages pleine largeur (bannière 2,4:1, `DEFAULT_COVER` si aucune), dégradé sombre en bas avec titre, pastille de statut et date ; points indicateurs ; toucher → `/competitions/:id`. Masqué si aucune compétition.
- **Actualités** (`features/announcements/`) : carte avec en-tête « Fitness League » + logo + temps relatif (« il y a 2 h ») ; photo à ses proportions (`imageWidth/imageHeight`) ; texte (6 lignes puis « Lire plus ») ; bouton ❤️ + compteur, mise à jour optimiste, petite animation de rebond (désactivée si « réduire les animations »). « Voir plus » charge la page suivante. État vide discret, squelette pendant le chargement. Aucun champ de commentaire.
- **Notification** `ANNOUNCEMENT` : texte « Nouvelle actualité : <extrait> », toucher → Accueil.
- i18n en/fr/ar pour toutes les nouvelles chaînes.
- Démo hors ligne : `GET /competitions?filter=CURRENT` et `GET /announcements` enregistrés (2 publications fictives : une avec texte seul, une avec photo — la bannière par défaut de l'app sert de photo de démo).

## 5. Tests

- API unitaire : `announcementView` (forme de sortie), validation texte/photo.
- API intégration (`test/announcements.int-spec.ts`) : publication texte / photo (WebP ≤ 1440 px), refus vide (422), refus non-image (415), athlète refusé sur `/admin/announcements` (403), liste app (récentes d'abord, `likedByMe`), like idempotent / unlike, publication supprimée absente et non aimable (404), fan-out des notifications (athlète oui ; juge, admin, suspendu non) après `drainAll()`, filtre `CURRENT`.
- Admin (vitest) : bouton Publier désactivé sans contenu ; envoi multipart.
- RN (jest) : Accueil affiche le carrousel et une actualité ; J'aime bascule le compteur et appelle `PUT`/`DELETE` ; la démo répond aux nouvelles routes.

## 6. Hors périmètre

Modification d'une publication, programmation, plusieurs photos, vidéo, commentaires, push FCM, ciblage par pays/salle, statistiques de vues.
