-- The social graph (friendships, follows, blocks), the in-app notifications, and the push preferences.

-- Mutual: one row per pair, the lower id first, whoever asked in requested_by (docs §3.8).
CREATE TABLE friendships (
  user_low_id  BINARY(16) NOT NULL,
  user_high_id BINARY(16) NOT NULL,
  status       ENUM('PENDING','ACCEPTED') NOT NULL DEFAULT 'PENDING',
  requested_by BINARY(16) NOT NULL,
  accepted_at  DATETIME(6) NULL,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_low_id, user_high_id),
  KEY ix_friendships_high (user_high_id),
  CONSTRAINT fk_friendships_low FOREIGN KEY (user_low_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_friendships_high FOREIGN KEY (user_high_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_friendships_requester FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_friendships_order CHECK (user_low_id < user_high_id),
  CONSTRAINT ck_friendships_requester CHECK (requested_by IN (user_low_id, user_high_id))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE follows (
  follower_id BINARY(16) NOT NULL,
  followee_id BINARY(16) NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (follower_id, followee_id),
  KEY ix_follows_followee (followee_id),
  CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_follows_followee FOREIGN KEY (followee_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_follows_other CHECK (follower_id <> followee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Hides both accounts from each other everywhere but the leaderboards.
CREATE TABLE blocks (
  blocker_id BINARY(16) NOT NULL,
  blocked_id BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (blocker_id, blocked_id),
  KEY ix_blocks_blocked (blocked_id),
  CONSTRAINT fk_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_blocks_other CHECK (blocker_id <> blocked_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- The bell (docs §3.12). The types are the old API's, all of them, as the app knows them; ids are UUID v7, so
-- the newest first is id DESC.
CREATE TABLE notifications (
  id         BINARY(16) NOT NULL,
  user_id    BINARY(16) NOT NULL,
  type       ENUM('FRIEND_REQUEST','FRIEND_ACCEPTED','BATTLE_INVITE','BATTLE_STARTED','BATTLE_DECLINED',
                  'BATTLE_RESULT','DUEL_MATCHED','DUEL_GHOST','GYM_WAR_STARTED','GYM_WAR_RESULT','BADGE_AWARDED',
                  'CHALLENGE_COMPLETED','ACTIVITY_REACTION','ACTIVITY_COMMENT','PROOF_VERIFIED','PROOF_REJECTED',
                  'REPORT_HANDLED','SANCTION_WARNING','APPEAL_DECIDED','GYM_WOD_SCORE_INVALIDATED',
                  'COMPETITION_REGISTRATION_CONFIRMED','COMPETITION_WOD_AVAILABLE','COMPETITION_SCORE_SUBMITTED',
                  'COMPETITION_SCORE_UNDER_REVIEW','COMPETITION_SCORE_APPROVED','COMPETITION_SCORE_REJECTED',
                  'COMPETITION_SCORE_MODIFIED','COMPETITION_SCORE_NEEDS_CORRECTION','COMPETITION_APPEAL_DECIDED',
                  'COMPETITION_LEADERBOARD_FINAL','ANNOUNCEMENT') NOT NULL,
  payload    JSON NOT NULL,
  read_at    DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_notifications_user (user_id, id),
  KEY ix_notifications_unread (user_id, read_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_notifications_payload CHECK (JSON_VALID(payload))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Push categories, all on until switched off, and quiet hours in local time (both or neither).
ALTER TABLE user_settings
  ADD COLUMN push_social      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN push_battles     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN push_competition BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN push_challenges  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN push_badges      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN push_gym         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN quiet_hours_start TIME NULL,
  ADD COLUMN quiet_hours_end   TIME NULL,
  ADD CONSTRAINT ck_user_settings_quiet_hours CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL));
