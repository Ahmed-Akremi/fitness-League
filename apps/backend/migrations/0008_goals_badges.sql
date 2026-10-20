-- Goals and badges: what an athlete aims for, the milestones on the way, and the badges they earn.

-- A goal (docs §10). Weight goals are health data: their values are only stored encrypted, the others in clear.
CREATE TABLE goals (
  id                BINARY(16) NOT NULL,
  user_id           BINARY(16) NOT NULL,
  type              ENUM('WEIGHT','STRENGTH','RUNNING','HABIT') NOT NULL,
  exercise_id       BINARY(16) NULL,
  metric_type_id    BINARY(16) NOT NULL,
  direction         ENUM('INCREASE','DECREASE') NOT NULL,
  start_value       DECIMAL(12,3) NULL,
  target_value      DECIMAL(12,3) NULL,
  start_value_enc   VARBINARY(128) NULL,
  target_value_enc  VARBINARY(128) NULL,
  start_date        DATE NOT NULL,
  target_date       DATE NULL,
  -- Declared in the order lists show them.
  status            ENUM('ACTIVE','COMPLETED','ABANDONED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  was_suggested     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Why the target date was moved, when it was.
  safety_adjustment JSON NULL CHECK (JSON_VALID(safety_adjustment)),
  -- HABIT goals: consecutive weeks with the target met.
  habit_weeks_met   INT NOT NULL DEFAULT 0,
  visibility        ENUM('PUBLIC','FRIENDS','PRIVATE') NOT NULL DEFAULT 'PRIVATE',
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  -- One active goal per metric and exercise; NULLs never collide, hence the zero id (see expected_progression).
  exercise_key      BINARY(16) AS (IFNULL(exercise_id, 0x00000000000000000000000000000000)) STORED,
  active_slot       TINYINT AS (IF(status = 'ACTIVE', 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_goals_one_active (user_id, metric_type_id, exercise_key, active_slot),
  KEY ix_goals_user_status (user_id, status),
  CONSTRAINT fk_goals_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_goals_exercise FOREIGN KEY (exercise_id) REFERENCES exercises (id),
  CONSTRAINT fk_goals_metric FOREIGN KEY (metric_type_id) REFERENCES metric_types (id),
  -- Each value in exactly one form, and the encrypted one exactly for weight goals.
  CONSTRAINT ck_goals_start_value CHECK ((start_value IS NULL) <> (start_value_enc IS NULL)),
  CONSTRAINT ck_goals_target_value CHECK ((target_value IS NULL) <> (target_value_enc IS NULL)),
  CONSTRAINT ck_goals_weight_start CHECK ((type = 'WEIGHT') = (start_value_enc IS NOT NULL)),
  CONSTRAINT ck_goals_weight_target CHECK ((type = 'WEIGHT') = (target_value_enc IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- The steps toward a goal, reached in order; each one reached earns its XP once.
CREATE TABLE goal_milestones (
  id                BINARY(16) NOT NULL,
  goal_id           BINARY(16) NOT NULL,
  position          SMALLINT NOT NULL,
  target_value      DECIMAL(12,3) NULL,
  target_value_enc  VARBINARY(128) NULL,
  reached_at        DATETIME(6) NULL,
  -- The workout that reached it; NULL for a weigh-in.
  workout_id        BINARY(16) NULL,
  xp_transaction_id BINARY(16) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_goal_milestones_position (goal_id, position),
  CONSTRAINT fk_goal_milestones_goal FOREIGN KEY (goal_id) REFERENCES goals (id) ON DELETE CASCADE,
  CONSTRAINT fk_goal_milestones_workout FOREIGN KEY (workout_id) REFERENCES workouts (id),
  CONSTRAINT ck_goal_milestones_value CHECK ((target_value IS NULL) <> (target_value_enc IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- The badge catalogue (docs §3.10). A rule reads one fact about the athlete against a threshold.
CREATE TABLE badges (
  id             BINARY(16) NOT NULL,
  code           VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Declared in the order the catalogue lists them.
  category       ENUM('PROGRESS','CONSISTENCY','COMPETITION','SOCIAL','GYM','ELITE') NOT NULL,
  name_fr        VARCHAR(80) NOT NULL,
  name_en        VARCHAR(80) NOT NULL,
  name_ar        VARCHAR(80) NOT NULL,
  description_fr VARCHAR(255) NOT NULL,
  description_en VARCHAR(255) NOT NULL,
  description_ar VARCHAR(255) NOT NULL,
  icon           VARCHAR(40) NULL,
  rarity         ENUM('COMMON','RARE','EPIC','LEGENDARY') NOT NULL DEFAULT 'COMMON',
  rule           JSON NOT NULL CHECK (JSON_VALID(rule)),
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_badges_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- The badges an athlete earned, once each. A revoked one is never given again.
CREATE TABLE user_badges (
  id         BINARY(16) NOT NULL,
  user_id    BINARY(16) NOT NULL,
  badge_id   BINARY(16) NOT NULL,
  awarded_at DATETIME(6) NOT NULL,
  -- What unlocked it: a workout id, or NULL.
  source_ref VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  revoked_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_badges (user_id, badge_id),
  CONSTRAINT fk_user_badges_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_badges_badge FOREIGN KEY (badge_id) REFERENCES badges (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
