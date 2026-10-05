-- Admin two-factor authentication removed: the stored authenticator secrets are no longer used.
ALTER TABLE "users" DROP COLUMN "totp_secret_enc";
