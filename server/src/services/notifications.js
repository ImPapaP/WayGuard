// In-app notifications (always on) with an optional e-mail outbox.
// Rows are written inside the same transaction as the change that caused
// them; the mailer (services/mailer.js) later sends rows marked 'pending'.
import { sql } from '../db/index.js';
import { config } from '../config.js';

export const STATUS_LABELS = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  verified: 'Verified',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  rejected: 'Rejected',
  duplicate: 'Duplicate',
};

const emailEnabled = () => Boolean(config.smtp.host);

// Insert one notification per recipient. `userIds` may contain duplicates or
// nulls; they are removed. Recipients who are inactive are skipped.
export async function notifyUsers(db, { userIds, reportId = null, type, title, body }) {
  const ids = [...new Set((userIds || []).filter((x) => Number.isInteger(x)))];
  if (!ids.length) return 0;
  const sendEmail = emailEnabled();
  const rows = await (db || sql)`
    INSERT INTO notifications (user_id, report_id, type, title, body, email_status)
    SELECT u.id, ${reportId}, ${type}, ${title}, ${body},
           CASE WHEN ${sendEmail} AND u.email_notifications THEN 'pending' ELSE 'skipped' END
    FROM users u
    WHERE u.id = ANY(${ids}::int[]) AND u.is_active
    RETURNING id`;
  return rows.length;
}

export async function adminIds(db, lguId = null) {
  const rows = await (db || sql)`
    SELECT id FROM users
    WHERE role IN ('admin', 'staff') AND is_active
      AND (${lguId}::int IS NULL OR lgu_id = ${lguId})`;
  return rows.map((r) => r.id);
}

export async function teamMemberIds(db, teamId) {
  if (!teamId) return [];
  const rows = await (db || sql)`
    SELECT id FROM users WHERE role = 'maintenance' AND team_id = ${teamId} AND is_active`;
  return rows.map((r) => r.id);
}

// Message shown to the reporter when their report changes status.
export function reporterStatusMessage(code, status, extra = '') {
  const label = STATUS_LABELS[status] || status;
  const messages = {
    under_review: 'An LGU administrator is now reviewing your report.',
    verified: 'Your report was verified. It will be scheduled for repair.',
    assigned: 'A maintenance team has been assigned to your report.',
    in_progress: 'Repair work has started on the reported pothole.',
    resolved: 'The repair was completed and verified. Tell us how it went!',
    rejected: 'Your report could not be accepted.',
    duplicate: 'Your report matches an existing report, which will be tracked instead.',
  };
  return {
    title: `${code}: ${label}`,
    body: [messages[status] || `Status changed to ${label}.`, extra].filter(Boolean).join(' '),
  };
}
