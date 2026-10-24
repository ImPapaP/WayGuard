// Background worker that e-mails notifications marked 'pending' (only when
// SMTP is configured). In-app notifications work without it.
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { sendMail } from './smtp.js';

const MAX_ATTEMPTS = 3;

export async function deliverPendingEmails({ limit = 20, send = sendMail } = {}) {
  const smtp = config.smtp;
  if (!smtp.host) return { sent: 0, failed: 0 };
  // Designed for a single server process (the worker runs in-process).
  const rows = await sql`
    SELECT n.id, n.title, n.body, n.report_id, n.email_attempts, u.email, u.full_name
    FROM notifications n JOIN users u ON u.id = n.user_id
    WHERE n.email_status = 'pending' AND n.created_at > now() - interval '2 days'
    ORDER BY n.created_at
    LIMIT ${limit}`.catch(() => []);
  let sent = 0;
  let failed = 0;
  for (const n of rows) {
    const link = n.report_id ? `\n\nView the report: ${config.publicBaseUrl}/r/${n.report_id}` : '';
    try {
      await send({
        ...smtp,
        to: `${n.full_name} <${n.email}>`,
        subject: `[Wayguard] ${n.title}`,
        text: `Hello ${n.full_name},\n\n${n.body}${link}\n\nYou can turn off e-mail updates in your Wayguard profile.\n— Wayguard`,
      });
      await sql`UPDATE notifications SET email_status = 'sent', email_attempts = email_attempts + 1 WHERE id = ${n.id}`;
      sent += 1;
    } catch (err) {
      const attempts = n.email_attempts + 1;
      await sql`
        UPDATE notifications
        SET email_attempts = ${attempts}, email_status = ${attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'}
        WHERE id = ${n.id}`;
      failed += 1;
      if (!config.isTest) console.warn(`[mailer] notification ${n.id}: ${err.message}`);
    }
  }
  return { sent, failed };
}

export function startMailer() {
  if (!config.smtp.host) return () => {};
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await deliverPendingEmails();
    } finally {
      running = false;
    }
  }, 15_000);
  timer.unref();
  console.log(`E-mail notifications enabled via ${config.smtp.host}:${config.smtp.port}`);
  return () => clearInterval(timer);
}
