import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDatabase,
  startServer,
  shutdown,
  createUser,
  login,
  createTeam,
  createAgency,
  submitReport,
  jpeg,
  getSql,
} from './helpers.js';
import { canTransition, TRANSITIONS } from '../src/services/workflow.js';

let server;
let citizen;
let admin;
let crewA;
let crewB;
let teamA;
let teamB;
let agency;
let reportId;

async function repairForm(note, { photos = 1, kind } = {}) {
  const form = new FormData();
  form.append('note', note);
  if (kind) form.append('photo_kind', kind);
  for (let i = 0; i < photos; i += 1) {
    form.append('photos', new Blob([await jpeg({ color: '#334455' })], { type: 'image/jpeg' }), `r${i}.jpg`);
  }
  return form;
}

async function status(id) {
  const [r] = await getSql()`SELECT status, work_completed_at FROM reports WHERE id = ${id}`;
  return r;
}

before(async () => {
  await resetDatabase();
  server = await startServer();
  teamA = await createTeam('Road Crew Alpha');
  teamB = await createTeam('Road Crew Bravo');
  agency = await createAgency('City Engineering Office');
  citizen = await login(server.base, await createUser());
  admin = await login(server.base, await createUser({ role: 'admin' }));
  crewA = await login(server.base, await createUser({ role: 'maintenance', teamId: teamA.id }));
  crewB = await login(server.base, await createUser({ role: 'maintenance', teamId: teamB.id }));
  const res = await submitReport(citizen, { severity: 'medium' });
  assert.equal(res.status, 201);
  reportId = res.data.report.id;
});
after(() => shutdown(server));

test('transition table matches the documented workflow', () => {
  assert.equal(canTransition('submitted', 'verified', 'admin'), false, 'must be reviewed first');
  assert.equal(canTransition('submitted', 'under_review', 'citizen'), false);
  assert.equal(canTransition('assigned', 'in_progress', 'maintenance'), true);
  assert.equal(canTransition('in_progress', 'resolved', 'maintenance'), false, 'only the LGU closes reports');
  assert.deepEqual(Object.keys(TRANSITIONS.resolved), []);
});

test('reports cannot skip review or be assigned before verification', async () => {
  const verify = await admin.post(`/api/admin/reports/${reportId}/verify`, {});
  assert.equal(verify.status, 409);
  assert.equal(verify.data.error.code, 'invalid_transition');
  const assign = await admin.post(`/api/admin/reports/${reportId}/assign`, { team_id: teamA.id });
  assert.equal(assign.status, 409);
  const citizenTry = await citizen.post(`/api/admin/reports/${reportId}/review`, {});
  assert.equal(citizenTry.status, 403);
});

