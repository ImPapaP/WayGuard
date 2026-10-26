import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
// helpers.js must load first: it switches to test mode (TEST_DATABASE_URL)
// before anything reads the configuration.
import {
  resetDatabase,
  startServer,
  shutdown,
  createUser,
  login,
  submitReport,
  getSql,
} from './helpers.js';
import { syncPsgcDirectory } from '../scripts/sync-psgc-directory.js';

let server;
let platform;
let defaultAdmin;
let defaultCitizen;

before(async () => {
  await resetDatabase();
  await syncPsgcDirectory({ db: getSql(), log: () => {} });
  server = await startServer();
  platform = await login(server.base, await createUser({ role: 'platform_admin' }));
  defaultAdmin = await login(server.base, await createUser({ role: 'admin' }));
  defaultCitizen = await login(server.base, await createUser({ role: 'citizen' }));
});

after(() => shutdown(server));

test('official PSGC directory sync creates the full hierarchy and is repeatable', async () => {
  const sql = getSql();
  const [counts] = await sql`
    SELECT count(*) FILTER (WHERE is_directory_node AND jurisdiction_level = 'island_group')::int AS island_groups,
           count(*) FILTER (WHERE is_directory_node AND jurisdiction_level = 'region')::int AS regions,
           count(*) FILTER (WHERE is_directory_node AND jurisdiction_level = 'province')::int AS provinces,
           count(*) FILTER (WHERE is_directory_node AND jurisdiction_level = 'independent_city')::int AS independent_cities,
           count(*) FILTER (WHERE is_directory_node AND jurisdiction_level = 'city')::int AS component_cities,
           count(*) FILTER (WHERE is_directory_node AND jurisdiction_level = 'municipality')::int AS municipalities,
           count(*) FILTER (WHERE is_directory_node AND jurisdiction_level = 'special_area')::int AS special_areas,
           count(*) FILTER (WHERE is_directory_node)::int AS directory_nodes
    FROM lgus`;
  assert.equal(counts.island_groups, 3);
  assert.equal(counts.regions, 18);
  assert.equal(counts.provinces, 82);
  assert.equal(counts.independent_cities, 38);
  assert.equal(counts.component_cities, 111);
  assert.equal(counts.municipalities, 1493);
  assert.equal(counts.special_areas, 2);
  assert.equal(counts.directory_nodes, 1747);

  const [bulacan] = await sql`
    SELECT child.psgc_code, child.jurisdiction_level, parent.name AS parent_name
    FROM lgus child JOIN lgus parent ON parent.id = child.parent_lgu_id
    WHERE child.name = 'Bulacan' AND child.is_directory_node`;
  assert.ok(bulacan, 'Bulacan should exist under a region in the PSGC directory');
  assert.equal(bulacan.psgc_code, '0301400000');
  assert.equal(bulacan.jurisdiction_level, 'province');
  assert.equal(bulacan.parent_name, 'Region III (Central Luzon)');

  const firstSync = await syncPsgcDirectory({ db: sql, log: () => {}, force: true });
  assert.equal(firstSync.inserted, 0, 'second sync should not insert duplicates');
  assert.equal(firstSync.matched, 1747);
  const restart = await syncPsgcDirectory({ db: sql, log: () => {} });
  assert.equal(restart.skipped, true, 'an unchanged directory is not reloaded on restart');
});

