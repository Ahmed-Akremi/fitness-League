-- CreateEnum
CREATE TYPE "AnticheatFlagKind" AS ENUM ('SCORE_SPIKE', 'FARMING', 'SHARED_DEVICE', 'BATTLE_COLLUSION');

-- CreateEnum
CREATE TYPE "AnticheatFlagStatus" AS ENUM ('OPEN', 'CLEARED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "anticheat_flags" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "AnticheatFlagKind" NOT NULL,
    "week_start" DATE NOT NULL,
    "details" JSONB NOT NULL,
    "status" "AnticheatFlagStatus" NOT NULL DEFAULT 'OPEN',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anticheat_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "anticheat_flags_status_created_at_idx" ON "anticheat_flags"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "anticheat_flags_user_id_kind_week_start_key" ON "anticheat_flags"("user_id", "kind", "week_start");

-- AddForeignKey
ALTER TABLE "anticheat_flags" ADD CONSTRAINT "anticheat_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

