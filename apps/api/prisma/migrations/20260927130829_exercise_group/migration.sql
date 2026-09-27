-- CreateEnum
CREATE TYPE "ExerciseGroup" AS ENUM ('MOVEMENT', 'BENCHMARK_WOD', 'HYROX_STATION', 'HYROX_RACE');

-- AlterTable
ALTER TABLE "exercises" ADD COLUMN     "description_i18n" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "group" "ExerciseGroup";
