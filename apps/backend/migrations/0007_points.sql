-- Points: what workouts record (observations, baselines, personal records) and the XP they earn.

-- Expected improvement over a progress window, by level, exercise and metric (docs §9.3). A row without an
-- exercise applies to every exercise that has no row of its own.
CREATE TABLE expected_progression (
  id               BINARY(16) NOT NULL,
  rule_set_id      BINARY(16) NOT NULL,
  experience_level ENUM('BEGINNER','INTERMEDIATE','ADVANCED') NOT NULL,
  exercise_id      BINARY(16) NULL,
  metric_type_id   BINARY(16) NOT NULL,
  expected_pct     DECIMAL(6,3) NOT NULL,
  -- NULLs never collide in a unique index, so the generic row is keyed by a zero id instead.
  exercise_key     BINARY(16) AS (IFNULL(exercise_id, 0x00000000000000000000000000000000)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expected_progression (rule_set_id, experience_level, exercise_key, metric_type_id),
  CONSTRAINT fk_expected_progression_rule_set FOREIGN KEY (rule_set_id) REFERENCES rule_sets (id) ON DELETE CASCADE,
  CONSTRAINT fk_expected_progression_exercise FOREIGN KEY (exercise_id) REFERENCES exercises (id),
  CONSTRAINT fk_expected_progression_metric FOREIGN KEY (metric_type_id) REFERENCES metric_types (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- The best value of each metric in each workout: the history behind progress charts.
CREATE TABLE metric_observations (
  id                     BINARY(16) NOT NULL,
  user_id                BINARY(16) NOT NULL,
  exercise_id            BINARY(16) NOT NULL,
  metric_type_id         BINARY(16) NOT NULL,
  -- The weight of a REPS_AT_WEIGHT, 0 otherwise.
  qualifier              DECIMAL(12,3) NOT NULL DEFAULT 0,
  value                  DECIMAL(12,3) NOT NULL,
  workout_id             BINARY(16) NOT NULL,
  observed_at            DATETIME(6) NOT NULL,
  -- False for a late log: history and progress only.
  counts_for_competition BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_metric_observations_series (user_id, exercise_id, metric_type_id, observed_at),
  KEY ix_metric_observations_user (user_id, observed_at),
  CONSTRAINT fk_metric_observations_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_metric_observations_exercise FOREIGN KEY (exercise_id) REFERENCES exercises (id),
  CONSTRAINT fk_metric_observations_metric FOREIGN KEY (metric_type_id) REFERENCES metric_types (id),
  CONSTRAINT fk_metric_observations_workout FOREIGN KEY (workout_id) REFERENCES workouts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Every new best, kept: the current one per key is the athlete's record. A HELD record waits for review
-- and never becomes current until then.
CREATE TABLE personal_records (
  id                BINARY(16) NOT NULL,
  user_id           BINARY(16) NOT NULL,
  exercise_id       BINARY(16) NOT NULL,
  metric_type_id    BINARY(16) NOT NULL,
  qualifier         DECIMAL(12,3) NOT NULL DEFAULT 0,
  value             DECIMAL(12,3) NOT NULL,
  previous_value    DECIMAL(12,3) NULL,
  workout_id        BINARY(16) NOT NULL,
  status            ENUM('AWARDED','CALIBRATION','HELD','REVOKED','SUPERSEDED') NOT NULL,
  is_current        BOOLEAN NOT NULL DEFAULT TRUE,
  achieved_at       DATETIME(6) NOT NULL,
  -- The XP entry the record earned, if any.
  xp_transaction_id BINARY(16) NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  -- One current record per key: 1 while current, NULL otherwise (see rule_sets.active_slot).
  current_slot      TINYINT AS (IF(is_current, 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_personal_records_one_current (user_id, exercise_id, metric_type_id, qualifier, current_slot),
  KEY ix_personal_records_history (user_id, exercise_id, metric_type_id, achieved_at),
  KEY ix_personal_records_workout (workout_id),
  CONSTRAINT fk_personal_records_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_personal_records_exercise FOREIGN KEY (exercise_id) REFERENCES exercises (id),
  CONSTRAINT fk_personal_records_metric FOREIGN KEY (metric_type_id) REFERENCES metric_types (id),
  CONSTRAINT fk_personal_records_workout FOREIGN KEY (workout_id) REFERENCES workouts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- What calibration measured, and the level it showed.
ALTER TABLE baselines
  ADD COLUMN calibrated_value DECIMAL(12,3) NULL AFTER declared_value,
  ADD COLUMN experience_level ENUM('BEGINNER','INTERMEDIATE','ADVANCED') NULL AFTER status,
  ADD COLUMN logs_counted INT NOT NULL DEFAULT 0 AFTER experience_level,
  ADD COLUMN finalized_at DATETIME(6) NULL AFTER logs_counted;

-- The XP ledger (docs §5.8): append-only, the balances in user_stats are its cache.
CREATE TABLE xp_transactions (
  id               BINARY(16) NOT NULL,
  -- No cascade: accounts are anonymised, never deleted, and the ledger stays.
  user_id          BINARY(16) NOT NULL,
  amount           INT NOT NULL,
  reason           ENUM('WORKOUT','PR','CALIBRATION_PR','GOAL_MILESTONE','CHALLENGE','BATTLE','BATTLE_WIN',
                        'GYM_WAR_WIN','QUEST','REVERSAL','MODERATION','ADMIN_ADJUSTMENT') NOT NULL,
  source_type      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id        VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- The workout that earned it: one query gives a workout's points.
  workout_id       BINARY(16) NULL,
  reverses_id      BINARY(16) NULL,
  rule_set_version INT NOT NULL,
  explanation      JSON NOT NULL CHECK (JSON_VALID(explanation)),
  effective_at     DATETIME(6) NOT NULL,
  created_by       BINARY(16) NULL,
  created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  -- The same event is granted once: 1 unless the entry is a reversal (see rule_sets.active_slot).
  once_slot        TINYINT AS (IF(reverses_id IS NULL, 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_xp_transactions_source_once (user_id, reason, source_type, source_id, once_slot),
  UNIQUE KEY uq_xp_transactions_reverses (reverses_id),
  KEY ix_xp_transactions_user_effective (user_id, effective_at),
  KEY ix_xp_transactions_workout (user_id, workout_id),
  CONSTRAINT fk_xp_transactions_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_xp_transactions_reverses FOREIGN KEY (reverses_id) REFERENCES xp_transactions (id),
  -- Negative amounts only for corrections; a reversal names the entry it reverses.
  CONSTRAINT ck_xp_transactions_amount CHECK (amount >= 0 OR reason IN ('REVERSAL','MODERATION','ADMIN_ADJUSTMENT')),
  CONSTRAINT ck_xp_transactions_reversal CHECK ((reason = 'REVERSAL') = (reverses_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TRIGGER xp_transactions_no_update BEFORE UPDATE ON xp_transactions
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'xp_transactions is append-only';

CREATE TRIGGER xp_transactions_no_delete BEFORE DELETE ON xp_transactions
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'xp_transactions is append-only';

-- What the caps count, per business day; the row is locked while a workout is scored.
CREATE TABLE xp_daily_counters (
  user_id          BINARY(16) NOT NULL,
  day              DATE NOT NULL,
  xp_granted       INT NOT NULL DEFAULT 0,
  workouts_counted INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day),
  CONSTRAINT fk_xp_daily_counters_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

ALTER TABLE user_streaks
  ADD COLUMN longest_days INT NOT NULL DEFAULT 0 AFTER current_days,
  ADD COLUMN last_training_date DATE NULL AFTER longest_days;
