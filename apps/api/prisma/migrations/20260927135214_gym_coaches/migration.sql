-- CreateEnum
CREATE TYPE "GymMemberRole" AS ENUM ('MEMBER', 'COACH');

-- AlterTable
ALTER TABLE "gym_members" ADD COLUMN     "role" "GymMemberRole" NOT NULL DEFAULT 'MEMBER';
