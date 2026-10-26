-- Geographic hierarchy and explicit administrator jurisdiction assignments.
-- Existing LGU and report records remain intact; all new columns are nullable
-- so current installations can migrate without losing data.
ALTER TABLE lgus
  ADD COLUMN IF NOT EXISTS jurisdiction_level TEXT NOT NULL DEFAULT 'municipality'
    CHECK (jurisdiction_level IN ('national', 'island_group', 'region', 'province', 'independent_city', 'city', 'municipality', 'barangay')),
  ADD COLUMN IF NOT EXISTS parent_lgu_id INT NULL REFERENCES lgus(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS lgus_parent_idx ON lgus(parent_lgu_id);
CREATE INDEX IF NOT EXISTS lgus_level_idx ON lgus(jurisdiction_level);

-- An administrator can be explicitly assigned to a jurisdiction node.
-- Only platform administrators may change these rows through platform routes.
CREATE TABLE IF NOT EXISTS admin_jurisdiction_assignments (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  lgu_id INT NOT NULL REFERENCES lgus(id) ON DELETE RESTRICT,
  assigned_by INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, lgu_id)
);

CREATE INDEX IF NOT EXISTS admin_jurisdiction_user_idx
  ON admin_jurisdiction_assignments(user_id);
CREATE INDEX IF NOT EXISTS admin_jurisdiction_lgu_idx
  ON admin_jurisdiction_assignments(lgu_id);

-- Preserve current administrator access by recording each existing LGU admin's
-- current workspace as their initial jurisdiction assignment.
INSERT INTO admin_jurisdiction_assignments (user_id, lgu_id, assigned_by)
SELECT u.id, u.lgu_id, u.id
FROM users u
WHERE u.role = 'admin' AND u.lgu_id IS NOT NULL
ON CONFLICT (user_id, lgu_id) DO NOTHING;
