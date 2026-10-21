-- Floor judging (on-site events): app users invited as judges, one judge per lane, a common heat start.
ALTER TYPE "CompetitionStaffRole" ADD VALUE 'FLOOR_JUDGE';
ALTER TABLE "competition_staff" ADD COLUMN "accepted_at" TIMESTAMPTZ;
ALTER TABLE "competition_heats" ADD COLUMN "started_at" TIMESTAMPTZ;
ALTER TABLE "competition_heat_lanes" ADD COLUMN "judge_staff_id" UUID;
ALTER TABLE "competition_heat_lanes" ADD CONSTRAINT "competition_heat_lanes_judge_staff_id_fkey" FOREIGN KEY ("judge_staff_id") REFERENCES "competition_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "competition_heat_lanes_heat_id_judge_staff_id_key" ON "competition_heat_lanes"("heat_id", "judge_staff_id");
