-- Accounts, sessions, one-time links, consents and deletion requests.

CREATE TABLE users (
  id                 BINARY(16) NOT NULL,
  -- Trimmed and lower-cased by the application. Case-insensitive but accent-SENSITIVE, so that
  -- rene@ and rené@ are never the same account.
  email              VARCHAR(254) COLLATE utf8mb4_uca1400_as_ci NOT NULL,
  username           VARCHAR(20) COLLATE utf8mb4_uca1400_as_ci NOT NULL,
  -- Argon2id PHC string. NULL once the account is anonymised.
  password_hash      VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  role               ENUM('USER','GYM_ADMIN','MODERATOR','ADMIN','SUPER_ADMIN','JUDGE','HEAD_JUDGE') NOT NULL DEFAULT 'USER',
  status             ENUM('ACTIVE','SUSPENDED','BANNED','DELETED') NOT NULL DEFAULT 'ACTIVE',
  -- Copied into every access token; incrementing it invalidates all of them at once.
  session_version    INT NOT NULL DEFAULT 1,
  email_verified_at  DATETIME(6) NULL,
  phone_e164         VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  date_of_birth      DATE NOT NULL,
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until       DATETIME(6) NULL,
  suspended_until    DATETIME(6) NULL,
  last_login_at      DATETIME(6) NULL,
  anonymised_at      DATETIME(6) NULL,
  created_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_phone (phone_e164),
  KEY ix_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE refresh_tokens (
  id             BINARY(16) NOT NULL,
  user_id        BINARY(16) NOT NULL,
  -- Every token descended from one login shares a family; reuse of an old token revokes the family.
  family_id      BINARY(16) NOT NULL,
  audience       ENUM('app','admin') NOT NULL,
  -- SHA-256 of the token. The token itself is never stored.
  token_hash     BINARY(32) NOT NULL,
  replaced_by_id BINARY(16) NULL,
  expires_at     DATETIME(6) NOT NULL,
  revoked_at     DATETIME(6) NULL,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY ix_refresh_tokens_family (family_id),
  KEY ix_refresh_tokens_user (user_id),
  KEY ix_refresh_tokens_expires (expires_at),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- One-time links sent by email (verify address, reset password).
CREATE TABLE email_tokens (
  id          BINARY(16) NOT NULL,
  user_id     BINARY(16) NOT NULL,
  purpose     ENUM('EMAIL_VERIFY','PASSWORD_RESET') NOT NULL,
  token_hash  BINARY(32) NOT NULL,
  expires_at  DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_tokens_hash (token_hash),
  KEY ix_email_tokens_user (user_id, purpose),
  KEY ix_email_tokens_expires (expires_at),
  CONSTRAINT fk_email_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- A history: a changed consent is a new row, never an update.
CREATE TABLE consents (
  id               BINARY(16) NOT NULL,
  user_id          BINARY(16) NOT NULL,
  type             ENUM('TERMS','PRIVACY','HEALTH_DATA','MARKETING') NOT NULL,
  document_version VARCHAR(20) NOT NULL,
  granted          BOOLEAN NOT NULL,
  created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_consents_user (user_id, type, created_at),
  CONSTRAINT fk_consents_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Account deletion with a 30-day grace period; signing in again cancels a pending request.
CREATE TABLE deletion_requests (
  id            BINARY(16) NOT NULL,
  user_id       BINARY(16) NOT NULL,
  status        ENUM('PENDING','CANCELLED','COMPLETED') NOT NULL DEFAULT 'PENDING',
  scheduled_for DATETIME(6) NOT NULL,
  completed_at  DATETIME(6) NULL,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_deletion_requests_due (status, scheduled_for),
  KEY ix_deletion_requests_user (user_id),
  CONSTRAINT fk_deletion_requests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
