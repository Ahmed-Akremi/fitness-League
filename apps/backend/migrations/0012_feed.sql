-- The activity feed, its reactions and comments (docs §3.9); the admins' home news and its likes; the
-- index the live socket's tail reads notifications by.

-- One row per thing an athlete did that their friends may see, written in the transaction of its cause
-- (feed::record). The payload is the old API's; the rows the feed prints from are also columns, so the
-- feed joins them.
CREATE TABLE activity_events (
  id          BINARY(16) NOT NULL,
  user_id     BINARY(16) NOT NULL,
  type        ENUM('WORKOUT','PR','BADGE','LEVEL_UP','BATTLE_WIN','GYM_WAR_WIN','GOAL_COMPLETED') NOT NULL,
  ref_type    ENUM('workout','personal_record','user_badge','xp_transaction','goal','battle','gym_war') NOT NULL,
  ref_id      BINARY(16) NOT NULL,
  visibility  ENUM('PUBLIC','FRIENDS','PRIVATE') NOT NULL,
  payload     JSON NOT NULL,
  sport_id    BINARY(16) NULL,
  exercise_id BINARY(16) NULL,
  badge_id    BINARY(16) NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_activity_events_user (user_id, id),
  CONSTRAINT fk_activity_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_activity_events_sport FOREIGN KEY (sport_id) REFERENCES sports (id),
  CONSTRAINT fk_activity_events_exercise FOREIGN KEY (exercise_id) REFERENCES exercises (id),
  CONSTRAINT fk_activity_events_badge FOREIGN KEY (badge_id) REFERENCES badges (id),
  CONSTRAINT ck_activity_events_payload CHECK (JSON_VALID(payload))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- One reaction per athlete per item; changing it replaces the type.
CREATE TABLE activity_reactions (
  activity_event_id BINARY(16) NOT NULL,
  user_id           BINARY(16) NOT NULL,
  type              ENUM('LIKE','FIRE','STRONG') NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (activity_event_id, user_id),
  KEY ix_activity_reactions_user (user_id),
  CONSTRAINT fk_activity_reactions_event FOREIGN KEY (activity_event_id) REFERENCES activity_events (id) ON DELETE CASCADE,
  CONSTRAINT fk_activity_reactions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- A deleted comment stays, hidden, as in the old API.
CREATE TABLE activity_comments (
  id                BINARY(16) NOT NULL,
  activity_event_id BINARY(16) NOT NULL,
  user_id           BINARY(16) NOT NULL,
  body              VARCHAR(500) NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at        DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY ix_activity_comments_event (activity_event_id, id),
  KEY ix_activity_comments_user (user_id),
  CONSTRAINT fk_activity_comments_event FOREIGN KEY (activity_event_id) REFERENCES activity_events (id) ON DELETE CASCADE,
  CONSTRAINT fk_activity_comments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Home news, published from the admin panel (part 5). The photo comes with part 5's file storage.
CREATE TABLE announcements (
  id         BINARY(16) NOT NULL,
  author_id  BINARY(16) NULL,
  body       VARCHAR(2000) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY ix_announcements_live (deleted_at, id),
  CONSTRAINT fk_announcements_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- One like per athlete per post.
CREATE TABLE announcement_likes (
  announcement_id BINARY(16) NOT NULL,
  user_id         BINARY(16) NOT NULL,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (announcement_id, user_id),
  KEY ix_announcement_likes_user (user_id),
  CONSTRAINT fk_announcement_likes_announcement FOREIGN KEY (announcement_id) REFERENCES announcements (id) ON DELETE CASCADE,
  CONSTRAINT fk_announcement_likes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- The live socket's tail reads the notifications of the last seconds.
ALTER TABLE notifications ADD KEY ix_notifications_created (created_at);
