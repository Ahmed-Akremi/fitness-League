-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'GYM_ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'APPLE');

-- CreateEnum
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'PHONE_OTP');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('fr', 'en', 'ar');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('DARK', 'LIGHT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'FRIENDS', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TERMS', 'PRIVACY', 'HEALTH_DATA', 'MARKETING');

-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('EXPORT', 'DELETION');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "SportCategory" AS ENUM ('STRENGTH', 'FUNCTIONAL', 'CARDIO');

-- CreateEnum
CREATE TYPE "LoggingMode" AS ENUM ('SETS_REPS_WEIGHT', 'DISTANCE_TIME', 'MIXED');

-- CreateEnum
CREATE TYPE "MetricDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('MANUAL', 'HEALTH_CONNECT', 'APPLE_HEALTH', 'STRAVA', 'GARMIN', 'IMPORT');

-- CreateEnum
CREATE TYPE "WorkoutStatus" AS ENUM ('PROCESSING', 'ACCEPTED', 'HELD_FOR_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvaluationOutcome" AS ENUM ('ACCEPTED', 'HELD_FOR_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING_UPLOAD', 'SCANNING', 'READY', 'REJECTED');

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('AVATAR', 'PROOF', 'REPORT_EVIDENCE', 'GYM_PROOF', 'EXPORT');

-- CreateEnum
CREATE TYPE "BaselineStatus" AS ENUM ('PROVISIONAL', 'FINAL', 'CORRECTED');

-- CreateEnum
CREATE TYPE "PrStatus" AS ENUM ('AWARDED', 'CALIBRATION', 'HELD', 'REVOKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('WEIGHT', 'STRENGTH', 'RUNNING', 'HABIT');

-- CreateEnum
CREATE TYPE "GoalDirection" AS ENUM ('INCREASE', 'DECREASE');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('WORKOUT', 'PR', 'BADGE', 'LEVEL_UP', 'BATTLE_WIN', 'GYM_WAR_WIN', 'GOAL_COMPLETED');

-- CreateEnum
CREATE TYPE "RuleSetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "XpReason" AS ENUM ('WORKOUT', 'PR', 'CALIBRATION_PR', 'GOAL_MILESTONE', 'CHALLENGE', 'BATTLE', 'BATTLE_WIN', 'GYM_WAR_WIN', 'QUEST', 'REVERSAL', 'MODERATION', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LpReason" AS ENUM ('WEEKLY_SCORE', 'BATTLE_WIN', 'BATTLE_DRAW', 'BATTLE_PARTICIPATION', 'GYM_WAR', 'SEASON_SOFT_RESET', 'REVERSAL', 'MODERATION', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WeeklyScoreStatus" AS ENUM ('PROVISIONAL', 'FINAL');

-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "DivisionCode" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'ELITE');

-- CreateEnum
CREATE TYPE "LeaderboardScope" AS ENUM ('NATIONAL', 'GOVERNORATE', 'GYM', 'LEAGUE');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "BattleType" AS ENUM ('FRIEND', 'DUEL');

-- CreateEnum
CREATE TYPE "BattleStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BattleOutcome" AS ENUM ('WIN', 'LOSS', 'DRAW');

-- CreateEnum
CREATE TYPE "GymStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "GymMemberStatus" AS ENUM ('PENDING', 'APPROVED', 'REMOVED', 'LEFT', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BadgeCategory" AS ENUM ('PROGRESS', 'CONSISTENCY', 'COMPETITION', 'SOCIAL', 'GYM', 'ELITE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "username" CITEXT NOT NULL,
    "password_hash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMPTZ,
    "phone_e164" TEXT,
    "phone_verified_at" TIMESTAMPTZ,
    "date_of_birth" DATE NOT NULL,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "suspended_until" TIMESTAMPTZ,
    "session_version" INTEGER NOT NULL DEFAULT 1,
    "totp_secret_enc" BYTEA,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "anonymised_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "device_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "VerificationTokenType" NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "install_id" TEXT NOT NULL,
    "fcm_token" TEXT,
    "app_version" TEXT,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "bio" VARCHAR(280),
    "avatar_media_id" UUID,
    "gender" "Gender",
    "country_code" CHAR(2) NOT NULL DEFAULT 'TN',
    "governorate_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "primary_gym_id" UUID,
    "experience_level_declared" "ExperienceLevel",
    "planned_training_days_per_week" SMALLINT NOT NULL DEFAULT 3,
    "calibration_started_at" TIMESTAMPTZ,
    "calibration_ends_at" TIMESTAMPTZ,
    "onboarding_completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_sports" (
    "user_id" UUID NOT NULL,
    "sport_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_sports_pkey" PRIMARY KEY ("user_id","sport_id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" UUID NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'fr',
    "theme" "Theme" NOT NULL DEFAULT 'DARK',
    "reduced_motion" BOOLEAN,
    "default_visibility" "Visibility" NOT NULL DEFAULT 'FRIENDS',
    "show_age_bracket" BOOLEAN NOT NULL DEFAULT false,
    "show_on_leaderboards" BOOLEAN NOT NULL DEFAULT true,
    "notification_prefs" JSONB NOT NULL DEFAULT '{}',
    "quiet_hours_start" TIME,
    "quiet_hours_end" TIME,
    "streak_freeze_days_per_week" SMALLINT NOT NULL DEFAULT 2,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "document_version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "ip_hash" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_measurements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "measured_at" TIMESTAMPTZ NOT NULL,
    "weight_kg_enc" BYTEA,
    "body_fat_pct_enc" BYTEA,
    "key_id" TEXT NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_for" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "artifact_media_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "governorates" (
    "id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "code" TEXT NOT NULL,
    "name_i18n" JSONB NOT NULL,

    CONSTRAINT "governorates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "governorate_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_i18n" JSONB NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sports" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "category" "SportCategory" NOT NULL,
    "logging_mode" "LoggingMode" NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "icon" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "direction" "MetricDirection" NOT NULL,
    "name_i18n" JSONB NOT NULL,

    CONSTRAINT "metric_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL,
    "sport_id" UUID,
    "code" TEXT NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "equipment" TEXT,
    "is_bodyweight" BOOLEAN NOT NULL DEFAULT false,
    "tracked_metrics" TEXT[],
    "plausibility" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workouts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "payload_hash" BYTEA NOT NULL,
    "sport_id" UUID NOT NULL,
    "workout_type" TEXT NOT NULL,
    "performed_at" TIMESTAMPTZ NOT NULL,
    "duration_s" INTEGER NOT NULL,
    "notes" VARCHAR(2000),
    "visibility" "Visibility" NOT NULL DEFAULT 'FRIENDS',
    "data_source" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "external_ref" TEXT,
    "status" "WorkoutStatus" NOT NULL DEFAULT 'PROCESSING',
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_submitted_at" TIMESTAMPTZ,
    "total_volume_kg" DECIMAL(12,2),
    "total_distance_m" INTEGER,
    "fingerprint" BYTEA,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "workouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_exercises" (
    "id" UUID NOT NULL,
    "workout_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "notes" VARCHAR(500),

    CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sets" (
    "id" UUID NOT NULL,
    "workout_exercise_id" UUID NOT NULL,
    "set_index" SMALLINT NOT NULL,
    "reps" SMALLINT,
    "weight_kg" DECIMAL(6,2),
    "distance_m" INTEGER,
    "duration_s" INTEGER,
    "is_warmup" BOOLEAN NOT NULL DEFAULT false,
    "rpe" DECIMAL(3,1),
    "e1rm_kg" DECIMAL(6,2),

    CONSTRAINT "workout_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_evaluations" (
    "workout_id" UUID NOT NULL,
    "outcome" "EvaluationOutcome" NOT NULL,
    "rule_hits" JSONB NOT NULL DEFAULT '[]',
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "rule_set_version" INTEGER NOT NULL,
    "pending_points" JSONB,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workout_evaluations_pkey" PRIMARY KEY ("workout_id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" BYTEA,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "purpose" "MediaPurpose" NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_s" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baselines" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "metric_type_id" UUID NOT NULL,
    "declared_value" DECIMAL(12,3),
    "calibrated_value" DECIMAL(12,3),
    "effective_value" DECIMAL(12,3) NOT NULL,
    "status" "BaselineStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "experience_level" "ExperienceLevel",
    "logs_counted" INTEGER NOT NULL DEFAULT 0,
    "finalized_at" TIMESTAMPTZ,
    "corrected_from" DECIMAL(12,3),
    "rule_set_version" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "metric_type_id" UUID NOT NULL,
    "qualifier" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "value" DECIMAL(12,3) NOT NULL,
    "previous_value" DECIMAL(12,3),
    "workout_id" UUID NOT NULL,
    "workout_set_id" UUID,
    "status" "PrStatus" NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "achieved_at" TIMESTAMPTZ NOT NULL,
    "xp_transaction_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "personal_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_observations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "metric_type_id" UUID NOT NULL,
    "qualifier" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "value" DECIMAL(12,3) NOT NULL,
    "workout_id" UUID NOT NULL,
    "observed_at" TIMESTAMPTZ NOT NULL,
    "counts_for_competition" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "GoalType" NOT NULL,
    "exercise_id" UUID,
    "metric_type_id" UUID NOT NULL,
    "direction" "GoalDirection" NOT NULL,
    "start_value" DECIMAL(12,3),
    "target_value" DECIMAL(12,3),
    "start_value_enc" BYTEA,
    "target_value_enc" BYTEA,
    "start_date" DATE NOT NULL,
    "target_date" DATE,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "was_suggested" BOOLEAN NOT NULL DEFAULT false,
    "safety_adjustment" JSONB,
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_milestones" (
    "id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "index" SMALLINT NOT NULL,
    "target_value" DECIMAL(12,3),
    "target_value_enc" BYTEA,
    "reached_at" TIMESTAMPTZ,
    "workout_id" UUID,
    "xp_transaction_id" UUID,

    CONSTRAINT "goal_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streaks" (
    "user_id" UUID NOT NULL,
    "current_weeks" INTEGER NOT NULL DEFAULT 0,
    "longest_weeks" INTEGER NOT NULL DEFAULT 0,
    "current_days" INTEGER NOT NULL DEFAULT 0,
    "longest_days" INTEGER NOT NULL DEFAULT 0,
    "last_training_date" DATE,
    "freezes_used_this_week" SMALLINT NOT NULL DEFAULT 0,
    "week_start" DATE,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "streaks_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "ref_type" TEXT NOT NULL,
    "ref_id" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "visibility" "Visibility" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_rule_sets" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RuleSetStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL,
    "config_hash" BYTEA NOT NULL,
    "based_on_version" INTEGER,
    "change_note" TEXT NOT NULL,
    "created_by" UUID,
    "activated_by" UUID,
    "activated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "scoring_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expected_progression" (
    "id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "experience_level" "ExperienceLevel" NOT NULL,
    "sport_id" UUID,
    "exercise_id" UUID,
    "metric_type_id" UUID NOT NULL,
    "period_days" INTEGER NOT NULL DEFAULT 28,
    "expected_pct" DECIMAL(6,3) NOT NULL,

    CONSTRAINT "expected_progression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "XpReason" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "reverses_id" UUID,
    "rule_set_version" INTEGER NOT NULL,
    "explanation" JSONB NOT NULL,
    "effective_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_point_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "LpReason" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "reverses_id" UUID,
    "rule_set_version" INTEGER NOT NULL,
    "explanation" JSONB NOT NULL,
    "effective_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_point_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stats" (
    "user_id" UUID NOT NULL,
    "xp_total" BIGINT NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp_into_level" INTEGER NOT NULL DEFAULT 0,
    "xp_for_next_level" INTEGER NOT NULL DEFAULT 100,
    "current_season_id" UUID,
    "season_lp" INTEGER NOT NULL DEFAULT 0,
    "division_id" UUID,
    "leaderboard_eligible" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "weekly_scores" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "season_id" UUID NOT NULL,
    "rule_set_version" INTEGER NOT NULL,
    "progress_c" DECIMAL(5,2) NOT NULL,
    "consistency_c" DECIMAL(5,2) NOT NULL,
    "performance_c" DECIMAL(5,2) NOT NULL,
    "challenge_c" DECIMAL(5,2),
    "total" DECIMAL(5,2) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "lp_transaction_id" UUID,
    "status" "WeeklyScoreStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "weekly_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_daily_counters" (
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "xp_granted" INTEGER NOT NULL DEFAULT 0,
    "workouts_counted" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "xp_daily_counters_pkey" PRIMARY KEY ("user_id","day")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'TN',
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "status" "SeasonStatus" NOT NULL DEFAULT 'SCHEDULED',
    "closed_at" TIMESTAMPTZ,
    "rule_set_version_at_close" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "divisions" (
    "id" UUID NOT NULL,
    "code" "DivisionCode" NOT NULL,
    "order" SMALLINT NOT NULL,
    "min_lp" INTEGER NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "divisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_standings" (
    "season_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "final_lp" INTEGER NOT NULL,
    "division_id" UUID NOT NULL,
    "rank_national" INTEGER,
    "rank_governorate" INTEGER,
    "rank_gym" INTEGER,
    "is_champion" BOOLEAN NOT NULL DEFAULT false,
    "champion_scope" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "season_standings_pkey" PRIMARY KEY ("season_id","user_id")
);

-- CreateTable
CREATE TABLE "leaderboard_snapshots" (
    "snapshot_date" DATE NOT NULL,
    "season_id" UUID NOT NULL,
    "scope_type" "LeaderboardScope" NOT NULL,
    "scope_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "lp" INTEGER NOT NULL,

    CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY ("snapshot_date","scope_type","scope_id","user_id")
);

-- CreateTable
CREATE TABLE "friendships" (
    "user_low_id" UUID NOT NULL,
    "user_high_id" UUID NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("user_low_id","user_high_id")
);

-- CreateTable
CREATE TABLE "follows" (
    "follower_id" UUID NOT NULL,
    "followee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("follower_id","followee_id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateTable
CREATE TABLE "battles" (
    "id" UUID NOT NULL,
    "type" "BattleType" NOT NULL,
    "status" "BattleStatus" NOT NULL DEFAULT 'PENDING',
    "created_by" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "duration_days" SMALLINT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "is_ghost" BOOLEAN NOT NULL DEFAULT false,
    "result" JSONB,
    "closed_at" TIMESTAMPTZ,
    "rule_set_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "battles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_participants" (
    "battle_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "score" DECIMAL(5,2),
    "breakdown" JSONB,
    "outcome" "BattleOutcome",
    "lp_transaction_id" UUID,
    "xp_transaction_id" UUID,

    CONSTRAINT "battle_participants_pkey" PRIMARY KEY ("battle_id","user_id")
);

-- CreateTable
CREATE TABLE "gyms" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'TN',
    "governorate_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "address_line" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "social_links" JSONB NOT NULL DEFAULT '{}',
    "status" "GymStatus" NOT NULL DEFAULT 'PENDING',
    "owner_user_id" UUID,
    "verified_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "level" INTEGER NOT NULL DEFAULT 1,
    "rating" DECIMAL(7,2) NOT NULL DEFAULT 1500,
    "rating_rd" DECIMAL(6,2) NOT NULL DEFAULT 350,
    "logo_media_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "gyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_verification_requests" (
    "id" UUID NOT NULL,
    "gym_id" UUID NOT NULL,
    "submitted_by" UUID NOT NULL,
    "proof_media_ids" UUID[],
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gym_verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_members" (
    "id" UUID NOT NULL,
    "gym_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "GymMemberStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ,
    "approved_by" UUID,
    "left_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gym_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "category" "BadgeCategory" NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "description_i18n" JSONB NOT NULL,
    "icon" TEXT,
    "rarity" TEXT NOT NULL DEFAULT 'COMMON',
    "rule" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "badge_id" UUID NOT NULL,
    "awarded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_ref" TEXT,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ,
    "delivered_push_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" "Role",
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip_hash" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_event_outbox" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_e164_key" ON "users"("phone_e164");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "oauth_identities_user_id_idx" ON "oauth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_identities_provider_subject_key" ON "oauth_identities"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_type_idx" ON "verification_tokens"("user_id", "type");

-- CreateIndex
CREATE INDEX "devices_install_id_idx" ON "devices"("install_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_install_id_key" ON "devices"("user_id", "install_id");

-- CreateIndex
CREATE INDEX "profiles_governorate_id_idx" ON "profiles"("governorate_id");

-- CreateIndex
CREATE INDEX "profiles_primary_gym_id_idx" ON "profiles"("primary_gym_id");

-- CreateIndex
CREATE INDEX "consents_user_id_type_created_at_idx" ON "consents"("user_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "body_measurements_user_id_measured_at_idx" ON "body_measurements"("user_id", "measured_at" DESC);

-- CreateIndex
CREATE INDEX "data_requests_status_scheduled_for_idx" ON "data_requests"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "governorates_code_key" ON "governorates"("code");

-- CreateIndex
CREATE INDEX "governorates_country_code_idx" ON "governorates"("country_code");

-- CreateIndex
CREATE UNIQUE INDEX "cities_code_key" ON "cities"("code");

-- CreateIndex
CREATE INDEX "cities_governorate_id_idx" ON "cities"("governorate_id");

-- CreateIndex
CREATE UNIQUE INDEX "sports_code_key" ON "sports"("code");

-- CreateIndex
CREATE UNIQUE INDEX "metric_types_code_key" ON "metric_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "exercises_code_key" ON "exercises"("code");

-- CreateIndex
CREATE INDEX "exercises_sport_id_idx" ON "exercises"("sport_id");

-- CreateIndex
CREATE INDEX "exercises_updated_at_idx" ON "exercises"("updated_at");

-- CreateIndex
CREATE INDEX "workouts_user_id_performed_at_idx" ON "workouts"("user_id", "performed_at" DESC);

-- CreateIndex
CREATE INDEX "workouts_user_id_fingerprint_idx" ON "workouts"("user_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "workouts_user_id_client_id_key" ON "workouts"("user_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "workouts_user_id_data_source_external_ref_key" ON "workouts"("user_id", "data_source", "external_ref");

-- CreateIndex
CREATE INDEX "workout_exercises_workout_id_idx" ON "workout_exercises"("workout_id");

-- CreateIndex
CREATE INDEX "workout_sets_workout_exercise_id_idx" ON "workout_sets"("workout_exercise_id");

-- CreateIndex
CREATE INDEX "workout_evaluations_outcome_idx" ON "workout_evaluations"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "media_object_key_key" ON "media"("object_key");

-- CreateIndex
CREATE INDEX "media_owner_id_idx" ON "media"("owner_id");

-- CreateIndex
CREATE INDEX "media_status_created_at_idx" ON "media"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "baselines_user_id_exercise_id_metric_type_id_key" ON "baselines"("user_id", "exercise_id", "metric_type_id");

-- CreateIndex
CREATE INDEX "personal_records_user_id_exercise_id_metric_type_id_qualifi_idx" ON "personal_records"("user_id", "exercise_id", "metric_type_id", "qualifier", "achieved_at" DESC);

-- CreateIndex
CREATE INDEX "metric_observations_user_id_exercise_id_metric_type_id_obse_idx" ON "metric_observations"("user_id", "exercise_id", "metric_type_id", "observed_at");

-- CreateIndex
CREATE INDEX "goals_user_id_status_idx" ON "goals"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "goal_milestones_goal_id_index_key" ON "goal_milestones"("goal_id", "index");

-- CreateIndex
CREATE INDEX "activity_events_user_id_created_at_idx" ON "activity_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scoring_rule_sets_version_key" ON "scoring_rule_sets"("version");

-- CreateIndex
CREATE INDEX "expected_progression_rule_set_id_sport_id_metric_type_id_idx" ON "expected_progression"("rule_set_id", "sport_id", "metric_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "expected_progression_rule_set_id_experience_level_exercise__key" ON "expected_progression"("rule_set_id", "experience_level", "exercise_id", "metric_type_id", "period_days");

-- CreateIndex
CREATE UNIQUE INDEX "xp_transactions_reverses_id_key" ON "xp_transactions"("reverses_id");

-- CreateIndex
CREATE INDEX "xp_transactions_user_id_created_at_idx" ON "xp_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "xp_transactions_user_id_effective_at_idx" ON "xp_transactions"("user_id", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "league_point_transactions_reverses_id_key" ON "league_point_transactions"("reverses_id");

-- CreateIndex
CREATE INDEX "league_point_transactions_user_id_season_id_created_at_idx" ON "league_point_transactions"("user_id", "season_id", "created_at");

-- CreateIndex
CREATE INDEX "user_stats_current_season_id_season_lp_idx" ON "user_stats"("current_season_id", "season_lp" DESC);

-- CreateIndex
CREATE INDEX "weekly_scores_season_id_week_start_idx" ON "weekly_scores"("season_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_scores_user_id_week_start_key" ON "weekly_scores"("user_id", "week_start");

-- CreateIndex
CREATE INDEX "seasons_country_code_status_idx" ON "seasons"("country_code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "divisions_code_key" ON "divisions"("code");

-- CreateIndex
CREATE INDEX "leaderboard_snapshots_season_id_scope_type_scope_id_snapsho_idx" ON "leaderboard_snapshots"("season_id", "scope_type", "scope_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "friendships_user_high_id_idx" ON "friendships"("user_high_id");

-- CreateIndex
CREATE INDEX "follows_followee_id_idx" ON "follows"("followee_id");

-- CreateIndex
CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");

-- CreateIndex
CREATE INDEX "battles_status_ends_at_idx" ON "battles"("status", "ends_at");

-- CreateIndex
CREATE INDEX "battle_participants_user_id_battle_id_idx" ON "battle_participants"("user_id", "battle_id");

-- CreateIndex
CREATE UNIQUE INDEX "gyms_slug_key" ON "gyms"("slug");

-- CreateIndex
CREATE INDEX "gyms_governorate_id_status_idx" ON "gyms"("governorate_id", "status");

-- CreateIndex
CREATE INDEX "gym_verification_requests_status_created_at_idx" ON "gym_verification_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "gym_members_gym_id_status_idx" ON "gym_members"("gym_id", "status");

-- CreateIndex
CREATE INDEX "gym_members_user_id_idx" ON "gym_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "badges_code_key" ON "badges"("code");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_user_id_badge_id_key" ON "user_badges"("user_id", "badge_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "domain_event_outbox_processed_at_created_at_idx" ON "domain_event_outbox"("processed_at", "created_at");

-- AddForeignKey
ALTER TABLE "oauth_identities" ADD CONSTRAINT "oauth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_governorate_id_fkey" FOREIGN KEY ("governorate_id") REFERENCES "governorates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_primary_gym_id_fkey" FOREIGN KEY ("primary_gym_id") REFERENCES "gyms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sports" ADD CONSTRAINT "user_sports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sports" ADD CONSTRAINT "user_sports_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governorates" ADD CONSTRAINT "governorates_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_governorate_id_fkey" FOREIGN KEY ("governorate_id") REFERENCES "governorates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_exercise_id_fkey" FOREIGN KEY ("workout_exercise_id") REFERENCES "workout_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_evaluations" ADD CONSTRAINT "workout_evaluations_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_metric_type_id_fkey" FOREIGN KEY ("metric_type_id") REFERENCES "metric_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_metric_type_id_fkey" FOREIGN KEY ("metric_type_id") REFERENCES "metric_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_workout_set_id_fkey" FOREIGN KEY ("workout_set_id") REFERENCES "workout_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_metric_type_id_fkey" FOREIGN KEY ("metric_type_id") REFERENCES "metric_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_observations" ADD CONSTRAINT "metric_observations_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_metric_type_id_fkey" FOREIGN KEY ("metric_type_id") REFERENCES "metric_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_progression" ADD CONSTRAINT "expected_progression_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "scoring_rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_progression" ADD CONSTRAINT "expected_progression_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_progression" ADD CONSTRAINT "expected_progression_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_progression" ADD CONSTRAINT "expected_progression_metric_type_id_fkey" FOREIGN KEY ("metric_type_id") REFERENCES "metric_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "xp_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_point_transactions" ADD CONSTRAINT "league_point_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_point_transactions" ADD CONSTRAINT "league_point_transactions_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_point_transactions" ADD CONSTRAINT "league_point_transactions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "league_point_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_current_season_id_fkey" FOREIGN KEY ("current_season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_scores" ADD CONSTRAINT "weekly_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_scores" ADD CONSTRAINT "weekly_scores_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_daily_counters" ADD CONSTRAINT "xp_daily_counters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_governorate_id_fkey" FOREIGN KEY ("governorate_id") REFERENCES "governorates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_verification_requests" ADD CONSTRAINT "gym_verification_requests_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_members" ADD CONSTRAINT "gym_members_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_members" ADD CONSTRAINT "gym_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- Constraints Prisma cannot express (docs/ARCHITECTURE.md §3).
-- ───────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Only one ACTIVE rule set at a time.
CREATE UNIQUE INDEX "scoring_rule_sets_one_active" ON "scoring_rule_sets" ("status") WHERE "status" = 'ACTIVE';

-- The same event can never be granted twice, even under retries.
CREATE UNIQUE INDEX "xp_transactions_source_once"
  ON "xp_transactions" ("user_id", "reason", "source_type", "source_id") WHERE "reverses_id" IS NULL;
CREATE UNIQUE INDEX "league_point_transactions_source_once"
  ON "league_point_transactions" ("user_id", "season_id", "reason", "source_type", "source_id") WHERE "reverses_id" IS NULL;

-- Negative amounts only for corrections.
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_amount_sign"
  CHECK ("amount" >= 0 OR "reason" IN ('REVERSAL', 'MODERATION', 'ADMIN_ADJUSTMENT'));
ALTER TABLE "league_point_transactions" ADD CONSTRAINT "league_point_transactions_amount_sign"
  CHECK ("amount" >= 0 OR "reason" IN ('REVERSAL', 'MODERATION', 'ADMIN_ADJUSTMENT', 'SEASON_SOFT_RESET'));
-- A reversal must point at the entry it reverses.
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_reversal_ref"
  CHECK (("reason" = 'REVERSAL') = ("reverses_id" IS NOT NULL));
ALTER TABLE "league_point_transactions" ADD CONSTRAINT "league_point_transactions_reversal_ref"
  CHECK (("reason" = 'REVERSAL') = ("reverses_id" IS NOT NULL));

-- Append-only tables.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "xp_transactions_append_only" BEFORE UPDATE OR DELETE ON "xp_transactions"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "league_point_transactions_append_only" BEFORE UPDATE OR DELETE ON "league_point_transactions"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "consents_append_only" BEFORE UPDATE OR DELETE ON "consents"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- One current record per (user, exercise, metric, qualifier).
CREATE UNIQUE INDEX "personal_records_one_current"
  ON "personal_records" ("user_id", "exercise_id", "metric_type_id", "qualifier") WHERE "is_current";

-- One pending/approved gym membership per user (ASSUMPTION Q-9: one primary gym).
CREATE UNIQUE INDEX "gym_members_one_active_per_user"
  ON "gym_members" ("user_id") WHERE "status" IN ('PENDING', 'APPROVED');

-- Friendships are stored once, as an ordered pair.
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_ordered_pair" CHECK ("user_low_id" < "user_high_id");
ALTER TABLE "follows" ADD CONSTRAINT "follows_not_self" CHECK ("follower_id" <> "followee_id");
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_not_self" CHECK ("blocker_id" <> "blocked_id");

-- Workout sanity ranges (plausibility is handled by the anti-cheat; these are hard data-integrity bounds).
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_duration_range" CHECK ("duration_s" BETWEEN 0 AND 86400);
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_ranges" CHECK (
  ("reps" IS NULL OR "reps" BETWEEN 0 AND 1000)
  AND ("weight_kg" IS NULL OR "weight_kg" BETWEEN 0 AND 1000)
  AND ("distance_m" IS NULL OR "distance_m" BETWEEN 0 AND 1000000)
  AND ("duration_s" IS NULL OR "duration_s" BETWEEN 0 AND 86400)
  AND ("reps" IS NOT NULL OR "distance_m" IS NOT NULL OR "duration_s" IS NOT NULL)
);

-- Seasons of the same country never overlap.
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_no_overlap"
  EXCLUDE USING gist ("country_code" WITH =, tstzrange("starts_at", "ends_at") WITH &&);

ALTER TABLE "battles" ADD CONSTRAINT "battles_window" CHECK ("ends_at" > "starts_at");
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_window" CHECK ("ends_at" > "starts_at");
