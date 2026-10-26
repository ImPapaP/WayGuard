// Report status workflow. Every status change goes through this module, which
// enforces the allowed transitions and who may perform them, writes the
// history entry and notifies the people involved — all in one transaction.
//
//   submitted ──► under_review ──► verified ──► assigned ──► in_progress ──► resolved
//       │              │              │            │  ▲            │
//       ├──────────────┴──────────────┴──► rejected / duplicate     └─ completion submitted by crew,
//       │                                       │                     approved (resolved) or returned
//       └───────────────────────────────────────┴─ reopen ──► under_review
import { isLguManager, isAdministrator } from '../middleware/auth.js';
import { sql } from '../db/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/http.js';
import {
  notifyUsers,
  adminIds,
  teamMemberIds,
  reporterStatusMessage,
  STATUS_LABELS,
} from './notifications.js';
import { recordEvent, loadReportRow, teamHasAssignment } from './reports.js';

// Allowed status transitions and the roles that may perform each one.
export const TRANSITIONS = {
  submitted: { under_review: ['admin', 'staff'], rejected: ['admin', 'staff'], duplicate: ['admin', 'staff'] },
  under_review: { verified: ['admin', 'staff'], rejected: ['admin', 'staff'], duplicate: ['admin', 'staff'] },
  verified: { assigned: ['admin', 'staff'], rejected: ['admin', 'staff'], duplicate: ['admin', 'staff'], under_review: ['admin', 'staff'] },
  assigned: { in_progress: ['maintenance', 'admin'], verified: ['admin', 'staff'] },
  in_progress: { resolved: ['admin', 'staff'] },
  resolved: {},
  rejected: { under_review: ['admin', 'staff'] },
  duplicate: { under_review: ['admin', 'staff'] },
};

export function canTransition(from, to, role) {
  const allowed = TRANSITIONS[from] && TRANSITIONS[from][to];
  if (!allowed) return false;
  // The platform administrator may do whatever an LGU administrator may do.
  return allowed.includes(role) || (role === 'platform_admin' && allowed.includes('admin'));
}

function assertTransition(report, to, user) {
  if (!canTransition(report.status, to, user.role)) {
    throw new HttpError(
      409,
      `A report that is "${STATUS_LABELS[report.status]}" cannot be moved to "${STATUS_LABELS[to]}".`,
      { from: report.status, to },
      'invalid_transition',
    );
  }
}

async function setStatus(tx, report, to, user, { message = null, publicMessage = null, extra = {}, meta = {} }) {
  const sets = { status: to, ...extra };
  await tx`UPDATE reports SET ${tx(sets)}, updated_at = now() WHERE id = ${report.id}`;
  await recordEvent(tx, {
    reportId: report.id,
    actorId: user.id,
    type: 'status_changed',
    from: report.status,
    to,
    message: publicMessage,
    isPublic: true,
    meta,
  });
  if (message) {
    await recordEvent(tx, { reportId: report.id, actorId: user.id, type: 'internal_note', message, isPublic: false });
  }
  const note = reporterStatusMessage(report.code, to, publicMessage || '');
  await notifyUsers(tx, { userIds: [report.reporter_id], reportId: report.id, type: 'status_changed', ...note });
}

function withReport(reportId, fn) {
  return sql.begin(async (tx) => {
    const report = await loadReportRow(tx, reportId, { lock: true });
    return fn(tx, report);
  });
}

// ---------------------------------------------------------------------------
// Administrator actions
// ---------------------------------------------------------------------------
export function startReview(reportId, user, { note } = {}) {
  return withReport(reportId, async (tx, report) => {
    assertTransition(report, 'under_review', user);
    if (report.status !== 'submitted' && !note) {
      throw badRequest('Add a note explaining why this report is being reopened.');
    }
    const reopening = report.status !== 'submitted';
    await setStatus(tx, report, 'under_review', user, {
      message: note || null,
      publicMessage: reopening ? 'The report was reopened for another review.' : null,
      extra: reopening ? { rejection_reason: null, duplicate_of_id: null, verified_at: null } : {},
    });
    return { status: 'under_review' };
  });
}

