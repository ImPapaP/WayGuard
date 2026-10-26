// Central directory for Management to manage accounts, jurisdiction scopes and access history.
import { useMemo, useState } from 'react';
import { LuHistory, LuSearch, LuShieldCheck, LuUsers, LuBuilding2, LuCircleCheck, LuCircleX } from 'react-icons/lu';
import { Link } from '../../lib/router.jsx';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';
import { Alert, Button, EmptyState, Loading, SelectField, TextField } from '../../components/ui.jsx';
import { PublicLayout } from '../../components/Shells.jsx';

const ROLE_OPTIONS = [
  { value: 'citizen', label: 'Citizen' },
  { value: 'admin', label: 'LGU administrator' },
  { value: 'staff', label: 'LGU staff' },
  { value: 'maintenance', label: 'Maintenance crew' },
];

function roleLabel(role) {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label || role;
}

function baseJurisdictions(account) {
  const assigned = (account.jurisdiction_lgu_ids || []).map(Number);
  if (account.role === 'admin' && account.lgu_id != null) assigned.push(Number(account.lgu_id));
  return [...new Set(assigned)];
}

export default function Accounts() {
  useDocumentTitle('Management accounts and assignments');
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/api/platform/accounts');
  const { data: lguData, error: lguError } = useApi('/api/platform/lgus');
  const [search, setSearch] = useState('');
  const [roleDrafts, setRoleDrafts] = useState({});
  const [statusDrafts, setStatusDrafts] = useState({});
  const [assignmentDrafts, setAssignmentDrafts] = useState({});
  const [areaPickers, setAreaPickers] = useState({});
  const [newAdminForm, setNewAdminForm] = useState({ full_name: '', email: '', phone: '', temporary_password: '' });
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [historyId, setHistoryId] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyError, setHistoryError] = useState(null);

  const accounts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.items || []).filter((account) => !needle ||
      [account.full_name, account.email, account.lgu_name, roleLabel(account.role)]
        .some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [data, search]);
  const allJurisdictions = lguData?.items || [];
  const jurisdictions = allJurisdictions.filter((lgu) => lgu.is_active && lgu.is_directory_node);
  const jurisdictionById = useMemo(() => new Map(allJurisdictions.map((lgu) => [Number(lgu.id), lgu])), [allJurisdictions]);
  const emptyAreaPicker = { islandGroup: '', region: '', branch: '', locality: '' };

  function childrenFor(parentId, allowedLevels) {
    return jurisdictions
      .filter((lgu) => {
        const actualParent = lgu.parent_lgu_id == null ? null : Number(lgu.parent_lgu_id);
        const expectedParent = parentId === '' || parentId === null || parentId === undefined ? null : Number(parentId);
        return actualParent === expectedParent && allowedLevels.includes(lgu.jurisdiction_level);
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((lgu) => ({
        value: String(lgu.id),
        label: lgu.name + (lgu.psgc_code ? ' · ' + lgu.psgc_code : ''),
      }));
  }

  function currentAreaPicker(accountId) {
    return areaPickers[accountId] || emptyAreaPicker;
  }

  function changeAreaPicker(accountId, key, value) {
    setAreaPickers((previous) => ({
      ...previous,
      [accountId]: {
        ...(previous[accountId] || emptyAreaPicker),
        [key]: value,
        ...(key === 'islandGroup' ? { region: '', branch: '', locality: '' } : {}),
        ...(key === 'region' ? { branch: '', locality: '' } : {}),
        ...(key === 'branch' ? { locality: '' } : {}),
      },
    }));
  }

  function selectedAreaId(accountId) {
    const selected = currentAreaPicker(accountId);
    return selected.locality || selected.branch || selected.region || selected.islandGroup || '';
  }

  function areaPath(id) {
    const labels = [];
    const seen = new Set();
    let current = jurisdictionById.get(Number(id));
    while (current && !seen.has(Number(current.id))) {
      seen.add(Number(current.id));
      labels.unshift(current.name);
      current = current.parent_lgu_id == null ? null : jurisdictionById.get(Number(current.parent_lgu_id));
    }
    return labels.join(' / ') || 'Jurisdiction #' + id;
  }

  function currentRole(account) {
    return roleDrafts[account.id] ?? account.role;
  }
  function currentActive(account) {
    return statusDrafts[account.id] ?? account.is_active;
  }
  function currentAssignments(account) {
    return assignmentDrafts[account.id] ?? (account.role === 'admin' ? baseJurisdictions(account) : (roleDrafts[account.id] === 'admin' && account.lgu_id ? [Number(account.lgu_id)] : []));
  }
  function updateAssignments(accountId, lguId, checked) {
    setAssignmentDrafts((previous) => {
      const account = data?.items?.find((item) => item.id === accountId);
      const current = previous[accountId] ?? (account ? baseJurisdictions(account) : []);
      return { ...previous, [accountId]: checked ? [...new Set([...current, lguId])] : current.filter((id) => id !== lguId) };
    });
  }

  async function saveAccess(account) {
    setBusyId(account.id);
    try {
      const role = currentRole(account);
      const is_active = currentActive(account);
      if (role !== account.role || is_active !== account.is_active) {
        await api.patch('/api/platform/accounts/' + account.id, { role, is_active });
      }
      const requested = currentAssignments(account);
      const original = baseJurisdictions(account);
      if (role === 'admin' && (requested.length !== original.length || requested.some((id) => !original.includes(id)))) {
        if (!requested.length) throw new Error('Select at least one jurisdiction for an administrator.');
        await api.put('/api/platform/accounts/' + account.id + '/jurisdictions', { lgu_ids: requested });
      }
      toast('Access settings saved. The account must sign in again if permissions changed.');
      setRoleDrafts((old) => { const next = { ...old }; delete next[account.id]; return next; });
      setStatusDrafts((old) => { const next = { ...old }; delete next[account.id]; return next; });
      setAssignmentDrafts((old) => { const next = { ...old }; delete next[account.id]; return next; });
      await reload();
    } catch (err) {
      toast(err.message || 'Could not save account access.', { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function createAreaAdmin(event) {
    event.preventDefault();
    setCreateError(null);
    const lguId = selectedAreaId('new');
    if (!lguId) {
      setCreateError('Choose an area from the geographic hierarchy first.');
      return;
    }
    setCreatingAdmin(true);
    try {
      const result = await api.post('/api/platform/accounts', {
        ...newAdminForm,
        full_name: newAdminForm.full_name.trim(),
        email: newAdminForm.email.trim(),
        phone: newAdminForm.phone.trim() || null,
        lgu_id: Number(lguId),
      });
      toast('Administrator created for ' + result.jurisdiction.name + '. They must change the temporary password at first sign-in.');
      setNewAdminForm({ full_name: '', email: '', phone: '', temporary_password: '' });
      setAreaPickers((previous) => ({ ...previous, new: emptyAreaPicker }));
      await reload();
    } catch (err) {
      setCreateError(err.message || 'Could not create the area administrator.');
    } finally {
      setCreatingAdmin(false);
    }
  }

  async function viewHistory(account) {
    if (historyId === account.id) {
      setHistoryId(null);
      return;
    }
    setHistoryId(account.id);
    setHistoryItems([]);
    setHistoryError(null);
    try {
      const result = await api.get('/api/platform/accounts/' + account.id + '/jurisdiction-history');
      setHistoryItems(result.items || []);
    } catch (err) {
      setHistoryError(err.message || 'Could not load assignment history.');
    }
  }

  return (
    <PublicLayout>
      <div className="container page">
        <div className="page-head" style={{ alignItems: 'flex-start' }}>
          <div>
            <p className="eyebrow"><LuShieldCheck aria-hidden /> Platform administration</p>
            <h1>Accounts and jurisdiction assignments</h1>
            <p className="muted">Manage account status and roles, assign administrators to regions or provinces, and inspect each assignment's audit history.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
              <Link className="btn btn--secondary btn--sm" to="/platform/lgus"><LuBuilding2 aria-hidden /> LGU directory</Link>
              <Link className="btn btn--navy btn--sm" to="/platform/accounts"><LuUsers aria-hidden /> Accounts and assignments</Link>
            </div>
          </div>
        </div>

        <section className="panel" style={{ marginBottom: 20 }}>
          <div className="panel__head">
            <h2><LuShieldCheck aria-hidden /> Create an area administrator</h2>
            <span className="badge">Platform management</span>
          </div>
          <p className="muted small">Create an administrator account directly for a specific node in the official Philippine geographic hierarchy. The administrator inherits access to that area and all its child jurisdictions. They will be required to replace the temporary password on first sign-in.</p>
          <form className="form-stack" onSubmit={createAreaAdmin}>
            {createError && <Alert type="error">{createError}</Alert>}
            {!jurisdictions.length && !lguError && <Alert type="info">The official geographic directory is still loading or has not been synchronized yet.</Alert>}
            <div className="form-row form-row--2" style={{ gap: 10 }}>
              <SelectField
                label="1. Island group"
                value={currentAreaPicker('new').islandGroup}
                onChange={(event) => changeAreaPicker('new', 'islandGroup', event.target.value)}
                options={[{ value: '', label: 'Choose island group…' }, ...childrenFor(null, ['island_group'])]}
              />
              <SelectField
                label="2. Region"
                value={currentAreaPicker('new').region}
                onChange={(event) => changeAreaPicker('new', 'region', event.target.value)}
                options={[{ value: '', label: 'Choose region…' }, ...childrenFor(currentAreaPicker('new').islandGroup, ['region'])]}
              />
              <SelectField
                label="3. Province / independent city"
                value={currentAreaPicker('new').branch}
                onChange={(event) => changeAreaPicker('new', 'branch', event.target.value)}
                options={[{ value: '', label: 'Choose area…' }, ...childrenFor(currentAreaPicker('new').region, ['province', 'independent_city', 'special_area', 'city', 'municipality'])]}
              />
              <SelectField
                label="4. Component city / municipality"
                value={currentAreaPicker('new').locality}
                onChange={(event) => changeAreaPicker('new', 'locality', event.target.value)}
                options={[{ value: '', label: 'Optional — choose locality…' }, ...childrenFor(currentAreaPicker('new').branch, ['city', 'municipality'])]}
              />
            </div>
            <div className="panel" style={{ padding: 12, background: 'var(--surface-sunken)' }}>
              <strong>Selected area: </strong>
              {selectedAreaId('new') ? (
                <>{jurisdictionById.get(Number(selectedAreaId('new')))?.name || 'Selected jurisdiction'} <span className="muted small">— access covers all descendants</span></>
              ) : <span className="muted small">Select any hierarchy level above.</span>}
            </div>
            <div className="form-row form-row--2" style={{ gap: 10 }}>
              <TextField label="Full name" value={newAdminForm.full_name} onChange={(event) => setNewAdminForm((old) => ({ ...old, full_name: event.target.value }))} required />
              <TextField label="Email address" type="email" value={newAdminForm.email} onChange={(event) => setNewAdminForm((old) => ({ ...old, email: event.target.value }))} required />
              <TextField label="Phone (optional)" type="tel" value={newAdminForm.phone} onChange={(event) => setNewAdminForm((old) => ({ ...old, phone: event.target.value }))} />
              <TextField label="Temporary password" type="password" value={newAdminForm.temporary_password} onChange={(event) => setNewAdminForm((old) => ({ ...old, temporary_password: event.target.value }))} hint="At least 8 characters, with a letter and a number." required />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="navy" type="submit" loading={creatingAdmin} disabled={creatingAdmin || !selectedAreaId('new') || !jurisdictions.length}>
                Create administrator for this area
              </Button>
            </div>
          </form>
        </section>

        <section className="panel" style={{ marginBottom: 20 }}>
          <div className="panel__head">
            <h2><LuUsers aria-hidden /> Central account directory</h2>
            <span className="badge">{data?.items?.length ?? 0} accounts</span>
          </div>
          <p className="muted small">Administrators receive access to their assigned jurisdiction and all descendant LGUs. Removing or changing access revokes their existing sessions.</p>
          <TextField label="Search accounts" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, LGU or role" />
          {(error || lguError) && <Alert type="error">{error?.message || lguError?.message}</Alert>}
          {loading ? <Loading label="Loading accounts…" /> : !accounts.length ? (
            <EmptyState icon={LuSearch} title="No matching accounts" description="Try a different name, e-mail, LGU or role." />
          ) : (
            <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
              {accounts.map((account) => {
                const assignedIds = currentAssignments(account);
                const changed = currentRole(account) !== account.role ||
                  currentActive(account) !== account.is_active ||
                  (currentRole(account) === 'admin' && (assignedIds.length !== baseJurisdictions(account).length ||
                    assignedIds.some((id) => !baseJurisdictions(account).includes(id))));
                return (
                  <article key={account.id} className="panel" style={{ padding: 16, background: 'var(--surface-sunken)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div>
                        <h3 style={{ margin: 0 }}>{account.full_name}</h3>
                        <p style={{ margin: '4px 0' }}>{account.email}</p>
                        <p className="muted small" style={{ margin: '4px 0' }}>
                          Primary LGU: {account.lgu_name || 'Not assigned'} · Account #{account.id}
                        </p>
                        <span className={'badge ' + (account.is_active ? 'badge--resolved' : 'badge--rejected')}>
                          {account.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button size="sm" variant="secondary" onClick={() => setStatusDrafts((old) => ({ ...old, [account.id]: !currentActive(account) }))}>
                          {currentActive(account) ? <><LuCircleX aria-hidden /> Deactivate</> : <><LuCircleCheck aria-hidden /> Activate</>}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => viewHistory(account)}>
                          <LuHistory aria-hidden /> {historyId === account.id ? 'Hide history' : 'Assignment history'}
                        </Button>
                      </div>
                    </div>
                    <div className="form-row form-row--2" style={{ alignItems: 'start', marginTop: 14 }}>
                      <SelectField
                        label="Account role"
                        value={currentRole(account)}
                        onChange={(event) => setRoleDrafts((old) => ({ ...old, [account.id]: event.target.value }))}
                        options={ROLE_OPTIONS}
                      />
                      <div>
                        <p className="field__label">Account status</p>
                        <p style={{ margin: '8px 0' }}>{currentActive(account) ? 'Active — can sign in' : 'Inactive — sign-in blocked'}</p>
                        {account.last_login_at && <p className="muted small">Last sign in: {new Date(account.last_login_at).toLocaleString()}</p>}
                      </div>
                    </div>
                    {currentRole(account) === 'admin' && (
                      <section style={{ marginTop: 14 }}>
                        <h4 style={{ margin: '0 0 8px' }}>Assigned jurisdictions</h4>
                        <p className="muted small">Select all jurisdiction nodes this administrator should oversee. Assigning a region or province includes its descendants.</p>
                        {lguError ? <Alert type="error">{lguError.message}</Alert> : !jurisdictions.length ? <p className="muted small">The official PSGC directory has not been synchronized yet. Open the LGU directory after deployment and check the directory status.</p> : (
                          <div style={{ display: 'grid', gap: 12 }}>
                            <div className="form-row form-row--2" style={{ gap: 10 }}>
                              <SelectField
                                label="1. Island group"
                                value={currentAreaPicker(account.id).islandGroup}
                                onChange={(event) => changeAreaPicker(account.id, 'islandGroup', event.target.value)}
                                options={[{ value: '', label: 'Choose island group…' }, ...childrenFor(null, ['island_group'])]}
                              />
                              <SelectField
                                label="2. Region"
                                value={currentAreaPicker(account.id).region}
                                onChange={(event) => changeAreaPicker(account.id, 'region', event.target.value)}
                                options={[{ value: '', label: 'Choose region…' }, ...childrenFor(currentAreaPicker(account.id).islandGroup, ['region'])]}
                              />
                              <SelectField
                                label="3. Province / independent city / special area"
                                value={currentAreaPicker(account.id).branch}
                                onChange={(event) => changeAreaPicker(account.id, 'branch', event.target.value)}
                                options={[{ value: '', label: 'Choose an area…' }, ...childrenFor(currentAreaPicker(account.id).region, ['province', 'independent_city', 'special_area', 'city', 'municipality'])]}
                              />
                              <SelectField
                                label="4. Component city / municipality"
                                value={currentAreaPicker(account.id).locality}
                                onChange={(event) => changeAreaPicker(account.id, 'locality', event.target.value)}
                                options={[{ value: '', label: 'Optional — choose a locality…' }, ...childrenFor(currentAreaPicker(account.id).branch, ['city', 'municipality'])]}
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <Button
                                size="sm"
                                variant="navy"
                                disabled={!selectedAreaId(account.id) || assignedIds.includes(Number(selectedAreaId(account.id)))}
                                onClick={() => updateAssignments(account.id, Number(selectedAreaId(account.id)), true)}
                              >Add selected area</Button>
                              <span className="muted small">Choose any level. Access includes all descendant areas automatically.</span>
                            </div>
                            <div>
                              <p className="field__label">Assigned access areas ({assignedIds.length})</p>
                              {assignedIds.length ? (
                                <div style={{ display: 'grid', gap: 8 }}>
                                  {assignedIds.map((id) => (
                                    <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
                                      <div style={{ minWidth: 0 }}>
                                        <strong>{jurisdictionById.get(Number(id))?.name || 'Jurisdiction #' + id}</strong>
                                        <p className="muted small" style={{ margin: '3px 0 0', overflowWrap: 'anywhere' }}>{areaPath(id)}</p>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={assignedIds.length <= 1}
                                        onClick={() => updateAssignments(account.id, Number(id), false)}
                                      >Remove</Button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="muted small">No area selected yet. Add at least one area before saving administrator access.</p>
                              )}
                            </div>
                          </div>
                        )}
                      </section>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                      <Button variant="navy" size="sm" loading={busyId === account.id} disabled={!changed || busyId !== null} onClick={() => saveAccess(account)}>Save access changes</Button>
                    </div>
                    {historyId === account.id && (
                      <section style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                        <h4><LuHistory aria-hidden /> Jurisdiction assignment history</h4>
                        {historyError ? <Alert type="error">{historyError}</Alert> : !historyItems.length ? <p className="muted small">No assignment history recorded for this account yet.</p> : (
                          <div style={{ display: 'grid', gap: 8 }}>
                            {historyItems.map((item) => (
                              <div key={item.id} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
                                <strong>{item.action === 'assigned' ? 'Assigned' : 'Revoked'}: {item.lgu_name}</strong>
                                <p className="muted small" style={{ margin: '4px 0 0' }}>{item.jurisdiction_level?.replaceAll('_', ' ')} · {new Date(item.changed_at).toLocaleString()} · By {item.changed_by_name || 'Unknown actor'}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <p className="muted small">Historical reports and audit entries remain in their original LGU. Jurisdiction changes only update authorization scope; they do not move or delete historical records.</p>
      </div>
    </PublicLayout>
  );
}
