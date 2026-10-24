-- Wayguard initial schema (PostgreSQL 14+)
-- Applied by `npm run db:migrate`. Each migration runs inside a transaction.

-- ---------------------------------------------------------------------------
-- Reference data: responsible agencies and maintenance teams
-- ---------------------------------------------------------------------------
CREATE TABLE agencies (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  jurisdiction  TEXT NOT NULL CHECK (jurisdiction IN ('national', 'provincial', 'city_municipal', 'barangay', 'other')),
  contact_email TEXT,
  contact_phone TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agencies_name_len CHECK (char_length(name) BETWEEN 2 AND 120)
);
CREATE UNIQUE INDEX agencies_name_uq ON agencies (lower(name));

CREATE TABLE maintenance_teams (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  agency_id   INT REFERENCES agencies (id) ON DELETE SET NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teams_name_len CHECK (char_length(name) BETWEEN 2 AND 120)
);
CREATE UNIQUE INDEX maintenance_teams_name_uq ON maintenance_teams (lower(name));

-- ---------------------------------------------------------------------------
-- Users and sessions
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  phone                TEXT,
  role                 TEXT NOT NULL CHECK (role IN ('citizen', 'admin', 'maintenance')),
  team_id              INT REFERENCES maintenance_teams (id) ON DELETE SET NULL,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  email_notifications  BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_team_only_for_maintenance CHECK (role = 'maintenance' OR team_id IS NULL),
  CONSTRAINT users_email_len CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT users_name_len CHECK (char_length(full_name) BETWEEN 2 AND 100)
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_role_idx ON users (role);
CREATE INDEX users_team_idx ON users (team_id);

-- Only a SHA-256 hash of the session token is stored, so a database leak does
-- not reveal usable session cookies.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Pothole reports
-- ---------------------------------------------------------------------------
CREATE SEQUENCE report_code_seq START 1;

CREATE TABLE reports (
  id                  SERIAL PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  reporter_id         INT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  description         TEXT NOT NULL,
  road_name           TEXT NOT NULL,
  barangay            TEXT,
  city                TEXT,
  landmark            TEXT,
  hazards             TEXT[] NOT NULL DEFAULT '{}',
  road_type           TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (road_type IN ('national', 'provincial', 'city_municipal', 'barangay', 'private', 'unknown')),
  reported_severity   TEXT NOT NULL CHECK (reported_severity IN ('low', 'medium', 'high')),
  severity            TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  status              TEXT NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('submitted', 'under_review', 'verified', 'assigned', 'in_progress', 'resolved', 'rejected', 'duplicate')),
  latitude            DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude           DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  location_source     TEXT NOT NULL CHECK (location_source IN ('gps', 'map', 'address')),
  location_accuracy_m REAL CHECK (location_accuracy_m IS NULL OR location_accuracy_m >= 0),
  agency_id           INT REFERENCES agencies (id) ON DELETE SET NULL,
  duplicate_of_id     INT REFERENCES reports (id) ON DELETE SET NULL,
  rejection_reason    TEXT,
  work_completed_at   TIMESTAMPTZ,
  verified_at         TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  is_demo             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reports_description_len CHECK (char_length(description) BETWEEN 10 AND 2000),
  CONSTRAINT reports_road_len CHECK (char_length(road_name) BETWEEN 2 AND 150),
  CONSTRAINT reports_duplicate_needs_original CHECK (status <> 'duplicate' OR duplicate_of_id IS NOT NULL),
  CONSTRAINT reports_not_duplicate_of_self CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id),
  CONSTRAINT reports_rejection_needs_reason CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  CONSTRAINT reports_resolved_has_time CHECK (status <> 'resolved' OR resolved_at IS NOT NULL),
  CONSTRAINT reports_completion_only_in_progress CHECK (work_completed_at IS NULL OR status IN ('in_progress', 'resolved'))
);
CREATE INDEX reports_status_idx ON reports (status);
CREATE INDEX reports_reporter_idx ON reports (reporter_id, created_at DESC);
CREATE INDEX reports_created_idx ON reports (created_at DESC);
CREATE INDEX reports_latlng_idx ON reports (latitude, longitude);
CREATE INDEX reports_severity_idx ON reports (severity);
CREATE INDEX reports_barangay_idx ON reports (lower(barangay));

