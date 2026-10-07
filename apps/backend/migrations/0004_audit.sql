-- Append-only trail of security and administration events. Never put a secret or health data in it.
-- No foreign key to users: the trail must outlive the accounts it describes.

CREATE TABLE audit_log (
  id          BINARY(16) NOT NULL,
  actor_id    BINARY(16) NULL,
  actor_role  VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  action      VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_id   BINARY(16) NULL,
  before_json JSON NULL,
  after_json  JSON NULL,
  request_id  VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_audit_log_entity (entity_id, created_at),
  KEY ix_audit_log_actor (actor_id, created_at),
  KEY ix_audit_log_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Enforced by the database itself. The application account has no right to drop a trigger or to
-- TRUNCATE, so even a compromised API cannot rewrite the trail.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