export function verifyReport(reportId, user, { severity, agencyId, note }) {
  return withReport(reportId, async (tx, report) => {
    assertTransition(report, 'verified', user);
    const extra = { verified_at: new Date() };
    if (severity && severity !== report.severity) {
      extra.severity = severity;
      await recordEvent(tx, {
        reportId: report.id,
        actorId: user.id,
        type: 'severity_changed',
        message: `Severity changed from ${report.severity} to ${severity} after review.`,
        isPublic: true,
        meta: { from: report.severity, to: severity },
      });
    }
    if (agencyId !== undefined && agencyId !== report.agency_id) {
      if (agencyId !== null) {
        const [a] = await tx`SELECT id, name FROM agencies WHERE id = ${agencyId} AND lgu_id = ${report.lgu_id} AND is_active`;
        if (!a) throw badRequest('Choose an active responsible agency.');
        await recordEvent(tx, {
          reportId: report.id,
          actorId: user.id,
          type: 'agency_set',
          message: `Responsible agency: ${a.name}.`,
          isPublic: true,
          meta: { agency_id: a.id },
        });
      }
      extra.agency_id = agencyId;
    }
    await setStatus(tx, report, 'verified', user, { message: note || null, extra });
    return { status: 'verified' };
  });
}

export function rejectReport(reportId, user, { reason }) {
  return withReport(reportId, async (tx, report) => {
    assertTransition(report, 'rejected', user);
    await setStatus(tx, report, 'rejected', user, {
      publicMessage: `Reason: ${reason}`,
      extra: { rejection_reason: reason },
    });
    return { status: 'rejected' };
  });
}

export function markDuplicate(reportId, user, { duplicateOfId, note }) {
  return withReport(reportId, async (tx, report) => {
    assertTransition(report, 'duplicate', user);
    if (duplicateOfId === report.id) throw badRequest('A report cannot be a duplicate of itself.');
    const [original] = await tx`SELECT id, code, status, duplicate_of_id FROM reports WHERE id = ${duplicateOfId} AND lgu_id = ${report.lgu_id}`;
    if (!original) throw badRequest('The original report was not found.');
    if (['duplicate', 'rejected'].includes(original.status)) {
      throw badRequest(`${original.code} is itself ${STATUS_LABELS[original.status].toLowerCase()}; choose the report that is being tracked.`);
    }
    await setStatus(tx, report, 'duplicate', user, {
      message: note || null,
      publicMessage: `It will be tracked under report ${original.code}.`,
      extra: { duplicate_of_id: original.id },
      meta: { duplicate_of: original.code },
    });
    await recordEvent(tx, {
      reportId: original.id,
      actorId: user.id,
      type: 'duplicate_linked',
      message: `${report.code} was linked to this report as a duplicate.`,
      isPublic: false,
      meta: { duplicate: report.code },
    });
    return { status: 'duplicate', duplicate_of: original };
  });
}

