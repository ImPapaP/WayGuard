-- Multi-LGU tenancy. Existing records are assigned to one default LGU so
-- upgrading a single-LGU installation preserves its data and user accounts.
CREATE TABLE lgus (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  city        TEXT,
  province    TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lgus_name_len CHECK (char_length(name) BETWEEN 2 AND 120),
  CONSTRAINT lgus_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE UNIQUE INDEX lgus_name_uq ON lgus (lower(name));
CREATE UNIQUE INDEX lgus_slug_uq ON lgus (slug);

-- Create the first tenant using the setting already configured by the current
-- installation. This deliberately keeps all existing data together.
INSERT INTO lgus (name, slug, city, province)
SELECT
  COALESCE(NULLIF(value #>> '{}', ''), 'Local Government Unit'),
  COALESCE(
    NULLIF(trim(both '-' FROM lower(regexp_replace(COALESCE(value #>> '{}', 'local-government-unit'), '[^a-zA-Z0-9]+', '-', 'g'))), ''),
    'local-government-unit'
  ),
  CASE WHEN COALESCE(value #>> '{}', '') ILIKE '%malolos%' THEN 'Malolos' ELSE NULL END,
  CASE WHEN COALESCE(value #>> '{}', '') ILIKE '%malolos%' THEN 'Bulacan' ELSE NULL END
FROM settings
WHERE key = 'lgu_name'
ON CONFLICT DO NOTHING;

-- Add tenant ownership. The first tenant always has id 1 on an existing
-- single-tenant database; defaults keep migration/seed tooling compatible.
ALTER TABLE users ADD COLUMN lgu_id INT REFERENCES lgus(id) ON DELETE RESTRICT DEFAULT 1;
ALTER TABLE agencies ADD COLUMN lgu_id INT NOT NULL REFERENCES lgus(id) ON DELETE RESTRICT DEFAULT 1;
ALTER TABLE maintenance_teams ADD COLUMN lgu_id INT NOT NULL REFERENCES lgus(id) ON DELETE RESTRICT DEFAULT 1;
ALTER TABLE reports ADD COLUMN lgu_id INT NOT NULL REFERENCES lgus(id) ON DELETE RESTRICT DEFAULT 1;
ALTER TABLE settings ADD COLUMN lgu_id INT NOT NULL REFERENCES lgus(id) ON DELETE CASCADE DEFAULT 1;
ALTER TABLE audit_logs ADD COLUMN lgu_id INT REFERENCES lgus(id) ON DELETE SET NULL DEFAULT 1;
ALTER TABLE assignments ADD COLUMN lgu_id INT NOT NULL REFERENCES lgus(id) ON DELETE RESTRICT DEFAULT 1;

-- A platform administrator is the only role that is not attached to an LGU.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('citizen', 'admin', 'staff', 'maintenance', 'platform_admin'));
ALTER TABLE users ADD CONSTRAINT users_lgu_presence_check
  CHECK (
    (role = 'platform_admin' AND lgu_id IS NULL)
    OR (role <> 'platform_admin' AND lgu_id IS NOT NULL)
  );

-- Tenant-scoped names/settings. Names may repeat across LGUs without collision.
DROP INDEX IF EXISTS agencies_name_uq;
CREATE UNIQUE INDEX agencies_name_uq ON agencies (lgu_id, lower(name));
DROP INDEX IF EXISTS maintenance_teams_name_uq;
CREATE UNIQUE INDEX maintenance_teams_name_uq ON maintenance_teams (lgu_id, lower(name));

ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY (lgu_id, key);

-- Keep references inside the same LGU even if a future API handler is wrong.
ALTER TABLE agencies ADD CONSTRAINT agencies_lgu_id_id_uq UNIQUE (lgu_id, id);
ALTER TABLE maintenance_teams ADD CONSTRAINT teams_lgu_id_id_uq UNIQUE (lgu_id, id);
ALTER TABLE reports ADD CONSTRAINT reports_lgu_id_id_uq UNIQUE (lgu_id, id);
ALTER TABLE users ADD CONSTRAINT users_lgu_id_id_uq UNIQUE (lgu_id, id);

ALTER TABLE maintenance_teams
  ADD CONSTRAINT teams_agency_same_lgu_fk
  FOREIGN KEY (lgu_id, agency_id) REFERENCES agencies (lgu_id, id) ON DELETE RESTRICT;
ALTER TABLE users
  ADD CONSTRAINT users_team_same_lgu_fk
  FOREIGN KEY (lgu_id, team_id) REFERENCES maintenance_teams (lgu_id, id) ON DELETE RESTRICT;
ALTER TABLE reports
  ADD CONSTRAINT reports_agency_same_lgu_fk
  FOREIGN KEY (lgu_id, agency_id) REFERENCES agencies (lgu_id, id) ON DELETE RESTRICT;
ALTER TABLE reports
  ADD CONSTRAINT reports_duplicate_same_lgu_fk
  FOREIGN KEY (lgu_id, duplicate_of_id) REFERENCES reports (lgu_id, id) ON DELETE RESTRICT;
ALTER TABLE assignments
  ADD CONSTRAINT assignments_report_same_lgu_fk
  FOREIGN KEY (lgu_id, report_id) REFERENCES reports (lgu_id, id) ON DELETE CASCADE;
ALTER TABLE assignments
  ADD CONSTRAINT assignments_team_same_lgu_fk
  FOREIGN KEY (lgu_id, team_id) REFERENCES maintenance_teams (lgu_id, id) ON DELETE RESTRICT;
ALTER TABLE assignments
  ADD CONSTRAINT assignments_actor_same_lgu_fk
  FOREIGN KEY (lgu_id, assigned_by) REFERENCES users (lgu_id, id) ON DELETE RESTRICT;

-- Tenant indexes support every report queue and crew workload query.
CREATE INDEX users_lgu_role_idx ON users (lgu_id, role, is_active);
CREATE INDEX agencies_lgu_active_idx ON agencies (lgu_id, is_active);
CREATE INDEX teams_lgu_active_idx ON maintenance_teams (lgu_id, is_active);
CREATE INDEX reports_lgu_status_idx ON reports (lgu_id, status, created_at DESC);
CREATE INDEX assignments_lgu_team_idx ON assignments (lgu_id, team_id, is_active);
CREATE INDEX audit_logs_lgu_created_idx ON audit_logs (lgu_id, created_at DESC);

-- Historical audit entries inherit the tenant from their actor.
UPDATE audit_logs a SET lgu_id = u.lgu_id
FROM users u WHERE a.actor_id = u.id;
