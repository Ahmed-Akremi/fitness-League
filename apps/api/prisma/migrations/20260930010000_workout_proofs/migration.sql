-- CreateEnum
CREATE TYPE "ProofKind" AS ENUM ('PHOTO', 'SCREENSHOT');

-- CreateEnum
CREATE TYPE "ProofStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "workouts" ADD COLUMN     "proof_note" TEXT,
ADD COLUMN     "proof_reviewed_at" TIMESTAMPTZ,
ADD COLUMN     "proof_reviewed_by" UUID,
ADD COLUMN     "proof_status" "ProofStatus" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "proof_media" (
    "id" UUID NOT NULL,
    "workout_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "kind" "ProofKind" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proof_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proof_media_workout_id_idx" ON "proof_media"("workout_id");

-- CreateIndex
CREATE INDEX "workouts_proof_status_updated_at_idx" ON "workouts"("proof_status", "updated_at");

-- AddForeignKey
ALTER TABLE "proof_media" ADD CONSTRAINT "proof_media_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proof_media" ADD CONSTRAINT "proof_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

