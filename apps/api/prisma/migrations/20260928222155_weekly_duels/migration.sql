-- CreateEnum
CREATE TYPE "DuelQueueStatus" AS ENUM ('WAITING', 'MATCHED', 'GHOST', 'LEFT');

-- CreateTable
CREATE TABLE "mmr_ratings" (
    "user_id" UUID NOT NULL,
    "rating" DECIMAL(7,2) NOT NULL DEFAULT 1500,
    "rd" DECIMAL(6,2) NOT NULL DEFAULT 350,
    "volatility" DECIMAL(6,5) NOT NULL DEFAULT 0.06,
    "games" INTEGER NOT NULL DEFAULT 0,
    "last_period" DATE,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mmr_ratings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "duel_queue_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DuelQueueStatus" NOT NULL DEFAULT 'WAITING',
    "battle_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "duel_queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "duel_queue_entries_week_start_status_idx" ON "duel_queue_entries"("week_start", "status");

-- CreateIndex
CREATE UNIQUE INDEX "duel_queue_entries_user_id_week_start_key" ON "duel_queue_entries"("user_id", "week_start");

-- AddForeignKey
ALTER TABLE "mmr_ratings" ADD CONSTRAINT "mmr_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duel_queue_entries" ADD CONSTRAINT "duel_queue_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
