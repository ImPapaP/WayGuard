// Audit trail for administrative actions that are not tied to a single report
// (report actions are recorded in `report_events`).
import { sql } from '../db/index.js';

export async function audit(db, { actorId, action, targetType = null, targetId = null, details = {}, ip = null }) {
  await (db || sql)`
    INSERT INTO audit_logs (lgu_id, actor_id, action, target_type, target_id, details, ip)
    VALUES ((SELECT lgu_id FROM users WHERE id = ${actorId ?? null}), ${actorId ?? null}, ${action},
            ${targetType}, ${targetId === null ? null : String(targetId)},
            ${(db || sql).json(details)}, ${ip})`;
}
