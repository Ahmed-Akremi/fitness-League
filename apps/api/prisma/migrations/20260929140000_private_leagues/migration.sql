-- CreateEnum
CREATE TYPE "LeagueVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "LeagueScoringPreset" AS ENUM ('STANDARD', 'CONSISTENCY', 'PROGRESS');

-- CreateEnum
CREATE TYPE "LeagueRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateTable
CREATE TABLE "leagues" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "visibility" "LeagueVisibility" NOT NULL DEFAULT 'PRIVATE',
    "invite_code" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "max_members" INTEGER NOT NULL DEFAULT 50,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "scoring_preset" "LeagueScoringPreset" NOT NULL DEFAULT 'STANDARD',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_members" (
    "league_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "LeagueRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ,

    CONSTRAINT "league_members_pkey" PRIMARY KEY ("league_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leagues_slug_key" ON "leagues"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "leagues_invite_code_key" ON "leagues"("invite_code");

-- CreateIndex
CREATE INDEX "leagues_visibility_ends_at_idx" ON "leagues"("visibility", "ends_at");

-- CreateIndex
CREATE INDEX "league_members_user_id_idx" ON "league_members"("user_id");

-- AddForeignKey
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

