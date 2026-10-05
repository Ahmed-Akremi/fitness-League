-- Competition banner uploaded from the admin panel (one per competition, replaceable).
ALTER TYPE "MediaPurpose" ADD VALUE 'COMPETITION_COVER';
UPDATE "competitions" SET "cover_media_id" = NULL WHERE "cover_media_id" IS NOT NULL AND "cover_media_id" NOT IN (SELECT "id" FROM "media");
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
