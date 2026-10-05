-- CreateEnum
CREATE TYPE "GymWarStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'BYE');

-- CreateEnum
CREATE TYPE "GymWarBracket" AS ENUM ('S', 'M', 'L');

-- AlterTable
ALTER TABLE "gyms" ADD COLUMN     "rating_volatility" DECIMAL(6,5) NOT NULL DEFAULT 0.06,
ADD COLUMN     "wars_opt_out" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "gym_wars" (
    "id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "status" "GymWarStatus" NOT NULL DEFAULT 'ACTIVE',
    "bracket" "GymWarBracket" NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "rule_set_version" INTEGER NOT NULL,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gym_wars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_war_participants" (
    "id" UUID NOT NULL,
    "gym_war_id" UUID NOT NULL,
    "gym_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "member_ids" UUID[],
    "eligible_member_count" INTEGER NOT NULL,
    "active_member_count" INTEGER NOT NULL DEFAULT 0,
    "score" DECIMAL(5,2),
    "breakdown" JSONB NOT NULL DEFAULT '{}',
    "outcome" "BattleOutcome",
    "rating_before" DECIMAL(7,2) NOT NULL,
    "rating_after" DECIMAL(7,2),

    CONSTRAINT "gym_war_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gym_wars_week_start_status_idx" ON "gym_wars"("week_start", "status");

-- CreateIndex
CREATE INDEX "gym_war_participants_gym_war_id_idx" ON "gym_war_participants"("gym_war_id");

-- CreateIndex
CREATE UNIQUE INDEX "gym_war_participants_gym_id_week_start_key" ON "gym_war_participants"("gym_id", "week_start");

-- AddForeignKey
ALTER TABLE "gym_war_participants" ADD CONSTRAINT "gym_war_participants_gym_war_id_fkey" FOREIGN KEY ("gym_war_id") REFERENCES "gym_wars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_war_participants" ADD CONSTRAINT "gym_war_participants_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