test('platform administrators can create an account at a selected PSGC area with descendant-only access', async () => {
  const sql = getSql();
  const [bulacan] = await sql`SELECT id FROM lgus WHERE psgc_code = '0301400000'`;
  const [malolos] = await sql`SELECT id FROM lgus WHERE name = 'City of Malolos' AND is_directory_node`;
  const [pampanga] = await sql`SELECT id FROM lgus WHERE psgc_code = '0305400000'`;
  assert.ok(bulacan && malolos && pampanga, 'the selected province and its localities should exist in PSGC');

  const created = await platform.post('/api/platform/accounts', {
    full_name: 'Bulacan Area Administrator',
    email: 'bulacan.area.admin@example.test',
    phone: null,
    lgu_id: bulacan.id,
    temporary_password: 'StartAdmin123',
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.account.role, 'admin');
  assert.equal(created.data.account.lgu_id, bulacan.id);
  assert.equal(created.data.account.must_change_password, true);
  assert.equal(created.data.jurisdiction.id, bulacan.id);

  const [assignment] = await sql`SELECT lgu_id FROM admin_jurisdiction_assignments WHERE user_id = ${created.data.account.id}`;
  assert.equal(assignment.lgu_id, bulacan.id);
  const history = await platform.get('/api/platform/accounts/' + created.data.account.id + '/jurisdiction-history');
  assert.equal(history.status, 200);
  assert.ok(history.data.items.some((item) => item.action === 'assigned' && item.lgu_id === bulacan.id));

  const areaAdmin = await login(server.base, { email: 'bulacan.area.admin@example.test', password: 'StartAdmin123' });
  const changed = await areaAdmin.post('/api/auth/change-password', {
    current_password: 'StartAdmin123', new_password: 'Welcome2026',
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  const scope = await areaAdmin.get('/api/admin/jurisdictions');
  assert.equal(scope.status, 200, JSON.stringify(scope.data));
  assert.ok(scope.data.items.some((item) => item.id === bulacan.id));
  assert.ok(scope.data.items.some((item) => item.id === malolos.id), 'province assignment includes descendant cities');
  assert.ok(!scope.data.items.some((item) => item.id === pampanga.id), 'province assignment excludes sibling provinces');
});

test('platform admins can deactivate, reactivate and set the boundary of one field at a time', async () => {
  const sql = getSql();
  const [tarlac] = await sql`SELECT id, parent_lgu_id FROM lgus WHERE psgc_code = '0306900000'`;
  assert.ok(tarlac, 'Tarlac province should exist in PSGC');

  const off = await platform.patch('/api/platform/lgus/' + tarlac.id, { is_active: false });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.lgu.is_active, false);
  assert.equal(off.data.lgu.parent_lgu_id, tarlac.parent_lgu_id, 'placement is unchanged');
  const on = await platform.patch('/api/platform/lgus/' + tarlac.id, { is_active: true });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  assert.equal(on.data.lgu.is_active, true);

  const polygon = { type: 'Polygon', coordinates: [[[120.5, 15.4], [120.7, 15.4], [120.7, 15.6], [120.5, 15.4]]] };
  const withBoundary = await platform.patch('/api/platform/lgus/' + tarlac.id, { jurisdiction_boundary: polygon });
  assert.equal(withBoundary.status, 200, JSON.stringify(withBoundary.data));
  assert.deepEqual(withBoundary.data.lgu.jurisdiction_boundary, polygon);
  const cleared = await platform.patch('/api/platform/lgus/' + tarlac.id, { jurisdiction_boundary: null });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  assert.equal(cleared.data.lgu.jurisdiction_boundary, null);
  assert.equal(cleared.data.lgu.parent_lgu_id, tarlac.parent_lgu_id);
});

test('platform admins provision an LGU and its first administrator', async () => {
  const blocked = await defaultAdmin.get('/api/platform/lgus');
  assert.equal(blocked.status, 403, 'an LGU admin cannot manage platform tenants');

  const island = await platform.post('/api/platform/lgus', {
    name: 'Luzon Test Group', slug: 'luzon-test-group', city: null, province: null,
    jurisdiction_level: 'island_group', parent_lgu_id: null,
    admin_name: 'Island Administrator', admin_email: 'island.admin@example.test',
    admin_phone: null, temporary_password: 'StartAdmin123',
  });
  assert.equal(island.status, 201, JSON.stringify(island.data));
  const region = await platform.post('/api/platform/lgus', {
    name: 'Central Luzon Test Region', slug: 'central-luzon-test-region', city: null, province: null,
    jurisdiction_level: 'region', parent_lgu_id: island.data.lgu.id,
    admin_name: 'Regional Administrator', admin_email: 'region.admin@example.test',
    admin_phone: null, temporary_password: 'StartAdmin123',
  });
  assert.equal(region.status, 201, JSON.stringify(region.data));
  const province = await platform.post('/api/platform/lgus', {
    name: 'Bulacan Test Province', slug: 'bulacan-test-province', city: null, province: null,
    jurisdiction_level: 'province', parent_lgu_id: region.data.lgu.id,
    admin_name: 'Provincial Administrator', admin_email: 'province.admin@example.test',
    admin_phone: null, temporary_password: 'StartAdmin123',
  });
  assert.equal(province.status, 201, JSON.stringify(province.data));

  const response = await platform.post('/api/platform/lgus', {
    name: 'City of Meycauayan',
    slug: 'meycauayan',
    city: 'Meycauayan',
    province: 'Bulacan',
    jurisdiction_level: 'city',
    parent_lgu_id: province.data.lgu.id,
    map_latitude: 14.7367,
    map_longitude: 120.9607,
    admin_name: 'Meycauayan Administrator',
    admin_email: 'meycauayan.admin@example.test',
    admin_phone: null,
    temporary_password: 'StartAdmin123',
  });

  assert.equal(response.status, 201, JSON.stringify(response.data));
  assert.equal(response.data.lgu.name, 'City of Meycauayan');
  assert.equal(response.data.admin.role, 'admin');
  assert.equal(response.data.admin.lgu_id, response.data.lgu.id);

  const [createdAdmin] = await getSql()`
    SELECT role, lgu_id, must_change_password
    FROM users WHERE id = ${response.data.admin.id}`;
  assert.equal(createdAdmin.role, 'admin');
  assert.equal(createdAdmin.lgu_id, response.data.lgu.id);
  assert.equal(createdAdmin.must_change_password, true);
});
test('admin report lists and private report details are isolated by LGU', async () => {
  const [lgu] = await getSql()`SELECT id FROM lgus WHERE slug = 'meycauayan'`;
  assert.ok(lgu, 'LGU created by the platform test exists');

  const tenantAdminUser = await createUser({ role: 'admin', lguId: lgu.id, name: 'Tenant Admin' });
  const tenantStaffUser = await createUser({ role: 'staff', lguId: lgu.id, name: 'Tenant Staff' });
  const tenantCitizenUser = await createUser({ role: 'citizen', lguId: lgu.id, name: 'Tenant Citizen' });
  const tenantAdmin = await login(server.base, tenantAdminUser);
  const tenantStaff = await login(server.base, tenantStaffUser);
  const tenantCitizen = await login(server.base, tenantCitizenUser);

  const defaultReport = await submitReport(defaultCitizen, {
    road_name: 'Malolos Tenant Boundary Road',
    latitude: '14.8433',
    longitude: '120.8114',
  });
  const tenantReport = await submitReport(tenantCitizen, {
    road_name: 'Meycauayan Tenant Boundary Road',
    city: 'Meycauayan',
    barangay: 'Calvario',
    latitude: '14.7367',
    longitude: '120.9607',
  });

  assert.equal(defaultReport.status, 201, JSON.stringify(defaultReport.data));
  assert.equal(tenantReport.status, 201, JSON.stringify(tenantReport.data));

  const defaultQueue = await defaultAdmin.get('/api/admin/reports');
  const tenantQueue = await tenantAdmin.get('/api/admin/reports');
  assert.equal(defaultQueue.status, 200);
  assert.equal(tenantQueue.status, 200);
  assert.equal(defaultQueue.data.total, 1);
  assert.equal(tenantQueue.data.total, 1);
  assert.equal(defaultQueue.data.items[0].id, defaultReport.data.report.id);
  assert.equal(tenantQueue.data.items[0].id, tenantReport.data.report.id);

  const crossTenantDetail = await tenantAdmin.get(`/api/reports/${defaultReport.data.report.id}`);
  assert.equal(crossTenantDetail.status, 404, 'a tenant administrator cannot read a report from another LGU');

  const tenantStaffUsers = await tenantStaff.get('/api/admin/users');
  assert.equal(tenantStaffUsers.status, 403, 'LGU staff cannot manage user accounts');

  const tenantUsers = await tenantAdmin.get('/api/admin/users');
  assert.equal(tenantUsers.status, 200);
  assert.ok(tenantUsers.data.items.every((user) => user.lgu_id === lgu.id));
  assert.ok(!tenantUsers.data.items.some((user) => user.id === defaultAdmin.user?.id));

  const crossTenantUserEdit = await tenantAdmin.patch(`/api/admin/users/${defaultAdmin.user?.id}`, {
    full_name: 'Should Not Be Changed',
  });
  assert.equal(crossTenantUserEdit.status, 404, 'an LGU admin cannot edit accounts from a different tenant');

  const adminTenantUsers = await defaultAdmin.get('/api/admin/users');
  assert.equal(adminTenantUsers.status, 200);
  assert.ok(adminTenantUsers.data.items.every((user) => user.lgu_id === defaultAdmin.user?.lgu_id));
});


test('regional administrator scopes reports, maps, exports, teams and users to assigned descendants; assignment changes revoke sessions and are audited', async () => {
  async function createJurisdiction({ name, slug, level, parentId = null, city }) {
    const result = await platform.post('/api/platform/lgus', {
      name, slug, city, province: 'Bulacan', jurisdiction_level: level, parent_lgu_id: parentId,
      admin_name: name + ' Administrator',
      admin_email: slug + '.admin@example.test',
      admin_phone: null,
      temporary_password: 'StartAdmin123',
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.lgu;
  }

  const island = await createJurisdiction({ name: 'Jurisdiction Test Luzon', slug: 'jurisdiction-test-luzon', level: 'island_group', city: null });
  const region = await createJurisdiction({ name: 'Central Test Region', slug: 'central-test-region', level: 'region', parentId: island.id, city: 'Central' });
  const province = await createJurisdiction({ name: 'Central Test Province', slug: 'central-test-province', level: 'province', parentId: region.id, city: null });
  const child = await createJurisdiction({ name: 'Test Municipality', slug: 'test-municipality', level: 'municipality', parentId: province.id, city: 'Test Municipality' });
  const otherIsland = await createJurisdiction({ name: 'Jurisdiction Test Visayas', slug: 'jurisdiction-test-visayas', level: 'island_group', city: null });
  const otherRegion = await createJurisdiction({ name: 'Other Test Region', slug: 'other-test-region', level: 'region', parentId: otherIsland.id, city: 'Other' });

  const regionalUser = await createUser({ role: 'admin', lguId: region.id, name: 'Regional Scope Admin' });
  const staleSession = await login(server.base, regionalUser);
  const assignment = await platform.put('/api/platform/accounts/' + regionalUser.id + '/jurisdictions', { lgu_ids: [region.id] });
  assert.equal(assignment.status, 200, JSON.stringify(assignment.data));
  assert.equal(assignment.data.changed, true);
  assert.equal((await staleSession.get('/api/admin/reports')).status, 401, 'the assignment update should revoke existing sessions');

  const childCitizen = await login(server.base, await createUser({ role: 'citizen', lguId: child.id, name: 'Child Jurisdiction Citizen' }));
  const otherCitizen = await login(server.base, await createUser({ role: 'citizen', lguId: otherRegion.id, name: 'Other Jurisdiction Citizen' }));
  const childSubmission = await submitReport(childCitizen, {
    road_name: 'Descendant Scope Road',
    city: 'Test Municipality',
    barangay: 'North',
    latitude: '14.7001',
    longitude: '120.9001',
  });
  const otherSubmission = await submitReport(otherCitizen, {
    road_name: 'Outside Scope Road',
    city: 'Other Region',
    barangay: 'South',
    latitude: '14.7101',
    longitude: '120.9101',
  });
  assert.equal(childSubmission.status, 201, JSON.stringify(childSubmission.data));
  assert.equal(otherSubmission.status, 201, JSON.stringify(otherSubmission.data));

  const regional = await login(server.base, regionalUser);
  const queue = await regional.get('/api/admin/reports');
  assert.equal(queue.status, 200, JSON.stringify(queue.data));
  assert.ok(queue.data.items.some((row) => row.id === childSubmission.data.report.id), 'a region admin sees descendant reports');
  assert.ok(!queue.data.items.some((row) => row.id === otherSubmission.data.report.id), 'a region admin does not see a sibling region report');

  const map = await regional.get('/api/admin/map');
  assert.equal(map.status, 200);
  assert.ok(map.data.items.some((row) => row.id === childSubmission.data.report.id));
  assert.ok(!map.data.items.some((row) => row.id === otherSubmission.data.report.id));

  const crossScopeDetail = await regional.get('/api/reports/' + otherSubmission.data.report.id);
  assert.equal(crossScopeDetail.status, 404, 'report details use the same scope check');

  const teamCreated = await regional.post('/api/admin/teams', {
    lgu_id: child.id, name: 'Descendant Road Crew', description: 'Regional team', is_active: true,
  });
  assert.equal(teamCreated.status, 201, JSON.stringify(teamCreated.data));
  const teamList = await regional.get('/api/admin/teams');
  assert.equal(teamList.status, 200);
  assert.ok(teamList.data.items.some((row) => row.id === teamCreated.data.id), 'regional admins may create and view teams in descendants');

  const agencyCreated = await regional.post('/api/admin/agencies', {
    lgu_id: child.id, name: 'Descendant Public Works', jurisdiction: 'city_municipal',
    contact_email: null, contact_phone: null, is_active: true,
  });
  assert.equal(agencyCreated.status, 201, JSON.stringify(agencyCreated.data));
  const agencyList = await regional.get('/api/admin/agencies');
  assert.equal(agencyList.status, 200);
  assert.ok(agencyList.data.items.some((row) => row.id === agencyCreated.data.id));

  const users = await regional.get('/api/admin/users');
  assert.equal(users.status, 200);
  assert.ok(users.data.items.some((row) => row.lgu_id === child.id), 'account directory includes users in a descendant LGU');
  assert.ok(!users.data.items.some((row) => row.lgu_id === otherRegion.id), 'account directory excludes users outside the assignment');

  const csv = await regional.get('/api/admin/exports/reports.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.data, /Descendant Scope Road/);
  assert.doesNotMatch(csv.data, /Outside Scope Road/);

  const centralAccounts = await platform.get('/api/platform/accounts');
  assert.equal(centralAccounts.status, 200);
  const listed = centralAccounts.data.items.find((row) => row.id === regionalUser.id);
  assert.ok(listed);
  assert.deepEqual(listed.jurisdiction_lgu_ids, [region.id]);

  const history = await platform.get('/api/platform/accounts/' + regionalUser.id + '/jurisdiction-history');
  assert.equal(history.status, 200);
  assert.ok(history.data.items.some((row) => row.action === 'assigned' && row.lgu_id === region.id));

  const demotedSession = await login(server.base, regionalUser);
  const demotion = await platform.patch('/api/platform/accounts/' + regionalUser.id, { role: 'staff' });
  assert.equal(demotion.status, 200, JSON.stringify(demotion.data));
  assert.equal((await demotedSession.get('/api/admin/reports')).status, 401, 'role changes should revoke sessions too');
  const postDemotionHistory = await platform.get('/api/platform/accounts/' + regionalUser.id + '/jurisdiction-history');
  assert.equal(postDemotionHistory.status, 200, 'history remains visible after an administrator is demoted');
  assert.ok(postDemotionHistory.data.items.some((row) => row.action === 'revoked' && row.lgu_id === region.id));
});

test('the platform administrator has every LGU administrator power in every LGU', async () => {
  const sql = getSql();
  // A second LGU with its own citizen report.
  const [other] = await sql`
    INSERT INTO lgus (name, slug, city, province, jurisdiction_level, is_active)
    VALUES ('Platform Reach Town', 'platform-reach-town', 'Platform Reach Town', 'Bulacan', 'municipality', TRUE) RETURNING id`;
  const otherCitizen = await login(server.base, await createUser({ role: 'citizen', lguId: other.id }));
  const created = await submitReport(otherCitizen);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const reportId = created.data.report.id;
  const mine = await submitReport(defaultCitizen, { latitude: '14.8611', longitude: '120.8123', road_name: 'Platform Test Road' });
  assert.equal(mine.status, 201, JSON.stringify(mine.data));

  // An LGU administrator cannot see the other LGU's report …
  assert.equal((await defaultAdmin.get('/api/reports/' + reportId)).status, 404);
  // … the platform administrator sees and works on reports in both LGUs.
  const list = await platform.get('/api/admin/reports?page_size=100');
  assert.equal(list.status, 200, JSON.stringify(list.data));
  const ids = list.data.items.map((r) => r.id);
  assert.ok(ids.includes(reportId) && ids.includes(mine.data.report.id), 'reports from every LGU are listed');
  assert.equal((await platform.get('/api/reports/' + reportId)).status, 200);
  assert.equal((await platform.post('/api/admin/reports/' + reportId + '/review', {})).status, 200);
  const verified = await platform.post('/api/admin/reports/' + reportId + '/verify', {});
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  const [row] = await sql`SELECT status FROM reports WHERE id = ${reportId}`;
  assert.equal(row.status, 'verified');

  // Dashboard figures cover every LGU.
  const stats = await platform.get('/api/admin/stats');
  assert.equal(stats.status, 200);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM reports`;
  assert.equal(stats.data.totals.total, n);

  // Users, teams, settings (of a chosen LGU), activity log and exports.
  assert.equal((await platform.get('/api/admin/users')).status, 200);
  assert.equal((await platform.get('/api/admin/teams')).status, 200);
  const team = await platform.post('/api/admin/teams', { name: 'Platform Reach Crew', lgu_id: other.id });
  assert.equal(team.status, 201, JSON.stringify(team.data));
  const settings = await platform.get('/api/admin/settings?lgu_id=' + other.id);
  assert.equal(settings.status, 200, JSON.stringify(settings.data));
  assert.equal(settings.data.lgu.id, other.id);
  const saved = await platform.put('/api/admin/settings?lgu_id=' + other.id, { duplicate_radius_m: 45 });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const [radius] = await sql`SELECT value FROM settings WHERE lgu_id = ${other.id} AND key = 'duplicate_radius_m'`;
  assert.equal(Number(radius.value), 45);
  assert.equal((await platform.get('/api/admin/settings')).status, 200, 'defaults to an LGU when none is chosen');
  assert.equal((await platform.get('/api/admin/audit')).status, 200);
  assert.equal((await platform.get('/api/admin/exports/reports.csv')).status, 200);

  // An LGU administrator still cannot open another LGU's settings.
  assert.equal((await defaultAdmin.get('/api/admin/settings?lgu_id=' + other.id)).status, 404);
  // Citizen-only actions stay with citizens.
  assert.equal((await submitReport(platform)).status, 403);
});


test('focusing on one LGU narrows every view; comparison and monthly/figures exports work', async () => {
  const sql = getSql();
  const [focusTown] = await sql`
    INSERT INTO lgus (name, slug, city, province, jurisdiction_level, is_active)
    VALUES ('Focus Test Town', 'focus-test-town', 'Focus Test Town', 'Bulacan', 'municipality', TRUE) RETURNING id`;
  const resident = await login(server.base, await createUser({ role: 'citizen', lguId: focusTown.id }));
  const made = await submitReport(resident, { latitude: '14.9011', longitude: '120.9022', road_name: 'Focus Road' });
  assert.equal(made.status, 201, JSON.stringify(made.data));

  const all = await platform.get('/api/admin/stats');
  const focused = await platform.get('/api/admin/stats', { headers: { 'x-wayguard-focus': String(focusTown.id) } });
  assert.equal(focused.status, 200);
  assert.equal(focused.data.totals.total, 1, 'only the focused LGU is counted');
  assert.ok(all.data.totals.total > 1);
  const me = await platform.get('/api/auth/me', { headers: { 'x-wayguard-focus': String(focusTown.id) } });
  assert.equal(me.data.user.focus_lgu.name, 'Focus Test Town');
  const list = await platform.get('/api/admin/reports?page_size=100', { headers: { 'x-wayguard-focus': String(focusTown.id) } });
  assert.deepEqual(list.data.items.map((r) => r.road_name), ['Focus Road']);
  const csvFocused = await platform.get(`/api/admin/exports/reports.csv?focus_lgu=${focusTown.id}`);
  assert.ok(String(csvFocused.data).includes('Focus Road'));

  // Focus can only narrow: an LGU admin cannot focus on another LGU.
  const outside = await defaultAdmin.get('/api/admin/stats', { headers: { 'x-wayguard-focus': String(focusTown.id) } });
  const own = await defaultAdmin.get('/api/admin/stats');
  assert.equal(outside.data.totals.total, own.data.totals.total, 'an unrelated focus is ignored');

  const compare = await platform.get('/api/platform/compare');
  assert.equal(compare.status, 200);
  const row = compare.data.items.find((x) => x.id === focusTown.id);
  assert.equal(row.total, 1);
  assert.equal(row.open, 1);
  assert.equal((await defaultAdmin.get('/api/platform/compare')).status, 403);

  const figures = await defaultAdmin.get('/api/admin/exports/stats.csv');
  assert.equal(figures.status, 200);
  assert.match(String(figures.data), /Total reports,\d+/);
  const month = new Date().toISOString().slice(0, 7);
  const monthly = await platform.get(`/api/admin/exports/monthly.pdf?month=${month}&focus_lgu=${focusTown.id}`);
  assert.equal(monthly.status, 200);
  assert.match(monthly.headers.get('content-type'), /application\/pdf/);
});
