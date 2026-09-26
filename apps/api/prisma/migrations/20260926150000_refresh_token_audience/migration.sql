-- Admin sessions are separate from app sessions (docs §9.1): a refresh token keeps its audience.
ALTER TABLE "refresh_tokens" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'app';
