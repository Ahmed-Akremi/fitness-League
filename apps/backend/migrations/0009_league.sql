-- The league: seasons, the League Points ledger, weekly scores, standings, leaderboard snapshots, and the
-- runs of the jobs that must happen once.

-- A season per country, a calendar quarter by default (docs §5.10.4). One is active at a time.
CREATE TABLE seasons (
  id                        BINARY(16) NOT NULL,
  name                      VARCHAR(40) NOT NULL,
  country_code              CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TN',
  starts_at                 DATETIME(6) NOT NULL,
  ends_at                   DATETIME(6) NOT NULL,
  status                    ENUM('SCHEDULED','ACTIVE','CLOSED') NOT NULL DEFAULT 'SCHEDULED',
  closed_at                 DATETIME(6) NULL,
  rule_set_version_at_close INT NULL,
  created_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  -- 1 while active, NULL otherwise (see rule_sets.active_slot).
  active_slot               TINYINT AS (IF(status = 'ACTIVE', 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_seasons_one_active (country_code, active_slot),
  KEY ix_seasons_country_status (country_code, status),
  CONSTRAINT fk_seasons_country FOREIGN KEY (country_code) REFERENCES countries (code),
  CONSTRAINT ck_seasons_dates CHECK (ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

ALTER TABLE user_stats
  ADD CONSTRAINT fk_user_stats_season FOREIGN KEY (current_season_id) REFERENCES seasons (id);

-- The League Points ledger (docs §5.8): append-only, like xp_transactions; user_stats.season_lp is its cache.
CREATE TABLE league_point_transactions (
  id               BINARY(16) NOT NULL,
  -- No cascade: accounts are anonymised, never deleted, and the ledger stays.
  user_id          BINARY(16) NOT NULL,
  season_id        BINARY(16) NOT NULL,
  amount           INT NOT NULL,
  reason           ENUM('WEEKLY_SCORE','BATTLE_WIN','BATTLE_DRAW','BATTLE_PARTICIPATION','GYM_WAR','SEASON_SOFT_RESET',
                        'REVERSAL','MODERATION','ADMIN_ADJUSTMENT') NOT NULL,
  source_type      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id        VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reverses_id      BINARY(16) NULL,
  rule_set_version INT NOT NULL,
  explanation      JSON NOT NULL CHECK (JSON_VALID(explanation)),
  effective_at     DATETIME(6) NOT NULL,
  created_by       BINARY(16) NULL,
  created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  -- The same event is granted once: 1 unless the entry is a reversal (see rule_sets.active_slot).
  once_slot        TINYINT AS (IF(reverses_id IS NULL, 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_league_point_transactions_source_once (user_id, reason, source_type, source_id, once_slot),
  UNIQUE KEY uq_league_point_transactions_reverses (reverses_id),
  KEY ix_league_point_transactions_user_season (user_id, season_id, created_at),
  CONSTRAINT fk_league_point_transactions_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_league_point_transactions_season FOREIGN KEY (season_id) REFERENCES seasons (id),
  CONSTRAINT fk_league_point_transactions_reverses FOREIGN KEY (reverses_id) REFERENCES league_point_transactions (id),
  -- Negative amounts only for corrections; a reversal names the entry it reverses.
  CONSTRAINT ck_league_point_transactions_amount CHECK (amount >= 0 OR reason IN ('REVERSAL','MODERATION','ADMIN_ADJUSTMENT')),
  CONSTRAINT ck_league_point_transactions_reversal CHECK ((reason = 'REVERSAL') = (reverses_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TRIGGER league_point_transactions_no_update BEFORE UPDATE ON league_point_transactions
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'league_point_transactions is append-only';

CREATE TRIGGER league_point_transactions_no_delete BEFORE DELETE ON league_point_transactions
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'league_point_transactions is append-only';

-- A closed week's final score (docs §5.5); the running week is computed on read. week_start is the local date of
-- its Monday. A week outside any season has no season and earned no LP.
CREATE TABLE weekly_scores (
  id                BINARY(16) NOT NULL,
  user_id           BINARY(16) NOT NULL,
  week_start        DATE NOT NULL,
  season_id         BINARY(16) NULL,
  rule_set_version  INT NOT NULL,
  progress_c        DECIMAL(5,2) NOT NULL,
  consistency_c     DECIMAL(5,2) NOT NULL,
  performance_c     DECIMAL(5,2) NOT NULL,
  -- NULL while challenges do not count.
  challenge_c       DECIMAL(5,2) NULL,
  total             DECIMAL(5,2) NOT NULL,
  breakdown         JSON NOT NULL CHECK (JSON_VALID(breakdown)),
  lp_transaction_id BINARY(16) NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_weekly_scores_user_week (user_id, week_start),
  KEY ix_weekly_scores_season_week (season_id, week_start),
  CONSTRAINT fk_weekly_scores_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_weekly_scores_season FOREIGN KEY (season_id) REFERENCES seasons (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- A closed season's final ranks and champions.
CREATE TABLE season_standings (
  season_id        BINARY(16) NOT NULL,
  user_id          BINARY(16) NOT NULL,
  final_lp         INT NOT NULL,
  -- Declared in rank order.
  division         ENUM('BRONZE','SILVER','GOLD','PLATINUM','DIAMOND','ELITE') NOT NULL,
  rank_national    INT NULL,
  rank_governorate INT NULL,
  rank_gym         INT NULL,
  is_champion      BOOLEAN NOT NULL DEFAULT FALSE,
  champion_scope   ENUM('NATIONAL','GOVERNORATE') NULL,
  created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (season_id, user_id),
  KEY ix_season_standings_user (user_id),
  CONSTRAINT fk_season_standings_season FOREIGN KEY (season_id) REFERENCES seasons (id),
  CONSTRAINT fk_season_standings_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- The daily ranks the movement arrows compare with. scope_id is the zero id for the national board.
-- shortcut: snapshots grow by one row per eligible athlete per scope per day, add retention once real volumes are known.
CREATE TABLE leaderboard_snapshots (
  snapshot_date DATE NOT NULL,
  season_id     BINARY(16) NOT NULL,
  scope_type    ENUM('NATIONAL','GOVERNORATE') NOT NULL,
  scope_id      BINARY(16) NOT NULL,
  user_id       BINARY(16) NOT NULL,
  `rank`        INT NOT NULL,
  lp            INT NOT NULL,
  PRIMARY KEY (snapshot_date, scope_type, scope_id, user_id),
  KEY ix_leaderboard_snapshots_scope (season_id, scope_type, scope_id, snapshot_date),
  CONSTRAINT fk_leaderboard_snapshots_season FOREIGN KEY (season_id) REFERENCES seasons (id),
  CONSTRAINT fk_leaderboard_snapshots_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Each run of a job that must happen once per key (a week, a season, a day). A RUNNING row older than an hour, or a
-- FAILED one, is taken over by the next tick.
CREATE TABLE job_runs (
  id          BINARY(16) NOT NULL,
  job         VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_key     VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status      ENUM('RUNNING','DONE','FAILED') NOT NULL,
  result      JSON NULL CHECK (JSON_VALID(result)),
  error       VARCHAR(2000) NULL,
  started_at  DATETIME(6) NOT NULL,
  finished_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_runs_job_key (job, run_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- What the baseline audit (docs §5.4) changed, and under which rule set.
ALTER TABLE baselines
  ADD COLUMN corrected_from DECIMAL(12,3) NULL AFTER effective_value,
  ADD COLUMN rule_set_version INT NULL AFTER finalized_at;
