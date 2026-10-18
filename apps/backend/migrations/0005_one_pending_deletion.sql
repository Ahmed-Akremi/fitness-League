-- At most one PENDING deletion request per account: the column is the user id while the request is
-- pending and NULL otherwise, and NULLs never collide in a unique index (see rule_sets.active_slot).

ALTER TABLE deletion_requests
  ADD COLUMN pending_user BINARY(16) AS (IF(status = 'PENDING', user_id, NULL)) STORED,
  ADD UNIQUE KEY uq_deletion_requests_one_pending (pending_user);
