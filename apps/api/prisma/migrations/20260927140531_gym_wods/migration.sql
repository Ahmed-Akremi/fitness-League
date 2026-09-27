-- CreateEnum
CREATE TYPE "WodScoreType" AS ENUM ('FOR_TIME', 'AMRAP', 'MAX_LOAD');

-- CreateEnum
CREATE TYPE "GymWodStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WodDivision" AS ENUM ('RX', 'SCALED');

-- CreateEnum
CREATE TYPE "WodScoreStatus" AS ENUM ('VALID', 'INVALIDATED');

-- CreateTable
CREATE TABLE "gym_wods" (
    "id" UUID NOT NULL,
    "gym_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "score_type" "WodScoreType" NOT NULL,
    "time_cap_s" INTEGER,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "status" "GymWodStatus" NOT NULL DEFAULT 'PUBLISHED',
    "sport_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gym_wods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_wod_scores" (
    "id" UUID NOT NULL,
    "wod_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "division" "WodDivision" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "rounds" INTEGER,
    "reps" INTEGER,
    "workout_id" UUID NOT NULL,
    "status" "WodScoreStatus" NOT NULL DEFAULT 'VALID',
    "invalidated_by" UUID,
    "invalidation_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gym_wod_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gym_wods_gym_id_status_ends_at_idx" ON "gym_wods"("gym_id", "status", "ends_at");

-- CreateIndex
CREATE INDEX "gym_wod_scores_wod_id_division_status_value_idx" ON "gym_wod_scores"("wod_id", "division", "status", "value");

-- CreateIndex
CREATE UNIQUE INDEX "gym_wod_scores_wod_id_user_id_key" ON "gym_wod_scores"("wod_id", "user_id");

-- AddForeignKey
ALTER TABLE "gym_wods" ADD CONSTRAINT "gym_wods_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_wods" ADD CONSTRAINT "gym_wods_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_wods" ADD CONSTRAINT "gym_wods_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_wod_scores" ADD CONSTRAINT "gym_wod_scores_wod_id_fkey" FOREIGN KEY ("wod_id") REFERENCES "gym_wods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_wod_scores" ADD CONSTRAINT "gym_wod_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_wod_scores" ADD CONSTRAINT "gym_wod_scores_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