-- Great-circle distance in metres (haversine). Used for duplicate detection.
CREATE FUNCTION wg_distance_m(lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION,
                              lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT 6371008.8 * 2 * asin(least(1.0, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$$;

-- ---------------------------------------------------------------------------
-- Assignments, repair documentation and photos
-- ---------------------------------------------------------------------------
CREATE TABLE assignments (
  id           SERIAL PRIMARY KEY,
  report_id    INT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  team_id      INT NOT NULL REFERENCES maintenance_teams (id) ON DELETE RESTRICT,
  assigned_by  INT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  instructions TEXT,
  due_date     DATE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  end_reason   TEXT CHECK (end_reason IS NULL OR end_reason IN ('reassigned', 'unassigned', 'completed')),
  CONSTRAINT assignments_end_consistent CHECK ((is_active AND ended_at IS NULL) OR (NOT is_active AND ended_at IS NOT NULL))
);
-- A report can have at most one active assignment.
CREATE UNIQUE INDEX assignments_one_active_uq ON assignments (report_id) WHERE is_active;
CREATE INDEX assignments_team_idx ON assignments (team_id, is_active);

CREATE TABLE repair_updates (
  id            SERIAL PRIMARY KEY,
  report_id     INT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  assignment_id INT REFERENCES assignments (id) ON DELETE SET NULL,
  author_id     INT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  update_type   TEXT NOT NULL CHECK (update_type IN ('progress', 'completion')),
  note          TEXT NOT NULL CHECK (char_length(note) BETWEEN 3 AND 2000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX repair_updates_report_idx ON repair_updates (report_id, created_at);

-- Photo files live on disk (UPLOAD_DIR) under a random key; this table holds
-- the metadata and is what access control is checked against.
CREATE TABLE report_photos (
  id               SERIAL PRIMARY KEY,
  report_id        INT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  uploaded_by      INT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  kind             TEXT NOT NULL CHECK (kind IN ('report', 'before', 'progress', 'after')),
  repair_update_id INT REFERENCES repair_updates (id) ON DELETE SET NULL,
  storage_key      TEXT NOT NULL UNIQUE,
  mime_type        TEXT NOT NULL,
  width            INT,
  height           INT,
  size_bytes       INT NOT NULL CHECK (size_bytes > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX report_photos_report_idx ON report_photos (report_id, kind);

-- ---------------------------------------------------------------------------
-- History, notifications, feedback
-- ---------------------------------------------------------------------------
CREATE TABLE report_events (
  id          BIGSERIAL PRIMARY KEY,
  report_id   INT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  actor_id    INT REFERENCES users (id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  message     TEXT,
  is_public   BOOLEAN NOT NULL DEFAULT TRUE,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX report_events_report_idx ON report_events (report_id, created_at);

CREATE TABLE notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  report_id  INT REFERENCES reports (id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  read_at    TIMESTAMPTZ,
  -- Transactional outbox for optional e-mail delivery
  email_status TEXT NOT NULL DEFAULT 'skipped' CHECK (email_status IN ('pending', 'sent', 'failed', 'skipped')),
  email_attempts SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_email_pending_idx ON notifications (created_at) WHERE email_status = 'pending';

CREATE TABLE feedback (
  id         SERIAL PRIMARY KEY,
  report_id  INT NOT NULL UNIQUE REFERENCES reports (id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT CHECK (comment IS NULL OR char_length(comment) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- System settings, audit trail, geocoder cache
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    INT REFERENCES users (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- Cached geocoder responses (the Nominatim usage policy requires caching).
CREATE TABLE geocode_cache (
  query_key  TEXT PRIMARY KEY,
  response   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default settings (editable by administrators)
INSERT INTO settings (key, value) VALUES
  ('lgu_name', '"Local Government Unit"'),
  ('duplicate_radius_m', '30'),
  ('duplicate_window_days', '90'),
  ('max_photos_per_report', '5'),
  ('map_center', '{"lat": 14.8433, "lng": 120.8114, "zoom": 14}'),
  ('road_type_agency', '{}'),
  ('public_resolved_days', '90');
