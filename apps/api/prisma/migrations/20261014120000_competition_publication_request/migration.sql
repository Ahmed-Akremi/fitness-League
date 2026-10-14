-- Organizer space: the organizer asks the admins to publish a draft; an admin publishes it or sends it back with a note.
ALTER TABLE "competitions" ADD COLUMN "publication_requested_at" TIMESTAMPTZ;
ALTER TABLE "competitions" ADD COLUMN "publication_note" TEXT;
