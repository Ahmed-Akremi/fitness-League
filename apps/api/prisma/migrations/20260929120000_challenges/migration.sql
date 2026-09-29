-- CreateEnum
CREATE TYPE "ChallengeScope" AS ENUM ('PERSONAL', 'FRIEND', 'COMMUNITY', 'GYM');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChallengeMetric" AS ENUM ('WORKOUTS', 'TRAINING_DAYS', 'DURATION_MIN', 'DISTANCE_KM', 'VOLUME_KG');

-- CreateTable
CREATE TABLE "challenges" (
    "id" UUID NOT NULL,
    "scope" "ChallengeScope" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metric" "ChallengeMetric" NOT NULL,
    "target_value" DECIMAL(12,1) NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "gym_id" UUID,
    "created_by" UUID NOT NULL,
    "xp_reward" INTEGER NOT NULL DEFAULT 0,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_participants" (
    "challenge_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "progress_value" DECIMAL(12,1) NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ,
    "xp_transaction_id" UUID,

    CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("challenge_id","user_id")
);

-- CreateIndex
CREATE INDEX "challenges_scope_ends_at_idx" ON "challenges"("scope", "ends_at");

-- CreateIndex
CREATE INDEX "challenges_gym_id_idx" ON "challenges"("gym_id");

-- CreateIndex
CREATE INDEX "challenge_participants_user_id_completed_at_idx" ON "challenge_participants"("user_id", "completed_at");

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

