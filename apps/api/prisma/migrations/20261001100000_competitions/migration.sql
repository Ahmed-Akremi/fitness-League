-- CreateEnum
CREATE TYPE "CompetitionFormat" AS ENUM ('ONLINE', 'ONSITE', 'HYBRID');

-- CreateEnum
CREATE TYPE "CompetitionStatus" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ACTIVE', 'SUBMISSION_OPEN', 'JUDGING', 'PROVISIONAL_LEADERBOARD', 'FINAL_LEADERBOARD', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CompetitionStaffRole" AS ENUM ('ORGANIZER', 'JUDGE', 'HEAD_JUDGE');

-- CreateEnum
CREATE TYPE "CategoryGender" AS ENUM ('MALE', 'FEMALE', 'MIXED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CompetitionPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FREE', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CompetitionScoreType" AS ENUM ('TIME', 'REPS', 'ROUNDS_REPS', 'DISTANCE', 'LOAD', 'CALORIES', 'POINTS', 'MAX_WEIGHT', 'COMPLEX');

-- CreateEnum
CREATE TYPE "CompetitionScoringMethod" AS ENUM ('DIRECT_POINTS', 'PLACEMENT_POINTS');

-- CreateEnum
CREATE TYPE "CompetitionSubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_CORRECTION', 'PENALIZED', 'FINAL');

-- CreateEnum
CREATE TYPE "CompetitionPenaltyType" AS ENUM ('NO_REP', 'TIME_PENALTY', 'REP_PENALTY', 'LOAD_PENALTY', 'POINT_PENALTY', 'OTHER');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE');

-- CreateEnum
CREATE TYPE "PrizeType" AS ENUM ('CASH', 'TROPHY', 'MEDAL', 'EQUIPMENT', 'VOUCHER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CompetitionAppealStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CLOSED');

-- CreateTable
CREATE TABLE "competitions" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cover_media_id" UUID,
    "logo_media_id" UUID,
    "location" TEXT,
    "country_code" CHAR(2) NOT NULL DEFAULT 'TN',
    "city" TEXT,
    "format" "CompetitionFormat" NOT NULL,
    "status" "CompetitionStatus" NOT NULL DEFAULT 'DRAFT',
    "registration_start" TIMESTAMPTZ NOT NULL,
    "registration_end" TIMESTAMPTZ NOT NULL,
    "event_start" TIMESTAMPTZ NOT NULL,
    "event_end" TIMESTAMPTZ NOT NULL,
    "score_submission_start" TIMESTAMPTZ,
    "score_submission_deadline" TIMESTAMPTZ,
    "judging_deadline" TIMESTAMPTZ,
    "appeal_deadline" TIMESTAMPTZ,
    "leaderboard_publication_at" TIMESTAMPTZ,
    "registration_price" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'TND',
    "max_participants" INTEGER,
    "tie_break_rules" JSONB NOT NULL DEFAULT '[]',
    "leaderboard_locked_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "competitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_categories" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "gender" "CategoryGender" NOT NULL,
    "min_age" INTEGER,
    "max_age" INTEGER,
    "level" TEXT,
    "max_participants" INTEGER,
    "registration_price_override" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "competition_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_staff" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "CompetitionStaffRole" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_registrations" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "registration_status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "payment_status" "CompetitionPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "original_price" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "final_price" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "coupon_id" UUID,
    "registered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "competition_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_workouts" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "standards" TEXT,
    "movements" JSONB NOT NULL DEFAULT '[]',
    "video_url" TEXT,
    "image_media_id" UUID,
    "time_cap_s" INTEGER,
    "score_type" "CompetitionScoreType" NOT NULL,
    "scoring_method" "CompetitionScoringMethod" NOT NULL,
    "maximum_points" INTEGER NOT NULL,
    "minimum_points" INTEGER NOT NULL DEFAULT 0,
    "placement_table" JSONB NOT NULL DEFAULT '[]',
    "category_specific" BOOLEAN NOT NULL DEFAULT false,
    "release_at" TIMESTAMPTZ,
    "submission_start" TIMESTAMPTZ NOT NULL,
    "submission_deadline" TIMESTAMPTZ NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "competition_workouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_workout_variants" (
    "id" UUID NOT NULL,
    "workout_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "standards" TEXT,
    "time_cap_s" INTEGER,

    CONSTRAINT "competition_workout_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_submissions" (
    "id" UUID NOT NULL,
    "workout_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "CompetitionSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "raw" JSONB NOT NULL,
    "raw_value" DECIMAL(12,2),
    "points" DECIMAL(10,2),
    "notes" TEXT,
    "video_url" TEXT,
    "youtube_id" TEXT,
    "video_media_id" UUID,
    "client_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "competition_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_score_versions" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "points" DECIMAL(10,2) NOT NULL,
    "raw_value" DECIMAL(12,2),
    "reason" TEXT NOT NULL,
    "judge_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_score_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_penalties" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "type" "CompetitionPenaltyType" NOT NULL,
    "points" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "judge_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_penalties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_judge_assignments" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "category_id" UUID,
    "workout_id" UUID,

    CONSTRAINT "competition_judge_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_prizes" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_id" UUID,
    "position" INTEGER NOT NULL,
    "type" "PrizeType" NOT NULL,
    "amount" INTEGER,
    "currency" CHAR(3),
    "description" TEXT,

    CONSTRAINT "competition_prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_coupons" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_id" UUID,
    "code" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ,
    "minimum_amount" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_coupon_redemptions" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "discount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_payments" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "CompetitionPaymentStatus" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "provider_ref" TEXT,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_leaderboard_entries" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wod_points" JSONB NOT NULL DEFAULT '{}',
    "total_points" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL,
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "competition_leaderboard_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_appeals" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CompetitionAppealStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "response" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ,

    CONSTRAINT "competition_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_announcements" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "competitions_slug_key" ON "competitions"("slug");

-- CreateIndex
CREATE INDEX "competitions_status_event_start_idx" ON "competitions"("status", "event_start");

-- CreateIndex
CREATE INDEX "competition_categories_competition_id_sort_order_idx" ON "competition_categories"("competition_id", "sort_order");

-- CreateIndex
CREATE INDEX "competition_staff_user_id_idx" ON "competition_staff"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "competition_staff_competition_id_user_id_role_key" ON "competition_staff"("competition_id", "user_id", "role");

-- CreateIndex
CREATE INDEX "competition_registrations_category_id_registration_status_idx" ON "competition_registrations"("category_id", "registration_status");

-- CreateIndex
CREATE UNIQUE INDEX "competition_registrations_competition_id_user_id_key" ON "competition_registrations"("competition_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "competition_workouts_competition_id_number_key" ON "competition_workouts"("competition_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "competition_workout_variants_workout_id_category_id_key" ON "competition_workout_variants"("workout_id", "category_id");

-- CreateIndex
CREATE INDEX "competition_submissions_workout_id_status_idx" ON "competition_submissions"("workout_id", "status");

-- CreateIndex
CREATE INDEX "competition_submissions_registration_id_idx" ON "competition_submissions"("registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "competition_submissions_workout_id_user_id_key" ON "competition_submissions"("workout_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "competition_submissions_client_id_key" ON "competition_submissions"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "competition_score_versions_submission_id_version_key" ON "competition_score_versions"("submission_id", "version");

-- CreateIndex
CREATE INDEX "competition_penalties_submission_id_idx" ON "competition_penalties"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "competition_judge_assignments_staff_id_category_id_workout__key" ON "competition_judge_assignments"("staff_id", "category_id", "workout_id");

-- CreateIndex
CREATE INDEX "competition_prizes_competition_id_category_id_position_idx" ON "competition_prizes"("competition_id", "category_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "competition_coupons_competition_id_code_key" ON "competition_coupons"("competition_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "competition_coupon_redemptions_registration_id_key" ON "competition_coupon_redemptions"("registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "competition_coupon_redemptions_coupon_id_user_id_key" ON "competition_coupon_redemptions"("coupon_id", "user_id");

-- CreateIndex
CREATE INDEX "competition_payments_registration_id_idx" ON "competition_payments"("registration_id");

-- CreateIndex
CREATE INDEX "competition_leaderboard_rank_idx" ON "competition_leaderboard_entries"("competition_id", "category_id", "rank");

-- CreateIndex
CREATE INDEX "competition_leaderboard_total_idx" ON "competition_leaderboard_entries"("competition_id", "category_id", "total_points" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "competition_leaderboard_entries_competition_id_category_id__key" ON "competition_leaderboard_entries"("competition_id", "category_id", "user_id");

-- CreateIndex
CREATE INDEX "competition_appeals_submission_id_idx" ON "competition_appeals"("submission_id");

-- CreateIndex
CREATE INDEX "competition_appeals_status_idx" ON "competition_appeals"("status");

-- CreateIndex
CREATE INDEX "competition_announcements_competition_id_created_at_idx" ON "competition_announcements"("competition_id", "created_at");

-- AddForeignKey
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_categories" ADD CONSTRAINT "competition_categories_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_staff" ADD CONSTRAINT "competition_staff_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_staff" ADD CONSTRAINT "competition_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_registrations" ADD CONSTRAINT "competition_registrations_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_registrations" ADD CONSTRAINT "competition_registrations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_registrations" ADD CONSTRAINT "competition_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_workouts" ADD CONSTRAINT "competition_workouts_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_workout_variants" ADD CONSTRAINT "competition_workout_variants_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "competition_workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_workout_variants" ADD CONSTRAINT "competition_workout_variants_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_submissions" ADD CONSTRAINT "competition_submissions_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "competition_workouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_submissions" ADD CONSTRAINT "competition_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_score_versions" ADD CONSTRAINT "competition_score_versions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "competition_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_penalties" ADD CONSTRAINT "competition_penalties_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "competition_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_judge_assignments" ADD CONSTRAINT "competition_judge_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "competition_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_judge_assignments" ADD CONSTRAINT "competition_judge_assignments_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "competition_workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_prizes" ADD CONSTRAINT "competition_prizes_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_prizes" ADD CONSTRAINT "competition_prizes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_coupons" ADD CONSTRAINT "competition_coupons_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_coupon_redemptions" ADD CONSTRAINT "competition_coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "competition_coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_coupon_redemptions" ADD CONSTRAINT "competition_coupon_redemptions_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "competition_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_payments" ADD CONSTRAINT "competition_payments_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "competition_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_leaderboard_entries" ADD CONSTRAINT "competition_leaderboard_entries_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_leaderboard_entries" ADD CONSTRAINT "competition_leaderboard_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_appeals" ADD CONSTRAINT "competition_appeals_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "competition_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_announcements" ADD CONSTRAINT "competition_announcements_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