export function assignReport(reportId, user, { teamId, instructions, dueDate }) {
  return withReport(reportId, async (tx, report) => {
    const [team] = await tx`SELECT id, name FROM maintenance_teams WHERE id = ${teamId} AND lgu_id = ${report.lgu_id} AND is_active`;
    if (!team) throw badRequest('Choose an active maintenance team.');
    const [current] = await tx`SELECT id, team_id FROM assignments WHERE report_id = ${report.id} AND is_active`;
    const reassigning = Boolean(current);

    if (reassigning) {
      if (!['assigned', 'in_progress'].includes(report.status)) {
        throw new HttpError(409, 'Only active work can be reassigned.', undefined, 'invalid_transition');
      }
      if (current.team_id === team.id) throw conflict(`This report is already assigned to ${team.name}.`);
      await tx`UPDATE assignments SET is_active = FALSE, ended_at = now(), end_reason = 'reassigned' WHERE id = ${current.id}`;
      const oldMembers = await teamMemberIds(tx, current.team_id);
      await notifyUsers(tx, {
        userIds: oldMembers,
        reportId: report.id,
        type: 'assignment_removed',
        title: `${report.code}: reassigned`,
        body: 'This task was reassigned to another team. No further work is needed from your team.',
      });
    } else {
      assertTransition(report, 'assigned', user);
    }

    await tx`
      INSERT INTO assignments (lgu_id, report_id, team_id, assigned_by, instructions, due_date)
      VALUES (${report.lgu_id}, ${report.id}, ${team.id}, ${user.id}, ${instructions || null}, ${dueDate || null})`;

    if (reassigning) {
      // Work restarts with the new team; any pending completion is cleared.
      await tx`UPDATE reports SET status = 'assigned', work_completed_at = NULL, updated_at = now() WHERE id = ${report.id}`;
      await recordEvent(tx, {
        reportId: report.id,
        actorId: user.id,
        type: 'reassigned',
        from: report.status,
        to: 'assigned',
        message: `Reassigned to ${team.name}.`,
        isPublic: true,
        meta: { team_id: team.id },
      });
    } else {
      await setStatus(tx, report, 'assigned', user, {
        publicMessage: `Assigned to ${team.name}.`,
        meta: { team_id: team.id },
      });
    }

    await notifyUsers(tx, {
      userIds: await teamMemberIds(tx, team.id),
      reportId: report.id,
      type: 'task_assigned',
      title: `New repair task ${report.code}`,
      body: `${report.severity[0].toUpperCase()}${report.severity.slice(1)} severity pothole on ${report.road_name}${
        dueDate ? `, due ${dueDate}` : ''
      }.`,
    });
    return { status: 'assigned', team };
  });
}

export function unassignReport(reportId, user, { note }) {
  return withReport(reportId, async (tx, report) => {
    assertTransition(report, 'verified', user);
    const [current] = await tx`SELECT id, team_id FROM assignments WHERE report_id = ${report.id} AND is_active`;
    if (current) {
      await tx`UPDATE assignments SET is_active = FALSE, ended_at = now(), end_reason = 'unassigned' WHERE id = ${current.id}`;
      await notifyUsers(tx, {
        userIds: await teamMemberIds(tx, current.team_id),
        reportId: report.id,
        type: 'assignment_removed',
        title: `${report.code}: unassigned`,
        body: 'This task was removed from your team.',
      });
    }
    await setStatus(tx, report, 'verified', user, {
      message: note || null,
      publicMessage: 'The repair is being rescheduled.',
    });
    return { status: 'verified' };
  });
}

export function approveCompletion(reportId, user, { note }) {
  return withReport(reportId, async (tx, report) => {
    assertTransition(report, 'resolved', user);
    if (!report.work_completed_at) {
      throw new HttpError(409, 'The maintenance team has not submitted this repair as completed yet.', undefined, 'not_completed');
    }
    const [afterPhoto] = await tx`SELECT 1 FROM report_photos WHERE report_id = ${report.id} AND kind = 'after' LIMIT 1`;
    if (!afterPhoto) throw new HttpError(409, 'A completion photo is required before closing the report.');
    const [active] = await tx`SELECT id, team_id FROM assignments WHERE report_id = ${report.id} AND is_active`;
    if (active) {
      await tx`UPDATE assignments SET is_active = FALSE, ended_at = now(), end_reason = 'completed' WHERE id = ${active.id}`;
      await notifyUsers(tx, {
        userIds: await teamMemberIds(tx, active.team_id),
        reportId: report.id,
        type: 'completion_approved',
        title: `${report.code}: repair approved`,
        body: 'The LGU verified your completed repair and closed the report.',
      });
    }
    await setStatus(tx, report, 'resolved', user, {
      message: note || null,
      publicMessage: 'Repair verified by the LGU.',
      extra: { resolved_at: new Date() },
    });
    return { status: 'resolved' };
  });
}

