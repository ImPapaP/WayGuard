-- Durable, append-only history for administrator jurisdiction assignments.
-- Keep history rows when an account is disabled or reassigned.
CREATE TABLE IF NOT EXISTS admin_jurisdiction_assignment_history (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  lgu_id INT NOT NULL REFERENCES lgus(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('assigned', 'revoked')),
  changed_by INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS admin_jurisdiction_history_user_idx
  ON admin_jurisdiction_assignment_history(user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS admin_jurisdiction_history_lgu_idx
  ON admin_jurisdiction_assignment_history(lgu_id, changed_at DESC);

-- Record pre-existing assignments as migration history without changing access.
INSERT INTO admin_jurisdiction_assignment_history
  (user_id, lgu_id, action, changed_by, details)
SELECT user_id, lgu_id, 'assigned', assigned_by, '{"source":"migration_bootstrap"}'::jsonb
FROM admin_jurisdiction_assignments;