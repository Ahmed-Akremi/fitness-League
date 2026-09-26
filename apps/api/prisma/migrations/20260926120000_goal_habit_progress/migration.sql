-- HABIT goals: consecutive weeks meeting the target.
ALTER TABLE "goals" ADD COLUMN "habit_weeks_met" INTEGER NOT NULL DEFAULT 0;