export function returnCompletion(reportId, user, { reason }) {
  return withReport(reportId, async (tx, report) => {
    if (!isLguManager(user)) throw forbidden();
    if (report.status !== 'in_progress' || !report.work_completed_at) {
      throw new HttpError(409, 'There is no completed repair waiting for verification.', undefined, 'not_completed');
    }
    await tx`UPDATE reports SET work_completed_at = NULL, updated_at = now() WHERE id = ${report.id}`;
    await recordEvent(tx, {
      reportId: report.id,
      actorId: user.id,
      type: 'completion_returned',
      message: reason,
      isPublic: false,
    });
    const [active] = await tx`SELECT team_id FROM assignments WHERE report_id = ${report.id} AND is_active`;
    await notifyUsers(tx, {
      userIds: active ? await teamMemberIds(tx, active.team_id) : [],
      reportId: report.id,
      type: 'completion_returned',
      title: `${report.code}: more work needed`,
      body: reason,
    });
    return { status: 'in_progress' };
  });
}

// ---------------------------------------------------------------------------
// Maintenance actions
// ---------------------------------------------------------------------------
async function assertCrewCanWork(tx, report, user) {
  if (isAdministrator(user)) return;
  if (user.role !== 'maintenance') throw forbidden();
  if (!(await teamHasAssignment(tx, report.id, user.team_id, { activeOnly: true }))) {
    throw notFound('This task is not assigned to your team.');
  }
}

export function startWork(reportId, user, { note } = {}) {
  return withReport(reportId, async (tx, report) => {
    await assertCrewCanWork(tx, report, user);
    assertTransition(report, 'in_progress', user);
    await setStatus(tx, report, 'in_progress', user, { message: note || null });
    return { status: 'in_progress' };
  });
}

// Adds a repair update. A progress update on an "assigned" report also marks
// the work as started. A completion update requires at least one "after"
// photo and puts the report into the administrator's verification queue.
export function addRepairUpdate(reportId, user, { type, note, photos }) {
  return withReport(reportId, async (tx, report) => {
    await assertCrewCanWork(tx, report, user);
    if (!['assigned', 'in_progress'].includes(report.status)) {
      throw new HttpError(409, 'Repair updates can only be added to active work.', undefined, 'invalid_transition');
    }
    if (report.work_completed_at && type !== 'progress') {
      throw conflict('This repair is already waiting for LGU verification.');
    }
    if (report.status === 'assigned') {
      assertTransition(report, 'in_progress', user);
      await setStatus(tx, report, 'in_progress', user, {});
      report = { ...report, status: 'in_progress' };
    }
    const [active] = await tx`SELECT id FROM assignments WHERE report_id = ${report.id} AND is_active`;
    const [update] = await tx`
      INSERT INTO repair_updates (report_id, assignment_id, author_id, update_type, note)
      VALUES (${report.id}, ${active ? active.id : null}, ${user.id}, ${type}, ${note})
      RETURNING id, created_at`;
    for (const p of photos) {
      await tx`
        INSERT INTO report_photos (report_id, uploaded_by, kind, repair_update_id, storage_key, mime_type, width, height, size_bytes)
        VALUES (${report.id}, ${user.id}, ${p.kind}, ${update.id}, ${p.storage_key}, ${p.mime_type}, ${p.width}, ${p.height}, ${p.size_bytes})`;
    }
    if (type === 'completion') {
      await tx`UPDATE reports SET work_completed_at = now(), updated_at = now() WHERE id = ${report.id}`;
      await recordEvent(tx, {
        reportId: report.id,
        actorId: user.id,
        type: 'repair_completed',
        message: 'Repair work was reported as completed and is awaiting LGU verification.',
        isPublic: true,
        meta: { repair_update_id: update.id },
      });
      await notifyUsers(tx, {
        userIds: await adminIds(tx, report.lgu_id),
        reportId: report.id,
        type: 'completion_submitted',
        title: `${report.code}: repair ready for verification`,
        body: `Completion submitted for ${report.road_name}. Review the after photos and close the report.`,
      });
    } else {
      await tx`UPDATE reports SET updated_at = now() WHERE id = ${report.id}`;
      await recordEvent(tx, {
        reportId: report.id,
        actorId: user.id,
        type: 'repair_progress',
        message: note,
        isPublic: false,
        meta: { repair_update_id: update.id, photos: photos.length },
      });
    }
    return { update_id: update.id, status: report.status };
  });
}
