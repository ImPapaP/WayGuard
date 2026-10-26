// User account management: create staff accounts, change roles and teams,
// deactivate accounts and reset passwords. Every change is audit-logged.
import { useState } from 'react';
import { LuUserPlus, LuSearch, LuKeyRound, LuPencil, LuRefreshCw, LuUsers, LuMapPin, LuShieldCheck, LuInfo } from 'react-icons/lu';
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

function AccountFormIntro({ icon: Icon, eyebrow, title, children }) {
  return (
    <div className="workspace-form__intro">
      <div className="workspace-form__icon"><Icon aria-hidden /></div>
      <div className="workspace-form__intro-copy">
        <p className="workspace-form__eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </div>
  );
}

function AccountScope({ lgu }) {
  const level = (lgu?.jurisdiction_level || 'municipality').replaceAll('_', ' ');
  const location = [lgu?.city, lgu?.province].filter(Boolean).join(', ');
  return (
    <div className="workspace-form__scope">
      <LuMapPin aria-hidden />
      <div>
        <strong>{lgu?.name || 'Primary assigned LGU'}</strong>
        <p>{[level, location].filter(Boolean).join(' · ') || 'This account is created inside your assigned jurisdiction.'}</p>
      </div>
    </div>
  );
}

const ROLE_GUIDANCE = {
  citizen: 'Can submit reports and follow their own report history. This account does not get administrative tools.',
  admin: 'Can manage reports, teams, agencies, and users within the selected jurisdiction and its descendant LGUs.',
  staff: 'Can review reports and handle assigned operational work within the selected jurisdiction, but cannot manage user accounts.',
  maintenance: 'Can view and update repair tasks assigned to the selected active team. The team and account must belong to the same LGU.',
};

