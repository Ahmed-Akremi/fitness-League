-- Workouts as the athlete logged them, the anti-cheat verdict on each, and weigh-ins (encrypted).

CREATE TABLE workouts (
  id                  BINARY(16) NOT NULL,
  user_id             BINARY(16) NOT NULL,
  -- Made by the app: the idempotency key of offline sync.
  client_id           BINARY(16) NOT NULL,
  -- SHA-256 of the body without deviceSubmittedAt: a resend matches it, other data under the same
  -- client id does not.
  payload_hash        BINARY(32) NOT NULL,
  -- SHA-256 of the sport and the sets, time left out: duplicates and repeated identical workouts.
  fingerprint         BINARY(32) NOT NULL,
  sport_id            BINARY(16) NOT NULL,
  workout_type        VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  performed_at        DATETIME(6) NOT NULL,
  duration_s          INT NOT NULL,
  notes               VARCHAR(2000) NULL,
  visibility          ENUM('PUBLIC','FRIENDS','PRIVATE') NOT NULL,
  status              ENUM('ACCEPTED','HELD_FOR_REVIEW','REJECTED') NOT NULL,
  is_verified         BOOLEAN NOT NULL DEFAULT FALSE,
  received_at         DATETIME(6) NOT NULL,
  device_submitted_at DATETIME(6) NULL,
  total_volume_kg     DECIMAL(12,2) NOT NULL,
  total_distance_m    BIGINT NOT NULL,
  version             INT NOT NULL DEFAULT 1,
  created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workouts_user_client (user_id, client_id),
  KEY ix_workouts_user_performed (user_id, performed_at, id),
  KEY ix_workouts_user_fingerprint (user_id, fingerprint),
  CONSTRAINT fk_workouts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_workouts_sport FOREIGN KEY (sport_id) REFERENCES sports (id),
  CONSTRAINT ck_workouts_duration CHECK (duration_s BETWEEN 60 AND 86400)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE workout_exercises (
  id          BINARY(16) NOT NULL,
  workout_id  BINARY(16) NOT NULL,
  exercise_id BINARY(16) NOT NULL,
  position    SMALLINT NOT NULL,
  notes       VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_exercises_position (workout_id, position),
  CONSTRAINT fk_workout_exercises_workout FOREIGN KEY (workout_id) REFERENCES workouts (id) ON DELETE CASCADE,
  CONSTRAINT fk_workout_exercises_exercise FOREIGN KEY (exercise_id) REFERENCES exercises (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE workout_sets (
  id                  BINARY(16) NOT NULL,
  workout_exercise_id BINARY(16) NOT NULL,
  set_index           SMALLINT NOT NULL,
  reps                SMALLINT NULL,
  weight_kg           DECIMAL(6,2) NULL,
  distance_m          INT NULL,
  duration_s          INT NULL,
  is_warmup           BOOLEAN NOT NULL DEFAULT FALSE,
  rpe                 DECIMAL(3,1) NULL,
  -- Estimated one-rep max of a working set with a weight and 1 to 12 reps.
  e1rm_kg             DECIMAL(7,2) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workout_sets_index (workout_exercise_id, set_index),
  CONSTRAINT fk_workout_sets_exercise FOREIGN KEY (workout_exercise_id) REFERENCES workout_exercises (id) ON DELETE CASCADE,
  CONSTRAINT ck_workout_sets_reps CHECK (reps BETWEEN 0 AND 1000),
  CONSTRAINT ck_workout_sets_weight CHECK (weight_kg BETWEEN 0 AND 1000),
  CONSTRAINT ck_workout_sets_distance CHECK (distance_m BETWEEN 0 AND 1000000),
  CONSTRAINT ck_workout_sets_duration CHECK (duration_s BETWEEN 0 AND 86400),
  CONSTRAINT ck_workout_sets_rpe CHECK (rpe BETWEEN 1 AND 10),
  CONSTRAINT ck_workout_sets_measured CHECK (reps IS NOT NULL OR distance_m IS NOT NULL OR duration_s IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- The anti-cheat verdict, kept as it was given: the rule hits are a snapshot, read whole.
CREATE TABLE workout_evaluations (
  workout_id       BINARY(16) NOT NULL,
  outcome          ENUM('ACCEPTED','HELD_FOR_REVIEW','REJECTED') NOT NULL,
  rule_hits        JSON NOT NULL CHECK (JSON_VALID(rule_hits)),
  confidence       DECIMAL(4,3) NOT NULL,
  rule_set_version INT NOT NULL,
  -- Set by the moderation of part 5.
  reviewed_at      DATETIME(6) NULL,
  PRIMARY KEY (workout_id),
  CONSTRAINT fk_workout_evaluations_workout FOREIGN KEY (workout_id) REFERENCES workouts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Health data: each value is AES-256-GCM ciphertext carrying its key id (security/health.rs).
CREATE TABLE body_measurements (
  id               BINARY(16) NOT NULL,
  user_id          BINARY(16) NOT NULL,
  measured_at      DATETIME(6) NOT NULL,
  weight_kg_enc    VARBINARY(128) NOT NULL,
  body_fat_pct_enc VARBINARY(128) NULL,
  source           ENUM('MANUAL','HEALTH_CONNECT','APPLE_HEALTH','STRAVA','GARMIN','IMPORT') NOT NULL DEFAULT 'MANUAL',
  created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_body_measurements_user (user_id, measured_at),
  CONSTRAINT fk_body_measurements_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
