-- Reference catalog: places, sports, metrics, exercises and scoring rule sets.

CREATE TABLE countries (
  code    CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name_fr VARCHAR(80) NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  name_ar VARCHAR(80) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE governorates (
  id           BINARY(16) NOT NULL,
  country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code         VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name_fr      VARCHAR(80) NOT NULL,
  name_en      VARCHAR(80) NOT NULL,
  name_ar      VARCHAR(80) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_governorates_code (code),
  CONSTRAINT fk_governorates_country FOREIGN KEY (country_code) REFERENCES countries (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE cities (
  id             BINARY(16) NOT NULL,
  governorate_id BINARY(16) NOT NULL,
  code           VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name_fr        VARCHAR(80) NOT NULL,
  name_en        VARCHAR(80) NOT NULL,
  name_ar        VARCHAR(80) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cities_code (code),
  KEY ix_cities_governorate (governorate_id),
  CONSTRAINT fk_cities_governorate FOREIGN KEY (governorate_id) REFERENCES governorates (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE sports (
  id           BINARY(16) NOT NULL,
  code         VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category     ENUM('STRENGTH','FUNCTIONAL','CARDIO') NOT NULL,
  logging_mode ENUM('SETS_REPS_WEIGHT','DISTANCE_TIME','MIXED') NOT NULL,
  icon         VARCHAR(40) NULL,
  name_fr      VARCHAR(80) NOT NULL,
  name_en      VARCHAR(80) NOT NULL,
  name_ar      VARCHAR(80) NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sports_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE metric_types (
  id        BINARY(16) NOT NULL,
  code      VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  unit      VARCHAR(16) NOT NULL,
  direction ENUM('HIGHER_IS_BETTER','LOWER_IS_BETTER') NOT NULL,
  name_fr   VARCHAR(80) NOT NULL,
  name_en   VARCHAR(80) NOT NULL,
  name_ar   VARCHAR(80) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_metric_types_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE exercises (
  id             BINARY(16) NOT NULL,
  -- NULL = shared by every strength and functional sport (e.g. the squat).
  sport_id       BINARY(16) NULL,
  code           VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name_fr        VARCHAR(120) NOT NULL,
  name_en        VARCHAR(120) NOT NULL,
  name_ar        VARCHAR(120) NOT NULL,
  equipment      VARCHAR(40) NULL,
  is_bodyweight  BOOLEAN NOT NULL DEFAULT FALSE,
  exercise_group ENUM('MOVEMENT','BENCHMARK_WOD','HYROX_STATION','HYROX_RACE') NULL,
  description_fr TEXT NULL,
  description_en TEXT NULL,
  description_ar TEXT NULL,
  plausibility   JSON NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_exercises_code (code),
  KEY ix_exercises_sport (sport_id),
  KEY ix_exercises_updated (updated_at),
  CONSTRAINT fk_exercises_sport FOREIGN KEY (sport_id) REFERENCES sports (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Which metrics an exercise tracks, in display order.
CREATE TABLE exercise_metrics (
  exercise_id    BINARY(16) NOT NULL,
  metric_type_id BINARY(16) NOT NULL,
  position       SMALLINT NOT NULL,
  PRIMARY KEY (exercise_id, metric_type_id),
  CONSTRAINT fk_exercise_metrics_exercise FOREIGN KEY (exercise_id) REFERENCES exercises (id) ON DELETE CASCADE,
  CONSTRAINT fk_exercise_metrics_metric FOREIGN KEY (metric_type_id) REFERENCES metric_types (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE rule_sets (
  id           BINARY(16) NOT NULL,
  version      INT NOT NULL,
  status       ENUM('DRAFT','ACTIVE','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  config       JSON NOT NULL,
  change_note  VARCHAR(500) NOT NULL,
  activated_at DATETIME(6) NULL,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  -- At most one ACTIVE rule set: the column is NULL for every other row, and NULLs never collide in a
  -- unique index. This is the MariaDB form of a PostgreSQL partial unique index.
  active_slot  TINYINT AS (IF(status = 'ACTIVE', 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rule_sets_version (version),
  UNIQUE KEY uq_rule_sets_one_active (active_slot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
