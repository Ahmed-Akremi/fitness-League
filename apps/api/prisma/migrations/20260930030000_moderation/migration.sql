-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('USER', 'WORKOUT', 'COMMENT', 'GYM');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('CHEATING', 'HARASSMENT', 'SPAM', 'INAPPROPRIATE', 'IMPERSONATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SanctionKind" AS ENUM ('WARNING', 'SUSPENSION', 'BAN');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('NONE', 'PENDING', 'UPHELD', 'OVERTURNED');

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "target_type" "ReportTarget" NOT NULL,
    "target_id" UUID NOT NULL,
    "target_user_id" UUID,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "handled_by" UUID,
    "handled_at" TIMESTAMPTZ,
    "decision_note" TEXT,
    "sanction_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanctions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "SanctionKind" NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "note" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "appeal_status" "AppealStatus" NOT NULL DEFAULT 'NONE',
    "appeal_text" TEXT,
    "appealed_at" TIMESTAMPTZ,
    "appeal_decided_by" UUID,
    "appeal_decided_at" TIMESTAMPTZ,
    "appeal_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_idx" ON "reports"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "sanctions_user_id_created_at_idx" ON "sanctions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "sanctions_appeal_status_idx" ON "sanctions"("appeal_status");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

