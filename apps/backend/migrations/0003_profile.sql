-- What an athlete tells us about themselves, their settings, and the counters the scoring engine fills.

CREATE TABLE profiles (
  user_id                        BINARY(16) NOT NULL,
  full_name                      VARCHAR(80) NOT NULL,
  bio                            VARCHAR(280) NULL,
  gender                         ENUM('MALE','FEMALE','UNDISCLOSED') NULL,
  country_code                   CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TN',
  governorate_id                 BINARY(16) NOT NULL,
  city_id                        BINARY(16) NOT NULL,
  -- The gyms table arrives with part 3, which adds the foreign key.
  primary_gym_id                 BINARY(16) NULL,
  experience_level_declared      ENUM('BEGINNER','INTERMEDIATE','ADVANCED') NULL,
  planned_training_days_per_week TINYINT NOT NULL DEFAULT 3,
  calibration_started_at         DATETIME(6) NULL,
  calibration_ends_at            DATETIME(6) NULL,
  onboarding_completed_at        DATETIME(6) NULL,
  created_at                     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at                     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id),
  KEY ix_profiles_governorate (governorate_id),
  KEY ix_profiles_gym (primary_gym_id),
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_profiles_country FOREIGN KEY (country_code) REFERENCES countries (code),
  CONSTRAINT fk_profiles_governorate FOREIGN KEY (governorate_id) REFERENCES governorates (id),
  CONSTRAINT fk_profiles_city FOREIGN KEY (city_id) REFERENCES cities (id),
  CONSTRAINT ck_profiles_training_days CHECK (planned_training_days_per_week BETWEEN 1 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE user_settings (
  user_id                     BINARY(16) NOT NULL,
  locale                      ENUM('fr','en','ar') NOT NULL DEFAULT 'fr',
  theme                       ENUM('DARK','LIGHT','SYSTEM') NOT NULL DEFAULT 'DARK',
  -- NULL = follow the device setting.
  reduced_motion              BOOLEAN NULL,
  default_visibility          ENUM('PUBLIC','FRIENDS','PRIVATE') NOT NULL DEFAULT 'FRIENDS',
  show_age_bracket            BOOLEAN NOT NULL DEFAULT FALSE,
  show_on_leaderboards        BOOLEAN NOT NULL DEFAULT TRUE,
  streak_freeze_days_per_week TINYINT NOT NULL DEFAULT 2,
  created_at                  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at                  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_user_settings_freeze CHECK (streak_freeze_days_per_week BETWEEN 0 AND 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Created at registration with these defaults; the scoring engine of part 2 fills them.
CREATE TABLE user_stats (
  user_id              BINARY(16) NOT NULL,
  xp_total             BIGINT NOT NULL DEFAULT 0,
  level                INT NOT NULL DEFAULT 1,
  xp_into_level        INT NOT NULL DEFAULT 0,
  xp_for_next_level    INT NOT NULL DEFAULT 100,
  -- The seasons table arrives with part 2, which adds the foreign key.
  current_season_id    BINARY(16) NULL,
  season_lp            INT NOT NULL DEFAULT 0,
  division_code        VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  leaderboard_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_stats_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE user_streaks (
  user_id       BINARY(16) NOT NULL,
  current_weeks INT NOT NULL DEFAULT 0,
  longest_weeks INT NOT NULL DEFAULT 0,
  current_days  INT NOT NULL DEFAULT 0,
  updated_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_streaks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE user_sports (
  user_id    BINARY(16) NOT NULL,
  sport_id   BINARY(16) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, sport_id),
  CONSTRAINT fk_user_sports_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_sports_sport FOREIGN KEY (sport_id) REFERENCES sports (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Starting values declared at onboarding. Only PROVISIONAL rows can still be changed by a declaration.
CREATE TABLE baselines (
  id              BINARY(16) NOT NULL,
  user_id         BINARY(16) NOT NULL,
  exercise_id     BINARY(16) NOT NULL,
  metric_type_id  BINARY(16) NOT NULL,
  declared_value  DECIMAL(12,3) NULL,
  effective_value DECIMAL(12,3) NOT NULL,
  status          ENUM('PROVISIONAL','FINAL','CORRECTED') NOT NULL DEFAULT 'PROVISIONAL',
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_baselines_user_exercise_metric (user_id, exercise_id, metric_type_id),
  CONSTRAINT fk_baselines_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_baselines_exercise FOREIGN KEY (exercise_id) REFERENCES exercises (id),
  CONSTRAINT fk_baselines_metric FOREIGN KEY (metric_type_id) REFERENCES metric_types (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
