-- "I saw this too": residents confirming an existing report instead of
-- filing a duplicate. One confirmation per person per report.
CREATE TABLE report_confirmations (
  report_id  INT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, user_id)
);
CREATE INDEX report_confirmations_user_idx ON report_confirmations (user_id);
