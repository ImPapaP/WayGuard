-- One-time password reset links sent by e-mail. Only a SHA-256 hash of each
-- token is stored, so a database leak cannot be used to reset passwords.
CREATE TABLE password_reset_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  requested_ip TEXT
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);
