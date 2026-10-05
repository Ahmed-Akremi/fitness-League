-- CreateTable
CREATE TABLE "competition_heats" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "workout_id" UUID,
    "category_id" UUID,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ,
    "duration_min" INTEGER,
    "lane_count" INTEGER NOT NULL DEFAULT 8,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "competition_heats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_heat_lanes" (
    "id" UUID NOT NULL,
    "heat_id" UUID NOT NULL,
    "lane" INTEGER NOT NULL,
    "registration_id" UUID NOT NULL,

    CONSTRAINT "competition_heat_lanes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competition_heats_competition_id_starts_at_idx" ON "competition_heats"("competition_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "competition_heats_competition_id_workout_id_number_key" ON "competition_heats"("competition_id", "workout_id", "number");

-- CreateIndex
CREATE INDEX "competition_heat_lanes_registration_id_idx" ON "competition_heat_lanes"("registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "competition_heat_lanes_heat_id_lane_key" ON "competition_heat_lanes"("heat_id", "lane");

-- CreateIndex
CREATE UNIQUE INDEX "competition_heat_lanes_heat_id_registration_id_key" ON "competition_heat_lanes"("heat_id", "registration_id");

-- AddForeignKey
ALTER TABLE "competition_heats" ADD CONSTRAINT "competition_heats_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_heats" ADD CONSTRAINT "competition_heats_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "competition_workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_heats" ADD CONSTRAINT "competition_heats_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_heat_lanes" ADD CONSTRAINT "competition_heat_lanes_heat_id_fkey" FOREIGN KEY ("heat_id") REFERENCES "competition_heats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_heat_lanes" ADD CONSTRAINT "competition_heat_lanes_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "competition_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

