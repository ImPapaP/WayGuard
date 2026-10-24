// User account management: create staff accounts, change roles and teams,
// deactivate accounts and reset passwords. Every change is audit-logged.
import { useState } from 'react';
import { LuUserPlus, LuSearch, LuKeyRound, LuPencil, LuRefreshCw } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useDocumentTitle } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { useToast } from '../../lib/toast.jsx';
import { useQueryState } from '../../lib/router.jsx';
import { Alert, Button, EmptyState, ErrorState, Loading, Modal, Pagination, SelectField, TextField } from '../../components/ui.jsx';
import { ROLES, formatDate, initials, timeAgo } from '../../lib/format.js';

// A readable temporary password the administrator can pass on.
function tempPassword() {
  const words = ['Road', 'Lane', 'Patch', 'Safe', 'Trip', 'Guard', 'Asphalt', 'Bridge', 'Route', 'Curb'];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  const num = 100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900);
  return `${pick()}-${pick()}-${num}`;
}

const ROLE_OPTIONS = Object.entries(ROLES).map(([value, label]) => ({ value, label }));

function UserModal({ user, teams, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !user;
  const [form, setForm] = useState(
    isNew
      ? { full_name: '', email: '', phone: '', role: 'maintenance', team_id: '', temporary_password: tempPassword() }
      : { full_name: user.full_name, phone: user.phone || '', role: user.role, team_id: user.team_id ? String(user.team_id) : '', is_active: user.is_active },
  );
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      ...form,
      phone: form.phone || null,
      team_id: form.role === 'maintenance' && form.team_id ? Number(form.team_id) : null,
    };
    try {
      if (isNew) await api.post('/api/admin/users', body);
      else await api.patch(`/api/admin/users/${user.id}`, body);
      toast(isNew ? `Account created for ${form.full_name}.` : 'User updated.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const f = error?.fields || {};
  return (
    <Modal
      title={isNew ? 'Add a staff account' : `Edit ${user.full_name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="navy" loading={busy} onClick={save}>
            {isNew ? 'Create account' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        {error && <Alert type="error">{error.message}</Alert>}
        <TextField label="Full name" value={form.full_name} onChange={set('full_name')} error={f.full_name} />
        {isNew && <TextField label="E-mail" type="email" value={form.email} onChange={set('email')} error={f.email} />}
        <TextField label="Phone" optional type="tel" value={form.phone} onChange={set('phone')} error={f.phone} />
        <div className="form-row form-row--2">
          <SelectField label="Role" value={form.role} onChange={set('role')} options={ROLE_OPTIONS} error={f.role} />
          {form.role === 'maintenance' && (
            <SelectField
              label="Team"
              value={form.team_id}
              onChange={set('team_id')}
              placeholder="Choose a team"
              error={f.team_id}
              options={teams.filter((t) => t.is_active).map((t) => ({ value: String(t.id), label: t.name }))}
            />
          )}
        </div>
        {isNew ? (
          <TextField
            label="Temporary password"
            hint="Give this to the person. They must choose their own password when they first sign in."
            value={form.temporary_password}
            onChange={set('temporary_password')}
            error={f.temporary_password}
          />
        ) : (
          <label className="checkline">
            <input type="checkbox" checked={form.is_active} onChange={set('is_active')} />
            <span>
              Account is active
              <span className="field__hint" style={{ display: 'block' }}>
                Deactivated users are signed out and cannot sign in. Their reports are kept.
              </span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose }) {
  const toast = useToast();
  const [pw, setPw] = useState(tempPassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function reset() {
    setBusy(true);
    try {
      await api.post(`/api/admin/users/${user.id}/reset-password`, { temporary_password: pw });
      toast(`Password reset for ${user.full_name}.`);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Reset password for ${user.full_name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={reset}>
            Reset password
          </Button>
        </>
      }
    >
      <p className="small">They will be signed out everywhere and must choose a new password after signing in with this one.</p>
      <TextField label="Temporary password" value={pw} onChange={(e) => setPw(e.target.value)} error={error?.fields?.temporary_password || (!error?.fields && error?.message)} />
      <Button size="sm" variant="ghost" onClick={() => setPw(tempPassword())}>
        <LuRefreshCw aria-hidden /> Generate another
      </Button>
    </Modal>
  );
}

export default function Users() {
  useDocumentTitle('Users');
  const { user: me } = useAuth();
  const [query, setQuery] = useQueryState();
  const [search, setSearch] = useState(query.q || '');
  const q = useDebounced(search);
  const [modal, setModal] = useState(null);
  const { data, error, loading, reload } = useApi(`/api/admin/users${qs({ q, role: query.role, status: query.status, page: query.page })}`);
  const { data: teams } = useApi('/api/admin/teams');

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Citizens register themselves. Create accounts for LGU administrators and maintenance personnel here.</p>
        </div>
        <Button variant="primary" onClick={() => setModal({ type: 'new' })} disabled={!teams}>
          <LuUserPlus aria-hidden /> Add staff account
        </Button>
      </div>
      <div className="filters panel">
        <div className="filters__row">
          <div className="search-input">
            <LuSearch aria-hidden />
            <input className="input" type="search" placeholder="Search name or e-mail" aria-label="Search users" value={search} onChange={(e) => { setSearch(e.target.value); setQuery({ page: '' }); }} />
          </div>
          <select className="select select--sm" aria-label="Role" value={query.role || ''} onChange={(e) => setQuery({ role: e.target.value, page: '' })}>
            <option value="">All roles</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <select className="select select--sm" aria-label="Account status" value={query.status || ''} onChange={(e) => setQuery({ status: e.target.value, page: '' })}>
            <option value="">Active and inactive</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </select>
        </div>
      </div>
      <div className="panel panel--flush">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : !data.items.length ? (
          <EmptyState title="No users found">Try a different search or filter.</EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table--stack">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Role</th>
                    <th scope="col">Reports</th>
                    <th scope="col">Last sign-in</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((u) => (
                    <tr key={u.id} className={u.is_active ? '' : 'row--inactive'}>
                      <td className="td-wide">
                        <span className="user-cell">
                          <span className="avatar" aria-hidden>
                            {initials(u.full_name)}
                          </span>
                          <span>
                            <strong>{u.full_name}</strong>
                            {!u.is_active && <span className="badge badge--duplicate" style={{ marginLeft: 6 }}>Deactivated</span>}
                            {u.must_change_password && u.is_active && <span className="badge badge--under_review" style={{ marginLeft: 6 }}>Temporary password</span>}
                            <span className="table__sub">{u.email}</span>
                          </span>
                        </span>
                      </td>
                      <td data-label="Role">
                        {ROLES[u.role]}
                        {u.team_name && <span className="table__sub">{u.team_name}</span>}
                      </td>
                      <td data-label="Reports" className="numeral">
                        {u.report_count}
                      </td>
                      <td data-label="Last sign-in" title={u.last_login_at ? formatDate(u.last_login_at) : ''}>
                        {u.last_login_at ? timeAgo(u.last_login_at) : <span className="muted">Never</span>}
                      </td>
                      <td className="nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setModal({ type: 'edit', user: u })} aria-label={`Edit ${u.full_name}`}>
                          <LuPencil aria-hidden /> Edit
                        </Button>
                        {u.id !== me.id && (
                          <Button size="sm" variant="ghost" onClick={() => setModal({ type: 'reset', user: u })} aria-label={`Reset password for ${u.full_name}`}>
                            <LuKeyRound aria-hidden /> Reset password
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQuery({ page: p })} />
          </>
        )}
      </div>
      {modal?.type === 'new' && <UserModal teams={teams.items} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal?.type === 'edit' && teams && <UserModal user={modal.user} teams={teams.items} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal?.type === 'reset' && <ResetModal user={modal.user} onClose={() => setModal(null)} />}
    </div>
  );
}
