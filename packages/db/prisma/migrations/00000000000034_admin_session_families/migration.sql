BEGIN;
SET LOCAL lock_timeout = '5s';
-- Old sessions have no reliable rotation lineage. Revoke them once rather than
-- guessing relationships between independent device logins. Leave NULL as the
-- database default so old processes during rollout cannot mint trusted families.
ALTER TABLE admin_session ADD COLUMN family_id uuid;
UPDATE admin_session SET revoked_at = now() WHERE revoked_at IS NULL;
CREATE INDEX admin_session_admin_user_id_family_id_idx ON admin_session(admin_user_id, family_id);
COMMIT;
