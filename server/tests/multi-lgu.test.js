import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDatabase,
  startServer,
  shutdown,
  createUser,
  login,
  submitReport,
  getSql,
} from './helpers.js';

let server;
let platform;
let defaultAdmin;
let defaultCitizen;

before(async () => {
  await resetDatabase();
  server = await startServer();
  platform = await login(server.base, await createUser({ role: 'platform_admin' }));
  defaultAdmin = await login(server.base, await createUser({ role: 'admin' }));
  defaultCitizen = await login(server.base, await createUser({ role: 'citizen' }));
});

after(() => shutdown(server));

test('platform admins provision an LGU and its first administrator', async () => {
  const blocked = await defaultAdmin.get('/api/platform/lgus');
  assert.equal(blocked.status, 403, 'an LGU admin cannot manage platform tenants');

  const response = await platform.post('/api/platform/lgus', {
    name: 'City of Meycauayan',
    slug: 'meycauayan',
    city: 'Meycauayan',
    province: 'Bulacan',
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

  const region = await createJurisdiction({ name: 'Central Test Region', slug: 'central-test-region', level: 'region', city: 'Central' });
  const child = await createJurisdiction({ name: 'Test Municipality', slug: 'test-municipality', level: 'municipality', parentId: region.id, city: 'Test Municipality' });
  const otherRegion = await createJurisdiction({ name: 'Other Test Region', slug: 'other-test-region', level: 'region', city: 'Other' });

  const regionalUser = await createUser({ role: 'admin', lguId: region.id, name: 'Regional Scope Admin' });
  const staleSession = await login(server.base, regionalUser);
  const assignment = await platform.put('/api/platform/accounts/' + regionalUser.id + '/jurisdictions', { lgu_ids: [region.id] });
  assert.equal(assignment.status, 200, JSON.stringify(assignment.data));
  assert.equal(assignment.data.changed, true);
  assert.equal((await staleSession.get('/api/notifications')).status, 401, 'the assignment update should revoke existing sessions');

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
});
