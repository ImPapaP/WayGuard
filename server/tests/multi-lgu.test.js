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
  const adminTenantUsers = await defaultAdmin.get('/api/admin/users');
  assert.equal(adminTenantUsers.status, 200);
  assert.ok(adminTenantUsers.data.items.every((user) => user.lgu_id === defaultAdmin.user?.lgu_id));
});