test('admin reviews and verifies, adjusting severity and responsible agency', async () => {
  assert.equal((await admin.post(`/api/admin/reports/${reportId}/review`, {})).status, 200);
  assert.equal((await status(reportId)).status, 'under_review');
  const res = await admin.post(`/api/admin/reports/${reportId}/verify`, {
    severity: 'high',
    agency_id: agency.id,
    note: 'Checked photo; deeper than reported.',
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const [r] = await getSql()`SELECT status, severity, reported_severity, agency_id, verified_at FROM reports WHERE id = ${reportId}`;
  assert.equal(r.status, 'verified');
  assert.equal(r.severity, 'high');
  assert.equal(r.reported_severity, 'medium');
  assert.equal(r.agency_id, agency.id);
  assert.ok(r.verified_at);
});

test('maintenance crews cannot see unassigned work', async () => {
  assert.equal((await crewA.get(`/api/reports/${reportId}`)).status, 404);
  const tasks = await crewA.get('/api/maintenance/tasks');
  assert.equal(tasks.data.items.length, 0);
});

test('admin assigns a verified report to a team; only that team can act on it', async () => {
  const res = await admin.post(`/api/admin/reports/${reportId}/assign`, {
    team_id: teamA.id,
    instructions: 'Cold patch first, schedule full repair.',
    due_date: '2026-11-15',
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal((await status(reportId)).status, 'assigned');
  const tasks = await crewA.get('/api/maintenance/tasks');
  assert.equal(tasks.data.items.length, 1);
  assert.equal(tasks.data.items[0].instructions, 'Cold patch first, schedule full repair.');
  assert.equal((await crewA.get(`/api/reports/${reportId}`)).status, 200);
  assert.equal((await crewB.get(`/api/reports/${reportId}`)).status, 404);
  assert.equal((await crewB.post(`/api/maintenance/tasks/${reportId}/start`, {})).status, 404);
  const [n] = await getSql()`
    SELECT count(*)::int AS n FROM notifications n JOIN users u ON u.id = n.user_id
    WHERE u.team_id = ${teamA.id} AND n.type = 'task_assigned'`;
  assert.equal(n.n, 1, 'team members are notified');
});

test('crew posts a progress update with before photos, which starts the work', async () => {
  const res = await crewA.postForm(`/api/maintenance/tasks/${reportId}/updates`, await repairForm('Site inspected, barriers placed.', { kind: 'before', photos: 2 }));
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal((await status(reportId)).status, 'in_progress');
  const [p] = await getSql()`SELECT count(*)::int AS n FROM report_photos WHERE report_id = ${reportId} AND kind = 'before'`;
  assert.equal(p.n, 2);
});

test('completion requires an after photo and cannot be approved by the crew', async () => {
  const noPhoto = await crewA.postForm(`/api/maintenance/tasks/${reportId}/complete`, await repairForm('Done.', { photos: 0 }));
  assert.equal(noPhoto.status, 400);
  const early = await admin.post(`/api/admin/reports/${reportId}/approve-completion`, {});
  assert.equal(early.status, 409, 'cannot close before the crew reports completion');
  const done = await crewA.postForm(`/api/maintenance/tasks/${reportId}/complete`, await repairForm('Patched with asphalt, 1.2 m x 0.8 m.'));
  assert.equal(done.status, 201, JSON.stringify(done.data));
  const r = await status(reportId);
  assert.equal(r.status, 'in_progress');
  assert.ok(r.work_completed_at, 'awaiting LGU verification');
  const again = await crewA.postForm(`/api/maintenance/tasks/${reportId}/complete`, await repairForm('Again'));
  assert.equal(again.status, 409);
  const crewApprove = await crewA.post(`/api/admin/reports/${reportId}/approve-completion`, {});
  assert.equal(crewApprove.status, 403);
  const queue = await admin.get('/api/admin/reports?awaiting_completion=true');
  assert.equal(queue.data.total, 1);
});

test('admin can return the repair for more work, then approve and resolve it', async () => {
  const ret = await admin.post(`/api/admin/reports/${reportId}/return-completion`, { reason: 'Edges not sealed; please redo.' });
  assert.equal(ret.status, 200);
  assert.equal((await status(reportId)).work_completed_at, null);
  const redo = await crewA.postForm(`/api/maintenance/tasks/${reportId}/complete`, await repairForm('Edges sealed.'));
  assert.equal(redo.status, 201);
  const ok = await admin.post(`/api/admin/reports/${reportId}/approve-completion`, { note: 'Inspected on site.' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const [r] = await getSql()`SELECT status, resolved_at FROM reports WHERE id = ${reportId}`;
  assert.equal(r.status, 'resolved');
  assert.ok(r.resolved_at);
  const tasks = await crewA.get('/api/maintenance/tasks');
  assert.equal(tasks.data.items.length, 0, 'closed work leaves the active list');
  const history = await crewA.get('/api/maintenance/tasks?scope=history');
  assert.equal(history.data.items[0].end_reason, 'completed');
});

test('the citizen sees a public timeline, after photos and status notifications', async () => {
  const res = await citizen.get(`/api/reports/${reportId}`);
  assert.equal(res.status, 200);
  const rep = res.data.report;
  assert.ok(rep.events.every((e) => e.is_public), 'no internal notes for citizens');
  assert.ok(!rep.events.some((e) => e.message && e.message.includes('Checked photo')), 'internal note hidden');
  assert.ok(rep.events.every((e) => e.actor_name === null), 'staff names hidden');
  const statuses = rep.events.filter((e) => e.event_type === 'status_changed').map((e) => e.to_status);
  assert.deepEqual(statuses, ['under_review', 'verified', 'assigned', 'in_progress', 'resolved']);
  assert.ok(rep.photos.some((p) => p.kind === 'after'));
  assert.equal(rep.repair_updates, undefined);
  assert.equal(rep.can_give_feedback, true);
  const notes = await citizen.get('/api/notifications');
  const titles = notes.data.items.map((n) => n.title);
  for (const label of ['Under Review', 'Verified', 'Assigned', 'In Progress', 'Resolved']) {
    assert.ok(titles.some((t) => t.endsWith(label)), `missing ${label} notification`);
  }
  assert.equal(notes.data.unread, notes.data.items.length);
  const first = notes.data.items[0];
  await citizen.post(`/api/notifications/${first.id}/read`, {});
  assert.equal((await citizen.get('/api/notifications/unread-count')).data.unread, notes.data.unread - 1);
  await citizen.post('/api/notifications/read-all', {});
  assert.equal((await citizen.get('/api/notifications/unread-count')).data.unread, 0);
});

test('staff see the full history including internal notes and repair updates', async () => {
  const res = await admin.get(`/api/reports/${reportId}`);
  const rep = res.data.report;
  assert.ok(rep.events.some((e) => !e.is_public && e.message === 'Checked photo; deeper than reported.'));
  assert.equal(rep.repair_updates.length, 3);
  assert.ok(rep.reporter.email);
  const crewView = await crewA.get(`/api/reports/${reportId}`);
  assert.equal(crewView.data.report.reporter, undefined, 'crew does not see reporter contact details');
});

test('reporter can leave feedback exactly once', async () => {
  const bad = await citizen.post(`/api/reports/${reportId}/feedback`, { rating: 9 });
  assert.equal(bad.status, 400);
  const ok = await citizen.post(`/api/reports/${reportId}/feedback`, { rating: 4, comment: 'Fixed quickly, thanks!' });
  assert.equal(ok.status, 201);
  const twice = await citizen.post(`/api/reports/${reportId}/feedback`, { rating: 5 });
  assert.equal(twice.status, 409);
  const detail = await citizen.get(`/api/reports/${reportId}`);
  assert.equal(detail.data.report.feedback.rating, 4);
  assert.equal(detail.data.report.can_give_feedback, false);
});

test('resolved reports are final', async () => {
  for (const action of ['review', 'verify', 'reject']) {
    const res = await admin.post(`/api/admin/reports/${reportId}/${action}`, { reason: 'Testing invalid move' });
    assert.equal(res.status, 409, action);
  }
  const edit = await admin.patch(`/api/admin/reports/${reportId}`, { severity: 'low' });
  assert.equal(edit.status, 409);
});

test('rejection needs a reason; duplicates link to an original; both can be reopened', async () => {
  const r1 = (await submitReport(citizen, { latitude: '14.8501', longitude: '120.8201' })).data.report.id;
  const r2 = (await submitReport(citizen, { latitude: '14.8601', longitude: '120.8301' })).data.report.id;
  const noReason = await admin.post(`/api/admin/reports/${r1}/reject`, {});
  assert.equal(noReason.status, 400);
  const rej = await admin.post(`/api/admin/reports/${r1}/reject`, { reason: 'Private subdivision road, outside LGU jurisdiction.' });
  assert.equal(rej.status, 200);
  const view = await citizen.get(`/api/reports/${r1}`);
  assert.equal(view.data.report.rejection_reason, 'Private subdivision road, outside LGU jurisdiction.');

  const self = await admin.post(`/api/admin/reports/${r2}/duplicate`, { duplicate_of_id: r2 });
  assert.equal(self.status, 400);
  const toRejected = await admin.post(`/api/admin/reports/${r2}/duplicate`, { duplicate_of_id: r1 });
  assert.equal(toRejected.status, 400, 'cannot point at a rejected report');
  const dup = await admin.post(`/api/admin/reports/${r2}/duplicate`, { duplicate_of_id: reportId, note: 'Same spot' });
  assert.equal(dup.status, 200, JSON.stringify(dup.data));
  const dupView = await citizen.get(`/api/reports/${r2}`);
  assert.equal(dupView.data.report.duplicate_of.id, reportId);

  const noNote = await admin.post(`/api/admin/reports/${r1}/review`, {});
  assert.equal(noNote.status, 400, 'reopening needs a note');
  const reopen = await admin.post(`/api/admin/reports/${r1}/review`, { note: 'Barangay confirmed it is a public road.' });
  assert.equal(reopen.status, 200);
  const [row] = await getSql()`SELECT status, rejection_reason FROM reports WHERE id = ${r1}`;
  assert.deepEqual(row, { status: 'under_review', rejection_reason: null });
});

test('reassignment moves the task to the new team and resets progress', async () => {
  const id = (await submitReport(citizen, { latitude: '14.8701', longitude: '120.8401' })).data.report.id;
  await admin.post(`/api/admin/reports/${id}/review`, {});
  await admin.post(`/api/admin/reports/${id}/verify`, {});
  await admin.post(`/api/admin/reports/${id}/assign`, { team_id: teamA.id });
  await crewA.post(`/api/maintenance/tasks/${id}/start`, {});
  assert.equal((await status(id)).status, 'in_progress');
  const same = await admin.post(`/api/admin/reports/${id}/assign`, { team_id: teamA.id });
  assert.equal(same.status, 409);
  const re = await admin.post(`/api/admin/reports/${id}/assign`, { team_id: teamB.id });
  assert.equal(re.status, 200);
  assert.equal((await status(id)).status, 'assigned');
  assert.equal((await crewA.get(`/api/maintenance/tasks`)).data.items.length, 0);
  assert.equal((await crewB.get(`/api/maintenance/tasks`)).data.items.length, 1);
  assert.equal((await crewA.post(`/api/maintenance/tasks/${id}/start`, {})).status, 404);
  const un = await admin.post(`/api/admin/reports/${id}/unassign`, { note: 'Rescheduling' });
  assert.equal(un.status, 200);
  assert.equal((await status(id)).status, 'verified');
  const [{ n }] = await getSql()`SELECT count(*)::int AS n FROM assignments WHERE report_id = ${id} AND is_active`;
  assert.equal(n, 0);
});
