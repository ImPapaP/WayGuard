-- Optional photo storage inside PostgreSQL (PHOTO_STORAGE=database), for
-- hosting where the server's own disk is wiped on restart (e.g. Render free).
CREATE TABLE IF NOT EXISTS photo_files (
  file_key    TEXT PRIMARY KEY,           -- "<storage_key>.jpg" or "<storage_key>_thumb.jpg"
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
