-- Gyms, their sports, their members and their verification requests (docs §3.11); the primary gym's
-- foreign key; the gym scope of the leaderboard snapshots.

-- A gym starts PENDING and becomes VERIFIED through the verification queue (part 5). Contact details
-- and the proof never leave the API.
CREATE TABLE gyms (
  id             BINARY(16) NOT NULL,
  name           VARCHAR(80) NOT NULL,
  slug           VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  governorate_id BINARY(16) NOT NULL,
  city_id        BINARY(16) NOT NULL,
  address_line   VARCHAR(200) NULL,
  contact_phone  VARCHAR(16) NULL,
  contact_email  VARCHAR(254) NULL,
  instagram_url  VARCHAR(300) NULL,
  facebook_url   VARCHAR(300) NULL,
  website_url    VARCHAR(300) NULL,
  tiktok_url     VARCHAR(300) NULL,
  status         ENUM('PENDING','VERIFIED','REJECTED','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  owner_user_id  BINARY(16) NULL,
  verified_at    DATETIME(6) NULL,
  verified_by    BINARY(16) NULL,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_gyms_slug (slug),
  KEY ix_gyms_governorate_status (governorate_id, status),
  KEY ix_gyms_owner (owner_user_id),
  CONSTRAINT fk_gyms_governorate FOREIGN KEY (governorate_id) REFERENCES governorates (id),
  CONSTRAINT fk_gyms_city FOREIGN KEY (city_id) REFERENCES cities (id),
  CONSTRAINT fk_gyms_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_gyms_verified_by FOREIGN KEY (verified_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE gym_sports (
  gym_id   BINARY(16) NOT NULL,
  sport_id BINARY(16) NOT NULL,
  PRIMARY KEY (gym_id, sport_id),
  KEY ix_gym_sports_sport (sport_id),
  CONSTRAINT fk_gym_sports_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_sports_sport FOREIGN KEY (sport_id) REFERENCES sports (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- One gym per athlete: live_user is the athlete while the membership is PENDING or APPROVED and NULL
-- otherwise, and NULLs never collide in a unique index (as deletion_requests.pending_user).
CREATE TABLE gym_members (
  id           BINARY(16) NOT NULL,
  gym_id       BINARY(16) NOT NULL,
  user_id      BINARY(16) NOT NULL,
  status       ENUM('PENDING','APPROVED','REJECTED','REMOVED','LEFT') NOT NULL DEFAULT 'PENDING',
  role         ENUM('MEMBER','COACH') NOT NULL DEFAULT 'MEMBER',
  requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  approved_at  DATETIME(6) NULL,
  approved_by  BINARY(16) NULL,
  left_at      DATETIME(6) NULL,
  updated_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  live_user    BINARY(16) AS (IF(status IN ('PENDING','APPROVED'), user_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_members_live (live_user),
  KEY ix_gym_members_gym_status (gym_id, status),
  KEY ix_gym_members_user (user_id),
  CONSTRAINT fk_gym_members_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_members_approved_by FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- One pending submission per athlete, by the same generated-column rule.
CREATE TABLE gym_verification_requests (
  id                BINARY(16) NOT NULL,
  gym_id            BINARY(16) NOT NULL,
  submitted_by      BINARY(16) NOT NULL,
  proof_text        VARCHAR(1000) NOT NULL,
  status            ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  reviewed_by       BINARY(16) NULL,
  review_note       VARCHAR(500) NULL,
  reviewed_at       DATETIME(6) NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  pending_submitter BINARY(16) AS (IF(status = 'PENDING', submitted_by, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gym_verification_requests_pending (pending_submitter),
  KEY ix_gym_verification_requests_status (status, created_at),
  CONSTRAINT fk_gym_verification_requests_gym FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_verification_requests_submitter FOREIGN KEY (submitted_by) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_gym_verification_requests_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

ALTER TABLE profiles
  ADD CONSTRAINT fk_profiles_gym FOREIGN KEY (primary_gym_id) REFERENCES gyms (id) ON DELETE SET NULL;

ALTER TABLE leaderboard_snapshots
  MODIFY scope_type ENUM('NATIONAL','GOVERNORATE','GYM') NOT NULL;
