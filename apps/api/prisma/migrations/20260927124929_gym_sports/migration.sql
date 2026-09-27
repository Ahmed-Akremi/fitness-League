-- Accent-insensitive gym search (spec §2).
CREATE EXTENSION IF NOT EXISTS unaccent;
-- Immutable wrapper so it can be used in an index.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
CREATE INDEX gyms_name_unaccent_idx ON gyms (lower(f_unaccent(name)) text_pattern_ops);

-- CreateTable
CREATE TABLE "gym_sports" (
    "gym_id" UUID NOT NULL,
    "sport_id" UUID NOT NULL,

    CONSTRAINT "gym_sports_pkey" PRIMARY KEY ("gym_id","sport_id")
);

-- CreateIndex
CREATE INDEX "gym_sports_sport_id_idx" ON "gym_sports"("sport_id");

-- AddForeignKey
ALTER TABLE "gym_sports" ADD CONSTRAINT "gym_sports_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_sports" ADD CONSTRAINT "gym_sports_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