function UserModal({ user, teams, jurisdictions, primaryLguId, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !user;
  const [form, setForm] = useState(() => (
    isNew
      ? { full_name: '', email: '', phone: '', role: 'staff', lgu_id: String(primaryLguId || jurisdictions[0]?.id || ''), team_id: '', temporary_password: tempPassword() }
      : { full_name: user.full_name, phone: user.phone || '', role: user.role, lgu_id: user.lgu_id ? String(user.lgu_id) : '', team_id: user.team_id ? String(user.team_id) : '', is_active: user.is_active }
  ));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const lguId = Number(form.lgu_id || primaryLguId || jurisdictions[0]?.id);
  const selectedLgu = jurisdictions.find((lgu) => Number(lgu.id) === lguId);
  const availableTeams = teams.filter((team) =>
    Number(team.lgu_id) === lguId && (team.is_active || String(team.id) === form.team_id),
  );

  function changeJurisdiction(value) {
    setForm((old) => ({ ...old, lgu_id: value, team_id: '' }));
    setError(null);
  }

  function changeRole(value) {
    setForm((old) => ({ ...old, role: value, team_id: value === 'maintenance' ? old.team_id : '' }));
    setError(null);
  }

  async function save() {
    setError(null);
    if (!form.full_name.trim()) {
      setError({ message: 'Enter the account holder’s full name.', fields: { full_name: 'Full name is required.' } });
      return;
    }
    if (isNew && !form.email.trim()) {
      setError({ message: 'Enter an e-mail address for the new account.', fields: { email: 'E-mail is required.' } });
      return;
    }
    if (!lguId || !selectedLgu) {
      setError({ message: 'Choose a jurisdiction available to your administrator account.' });
      return;
    }
    if (form.role === 'maintenance') {
      if (!form.team_id) {
        setError({ message: 'Choose an active team for this maintenance account.', fields: { team_id: 'Choose a team.' } });
        return;
      }
      if (!availableTeams.some((team) => String(team.id) === form.team_id)) {
        setError({ message: 'Choose a team that belongs to the selected jurisdiction.', fields: { team_id: 'Team and account jurisdiction must match.' } });
        return;
      }
    }
    if (isNew && !form.temporary_password) {
      setError({ message: 'A temporary password is required.', fields: { temporary_password: 'Enter a temporary password.' } });
      return;
    }

    setBusy(true);
    const body = {
      ...form,
      full_name: form.full_name.trim(),
      email: form.email?.trim(),
      phone: form.phone || null,
      team_id: form.role === 'maintenance' && form.team_id ? Number(form.team_id) : null,
    };
    if (isNew) body.lgu_id = lguId;
    else delete body.lgu_id;
    try {
      if (isNew) await api.post('/api/admin/users', body);
      else await api.patch('/api/admin/users/' + user.id, body);
      toast(isNew ? 'New account created. Share its temporary password securely.' : 'User access details updated.');
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
      title={isNew ? 'New account' : 'Edit account'}
      className="modal--workspace"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="navy" loading={busy} onClick={save}>
            {isNew ? 'Create account' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="workspace-form">
        <AccountFormIntro
          icon={LuUserPlus}
          eyebrow={isNew ? 'Account setup' : 'Account settings'}
          title={isNew ? 'Create a WayGuard account' : user.full_name}
        >
          {isNew
            ? 'Add someone to your operational workspace. Their selected role controls what they can access, and new accounts must change their temporary password at first sign-in.'
            : 'Update the account details and access role. Role, team, or active-status changes will sign the account out everywhere.'}
        </AccountFormIntro>

        {error && <Alert type="error" title="Could not save account">{error.message}</Alert>}

        <section className="workspace-form__section">
          <div className="workspace-form__section-head">
            <span className="workspace-form__section-icon"><LuUsers aria-hidden /></span>
            <div><h3>Personal details</h3><p>Use the name and contact details staff will recognize.</p></div>
          </div>
          <TextField label="Full name" value={form.full_name} onChange={set('full_name')} placeholder="e.g. Juan Dela Cruz" autoComplete="name" required error={f.full_name} />
          {isNew && <TextField label="E-mail address" type="email" value={form.email} onChange={set('email')} placeholder="name@example.gov.ph" autoComplete="email" required error={f.email} />}
          <TextField label="Phone number" optional type="tel" value={form.phone} onChange={set('phone')} placeholder="e.g. 0917 123 4567" autoComplete="tel" error={f.phone} />
        </section>

        <section className="workspace-form__section">
          <div className="workspace-form__section-head">
            <span className="workspace-form__section-icon"><LuShieldCheck aria-hidden /></span>
            <div><h3>Role and access</h3><p>Choose the role that matches the person's responsibilities.</p></div>
          </div>
          <SelectField label="Account role" value={form.role} onChange={(event) => changeRole(event.target.value)} options={ROLE_OPTIONS} required error={f.role} />
          <div className="workspace-form__role"><LuInfo aria-hidden /><div><strong>{ROLE_OPTIONS.find((item) => item.value === form.role)?.label || 'Account role'}</strong><br />{ROLE_GUIDANCE[form.role]}</div></div>
          {isNew && (jurisdictions.length > 1 ? (
            <SelectField
              label="Operating jurisdiction"
              value={form.lgu_id}
              onChange={(event) => changeJurisdiction(event.target.value)}
              options={jurisdictions.map((lgu) => ({ value: String(lgu.id), label: lgu.name + ' — ' + (lgu.jurisdiction_level || 'municipality').replaceAll('_', ' ') + (lgu.city || lgu.province ? ' · ' + [lgu.city, lgu.province].filter(Boolean).join(', ') : '') }))}
              hint="This is the LGU that owns the account. Administrators may be able to work across descendant LGUs."
              required
              error={f.lgu_id}
            />
          ) : <AccountScope lgu={selectedLgu} />)}
          {!isNew && <AccountScope lgu={jurisdictions.find((lgu) => Number(lgu.id) === Number(user.lgu_id))} />}

          {form.role === 'maintenance' && (
            <div className="workspace-form__section" style={{ gap: 12 }}>
              <SelectField
                label="Assigned maintenance team"
                value={form.team_id}
                onChange={set('team_id')}
                placeholder="Choose an active team"
                options={availableTeams.map((team) => ({ value: String(team.id), label: team.name + (team.lgu_name ? ' · ' + team.lgu_name : '') }))}
                required
                error={f.team_id}
                hint="Only active teams within this account's jurisdiction are available."
              />
              {!availableTeams.length && <Alert type="warn" title="No active team in this jurisdiction">Create a team first from <Link to="/admin/teams">Teams and agencies</Link>, then return here to add the maintenance account.</Alert>}
            </div>
          )}
        </section>

        {isNew ? (
          <section className="workspace-form__section">
            <div className="workspace-form__section-head">
              <span className="workspace-form__section-icon"><LuKeyRound aria-hidden /></span>
              <div><h3>Temporary sign-in password</h3><p>Share this password privately with the new account holder.</p></div>
            </div>
            <div className="workspace-form__password">
              <TextField label="Temporary password" value={form.temporary_password} onChange={set('temporary_password')} autoComplete="new-password" required error={f.temporary_password} hint="At least 8 characters, including a letter and a number." />
              <Button variant="secondary" onClick={() => setForm((old) => ({ ...old, temporary_password: tempPassword() }))} disabled={busy}><LuRefreshCw aria-hidden /> Generate</Button>
            </div>
            <div className="workspace-form__hint"><LuInfo aria-hidden /> The account holder must choose a new password at first sign-in. Do not send temporary passwords in public or group chats.</div>
          </section>
        ) : (
          <section className="workspace-form__section">
            <div className="workspace-form__section-head">
              <span className="workspace-form__section-icon"><LuShieldCheck aria-hidden /></span>
              <div><h3>Account status</h3><p>Inactive accounts are blocked from signing in; their existing records remain preserved.</p></div>
            </div>
            <label className="checkline">
              <input type="checkbox" checked={form.is_active} onChange={set('is_active')} />
              <span><strong>Account is active</strong><span className="field__hint" style={{ display: 'block' }}>Turning this off revokes the user's current sessions.</span></span>
            </label>
          </section>
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
  const { data: jurisdictions } = useApi('/api/admin/jurisdictions');
  const primaryLguId = me?.lgu_id == null ? '' : String(me.lgu_id);

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Create accounts with a role, jurisdiction and team assignment that match the responsibilities they will have in WayGuard.</p>
        </div>
        <Button variant="primary" onClick={() => setModal({ type: 'new' })} disabled={!teams || !jurisdictions}>
          <LuUserPlus aria-hidden /> New account
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
      {modal?.type === 'new' && teams && jurisdictions && <UserModal teams={teams.items} jurisdictions={jurisdictions.items} primaryLguId={primaryLguId} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal?.type === 'edit' && teams && jurisdictions && <UserModal user={modal.user} teams={teams.items} jurisdictions={jurisdictions.items} primaryLguId={primaryLguId} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal?.type === 'reset' && <ResetModal user={modal.user} onClose={() => setModal(null)} />}
    </div>
  );
}
