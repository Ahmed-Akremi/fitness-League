-- AlterEnum
ALTER TYPE "MediaPurpose" ADD VALUE 'GYM_LOGO';

-- AlterEnum
ALTER TYPE "MediaStatus" ADD VALUE 'DELETED';

-- AddForeignKey
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_logo_media_id_fkey" FOREIGN KEY ("logo_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
