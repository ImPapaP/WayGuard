// Platform administrator workspace: create LGU tenants and their first LGU admin.
import { useState } from 'react';
import { LuBuilding2, LuCircleCheck, LuCircleX, LuLogOut, LuShieldCheck, LuUserPlus } from 'react-icons/lu';
import { Link, useNavigate } from '../../lib/router.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';
import { Alert, Button, EmptyState, Loading, SelectField, TextField } from '../../components/ui.jsx';
import { PublicLayout } from '../../components/Shells.jsx';

const EMPTY_FORM = {
  name: '',
  slug: '',
  city: '',
  province: '',
  jurisdiction_level: 'municipality',
  parent_lgu_id: '',
  map_latitude: '',
  map_longitude: '',
  jurisdiction_boundary: '',
  admin_name: '',
  admin_email: '',
  admin_phone: '',
  temporary_password: '',
};

const LEVEL_LABELS = {
  island_group: 'Island group', region: 'Region', province: 'Province',
  independent_city: 'Independent city', special_area: 'Special / non-province area', city: 'Component city',
  municipality: 'Municipality', barangay: 'Barangay',
};
const LEVEL_OPTIONS = Object.entries(LEVEL_LABELS).map(([value, label]) => ({ value, label }));
const PARENT_LEVELS = {
  island_group: [], region: ['island_group'], province: ['region'],
  independent_city: ['region'], special_area: ['region'], city: ['province', 'special_area'], municipality: ['province', 'region', 'special_area'],
  barangay: ['municipality', 'city', 'independent_city'],
};
const LEVEL_ORDER = ['island_group', 'region', 'province', 'independent_city', 'municipality', 'city', 'barangay'];

function parentChoices(items, level, excludeIds = []) {
  return items.filter((item) => item.is_active && !excludeIds.includes(Number(item.id)) && (PARENT_LEVELS[level] || []).includes(item.jurisdiction_level))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({ value: String(item.id), label: item.name + ' — ' + (LEVEL_LABELS[item.jurisdiction_level] || item.jurisdiction_level) }));
}

function childrenIndex(items) {
  const index = new Map();
  items.forEach((item) => {
    if (item.parent_lgu_id == null) return;
    const key = Number(item.parent_lgu_id);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(item);
  });
  for (const children of index.values()) children.sort((a, b) =>
    (LEVEL_ORDER.indexOf(a.jurisdiction_level) - LEVEL_ORDER.indexOf(b.jurisdiction_level)) || a.name.localeCompare(b.name));
  return index;
}

function descendantsOf(id, childrenByParent) {
  const seen = new Set();
  const queue = [...(childrenByParent.get(Number(id)) || [])];
  while (queue.length) {
    const child = queue.shift();
    const key = Number(child.id);
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push(...(childrenByParent.get(key) || []));
  }
  return seen;
}

export default function LGUs() {
  useDocumentTitle('Management workspace');
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/api/platform/lgus');
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyLgu, setBusyLgu] = useState(null);
  const [createdAccount, setCreatedAccount] = useState(null);
  const [boundaryDrafts, setBoundaryDrafts] = useState({});
  const [savingBoundary, setSavingBoundary] = useState(null);
  const [placementDrafts, setPlacementDrafts] = useState({});
  const [savingPlacement, setSavingPlacement] = useState(null);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setLevel = (event) => setForm((current) => ({
    ...current, jurisdiction_level: event.target.value, parent_lgu_id: '',
    city: ['city', 'municipality', 'barangay'].includes(event.target.value) ? current.city : '',
    province: ['city', 'municipality', 'barangay'].includes(event.target.value) ? current.province : '',
  }));
  const items = data?.items || [];
  const childrenByParent = childrenIndex(items);
  const roots = items.filter((item) => item.parent_lgu_id == null || !items.some((candidate) => Number(candidate.id) === Number(item.parent_lgu_id)));
  const islandGroups = roots.filter((item) => item.jurisdiction_level === 'island_group');
  const unplacedRoots = roots.filter((item) => item.jurisdiction_level !== 'island_group');

  function placementFor(lgu) {
    return placementDrafts[lgu.id] || { jurisdiction_level: lgu.jurisdiction_level || 'municipality', parent_lgu_id: lgu.parent_lgu_id == null ? '' : String(lgu.parent_lgu_id) };
  }
  function changePlacement(lgu, key, value) {
    setPlacementDrafts((previous) => ({
      ...previous,
      [lgu.id]: { ...placementFor(lgu), [key]: value, ...(key === 'jurisdiction_level' ? { parent_lgu_id: '' } : {}) },
    }));
  }
  async function savePlacement(lgu) {
    const draft = placementFor(lgu);
    setSavingPlacement(lgu.id);
    try {
      await api.patch('/api/platform/lgus/' + lgu.id, {
        jurisdiction_level: draft.jurisdiction_level,
        parent_lgu_id: draft.parent_lgu_id ? Number(draft.parent_lgu_id) : null,
      });
      setPlacementDrafts((old) => { const next = { ...old }; delete next[lgu.id]; return next; });
      toast('Hierarchy placement saved for ' + lgu.name + '.');
      reload();
    } catch (err) {
      toast(err.message || 'Could not update this jurisdiction placement.', { type: 'error' });
    } finally { setSavingPlacement(null); }
  }

  function renderNode(lgu, depth = 0, visited = new Set()) {
    const id = Number(lgu.id);
    if (visited.has(id)) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(id);
    const descendants = childrenByParent.get(id) || [];
    const draft = placementFor(lgu);
    const blocked = descendantsOf(id, childrenByParent);
    const choices = parentChoices(items, draft.jurisdiction_level, [id, ...blocked]);
    const currentParent = items.find((item) => Number(item.id) === Number(draft.parent_lgu_id));
    const hierarchyValid = draft.jurisdiction_level === 'island_group'
      ? !draft.parent_lgu_id
      : choices.some((option) => option.value === String(draft.parent_lgu_id));
    return (
      <article key={id} style={{ marginLeft: depth ? 16 : 0, padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: depth ? 'var(--surface)' : 'var(--surface-sunken)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <span className="badge">{LEVEL_LABELS[lgu.jurisdiction_level] || lgu.jurisdiction_level || 'Unclassified'}</span>
            <h3 style={{ margin: '8px 0 3px' }}>{lgu.name}</h3>
            <p className="muted small" style={{ margin: 0 }}>
              {currentParent ? 'Under ' + currentParent.name : (lgu.jurisdiction_level === 'island_group' ? 'Top-level island group' : 'Not assigned to an island-group hierarchy')}
              {' · '}{lgu.staff_count ?? 0} staff/crews · {lgu.report_count ?? 0} reports
            </p>
          </div>
          <span className={'badge ' + (lgu.is_active ? 'badge--resolved' : 'badge--rejected')}>{lgu.is_active ? 'Active' : 'Inactive'}</span>
        </div>
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Manage hierarchy, boundary and status</summary>
          <div className="form-stack" style={{ marginTop: 12 }}>
            <h4 style={{ margin: 0 }}>Hierarchy placement</h4>
            <div className="form-row form-row--2">
              <SelectField label="Jurisdiction level" value={draft.jurisdiction_level} onChange={(event) => changePlacement(lgu, 'jurisdiction_level', event.target.value)} options={LEVEL_OPTIONS} />
              {draft.jurisdiction_level === 'island_group' ? (
                <div className="field"><span className="field__label">Parent jurisdiction</span><div className="input" style={{ display: 'flex', alignItems: 'center' }}>None — root level</div></div>
              ) : (
                <SelectField label="Parent jurisdiction" value={draft.parent_lgu_id} onChange={(event) => changePlacement(lgu, 'parent_lgu_id', event.target.value)} options={[
                  { value: '', label: 'Select the required parent…' }, ...choices,
                ]} />
              )}
            </div>
            {!hierarchyValid && draft.jurisdiction_level !== 'island_group' && <p className="small" style={{ color: 'var(--danger, #b42318)', margin: 0 }}>Choose a valid parent: {(PARENT_LEVELS[draft.jurisdiction_level] || []).map((level) => LEVEL_LABELS[level]).join(' or ')}.</p>}
            <Button size="sm" variant="navy" loading={savingPlacement === lgu.id} disabled={!hierarchyValid || (draft.jurisdiction_level !== 'island_group' && !draft.parent_lgu_id)} onClick={() => savePlacement(lgu)}>Save hierarchy placement</Button>
            <hr />
            <h4 style={{ margin: 0 }}>Jurisdiction boundary</h4>
            <label className="field">
              <span className="field__label">Boundary (GeoJSON)</span>
              <textarea className="input" rows={4} spellCheck={false} value={boundaryDrafts[lgu.id] ?? (lgu.jurisdiction_boundary ? JSON.stringify(lgu.jurisdiction_boundary, null, 2) : '')} onChange={(event) => setBoundaryDrafts((old) => ({ ...old, [lgu.id]: event.target.value }))} placeholder="Paste GeoJSON Polygon or MultiPolygon" />
              <span className="field__hint">{lgu.jurisdiction_boundary ? 'Boundary configured. Empty field removes it.' : 'No boundary configured yet.'} Coordinates must be [longitude, latitude].</span>
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" variant="navy" loading={savingBoundary === lgu.id} onClick={() => saveBoundary(lgu)}>Save boundary</Button>
              <Button size="sm" variant={lgu.is_active ? 'secondary' : 'navy'} loading={busyLgu === lgu.id} onClick={() => toggleLgu(lgu)}>
                {lgu.is_active ? <><LuCircleX aria-hidden /> Deactivate</> : <><LuCircleCheck aria-hidden /> Reactivate</>}
              </Button>
            </div>
          </div>
        </details>
        {descendants.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '8px 0' }}>
              View {descendants.length} direct subjurisdiction{descendants.length === 1 ? '' : 's'}
            </summary>
            <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
              {descendants.map((child) => renderNode(child, depth + 1, nextVisited))}
            </div>
          </details>
        )}
      </article>
    );
  }

  async function createLgu(event) {
    event.preventDefault();
    setFormError(null);
    setCreatedAccount(null);
    setBusy(true);
    try {
      const result = await api.post('/api/platform/lgus', {
        ...form,
        parent_lgu_id: form.parent_lgu_id ? Number(form.parent_lgu_id) : null,
        slug: form.slug.trim() || undefined,
        admin_phone: form.admin_phone.trim() || null,
        jurisdiction_boundary: form.jurisdiction_boundary.trim() ? JSON.parse(form.jurisdiction_boundary) : undefined,
      });
      setCreatedAccount({
        lguName: result.lgu.name,
        adminEmail: result.admin.email,
        temporaryPassword: form.temporary_password,
      });
      setForm(EMPTY_FORM);
      toast(`${result.lgu.name} was created with its own LGU administrator.`);
      reload();
    } catch (err) {
      setFormError(err instanceof SyntaxError ? { message: 'Jurisdiction boundary must be valid GeoJSON.' } : err);
    } finally {
      setBusy(false);
    }
  }

  async function saveBoundary(lgu) {
    setSavingBoundary(lgu.id);
    try {
      const raw = (boundaryDrafts[lgu.id] ?? (lgu.jurisdiction_boundary ? JSON.stringify(lgu.jurisdiction_boundary, null, 2) : '')).trim();
      await api.patch(`/api/platform/lgus/${lgu.id}`, { jurisdiction_boundary: raw ? JSON.parse(raw) : null });
      toast(`Jurisdiction boundary saved for ${lgu.name}.`);
      reload();
    } catch (err) {
      toast(err instanceof SyntaxError ? 'Enter valid GeoJSON before saving.' : err.message || 'Could not save the boundary.', { type: 'error' });
    } finally { setSavingBoundary(null); }
  }

  async function toggleLgu(lgu) {
    setBusyLgu(lgu.id);
    try {
      await api.patch(`/api/platform/lgus/${lgu.id}`, { is_active: !lgu.is_active });
      toast(`${lgu.name} is now ${lgu.is_active ? 'inactive' : 'active'}.`);
      reload();
    } catch (err) {
      toast(err.message || 'Could not update the LGU.', { type: 'error' });
    } finally {
      setBusyLgu(null);
    }
  }

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  const fieldErrors = formError?.fields || {};
  return (
    <PublicLayout>
      <div className="container page">
        <div className="page-head" style={{ alignItems: 'flex-start' }}>
          <div>
            <p className="eyebrow"><LuShieldCheck aria-hidden /> Platform administration</p>
            <h1>Management workspace</h1>
            <p className="muted">Manage the jurisdiction hierarchy, provision LGU workspaces, and define the geographic scope used by administrators.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="small muted">{user?.full_name}</span>
            <Link to="/platform/accounts" className="btn btn--navy btn--sm"><LuUserPlus aria-hidden /> Accounts &amp; assignments</Link>
            <Button variant="secondary" onClick={signOut}><LuLogOut aria-hidden /> Sign out</Button>
          </div>
        </div>

        <section className="panel" style={{ marginBottom: 20 }} aria-labelledby="management-scope-title">
          <div className="panel__head">
            <h2 id="management-scope-title"><LuShieldCheck aria-hidden /> Management scope</h2>
          </div>
          <p className="muted">Management provisions LGU workspaces and controls the top-level administrator assignment. Each LGU administrator manages that workspace's accounts, agencies, maintenance teams and operational records.</p>
          <div className="form-row form-row--3">
            <div><strong>1. Management</strong><p className="muted small">Platform-wide workspace and jurisdiction oversight</p></div>
            <div><strong>2. LGU administrator</strong><p className="muted small">Accounts, agencies and teams within one LGU</p></div>
            <div><strong>3. Staff and crews</strong><p className="muted small">Operational access assigned by the LGU</p></div>
          </div>
          <p className="small muted">Create the geographic hierarchy first, then use Accounts & assignments to grant administrators access to a region, province, city or municipality and its descendants.</p>
        </section>
        <div className="form-row form-row--2" style={{ alignItems: 'start' }}>
          <section className="panel">
            <div className="panel__head">
              <h2><LuUserPlus aria-hidden /> Create an LGU</h2>
            </div>
            <p className="muted small">The administrator you create here is automatically assigned to this LGU and must change the temporary password after signing in.</p>
            {formError && <Alert type="error">{formError.message}</Alert>}
            <form className="form-stack" onSubmit={createLgu} noValidate>
              <div className="form-row form-row--2">
                <SelectField label="Jurisdiction level" value={form.jurisdiction_level} onChange={setLevel} options={LEVEL_OPTIONS} error={fieldErrors.jurisdiction_level} />
                {form.jurisdiction_level === 'island_group' ? (
                  <div className="field"><span className="field__label">Parent jurisdiction</span><div className="input" style={{ display: 'flex', alignItems: 'center' }}>None — island groups are the root</div></div>
                ) : (
                  <SelectField label="Parent jurisdiction (required)" value={form.parent_lgu_id} onChange={set('parent_lgu_id')} options={[
                    { value: '', label: 'Select the required parent…' }, ...parentChoices(items, form.jurisdiction_level),
                  ]} error={fieldErrors.parent_lgu_id} />
                )}
              </div>
              <TextField label="Jurisdiction / workspace name" value={form.name} onChange={set('name')} error={fieldErrors.name} placeholder={form.jurisdiction_level === 'island_group' ? 'e.g. Luzon' : form.jurisdiction_level === 'region' ? 'e.g. Central Luzon' : 'Enter official jurisdiction name'} required />
              {['city', 'municipality', 'barangay'].includes(form.jurisdiction_level) && (
                <div className="form-row form-row--2">
                  <TextField label={form.jurisdiction_level === 'city' ? 'Component city' : form.jurisdiction_level === 'municipality' ? 'Municipality' : 'Barangay'} value={form.city} onChange={set('city')} error={fieldErrors.city} />
                  <TextField label="Province (display context)" value={form.province} onChange={set('province')} error={fieldErrors.province} />
                </div>
              )}
              <p className="muted small">Required parent chain: Island Group → Region → Province and Independent City → Municipality and Component City. Independent cities are placed directly under their region.</p>
              <div className="form-row form-row--2">
                <TextField label="Map latitude (optional)" type="number" step="any" value={form.map_latitude} onChange={set('map_latitude')} error={fieldErrors.map_latitude} placeholder="e.g. 14.7678" />
                <TextField label="Map longitude (optional)" type="number" step="any" value={form.map_longitude} onChange={set('map_longitude')} error={fieldErrors.map_longitude} placeholder="e.g. 120.9586" />
              </div>
              <p className="muted small">Enter both coordinates for this LGU's default map centre. You can also set the centre later in System settings.</p>
              <TextField label="Workspace slug" value={form.slug} onChange={set('slug')} error={fieldErrors.slug} placeholder="Optional, e.g. meycauayan" hint="Optional. Used as a stable identifier for this workspace." />
              <label className="field"><span className="field__label">Jurisdiction boundary (GeoJSON, optional)</span><textarea className="input" rows={5} value={form.jurisdiction_boundary} onChange={set('jurisdiction_boundary')} placeholder="Paste GeoJSON Polygon or MultiPolygon" spellCheck={false} /><span className="field__hint">Use the official municipality boundary. Coordinates must be [longitude, latitude].</span></label>
              <hr />
              <h3>First LGU administrator</h3>
              <TextField label="Administrator full name" value={form.admin_name} onChange={set('admin_name')} error={fieldErrors.admin_name} required />
              <TextField label="Administrator e-mail" type="email" value={form.admin_email} onChange={set('admin_email')} error={fieldErrors.admin_email} required />
              <TextField label="Mobile number" type="tel" value={form.admin_phone} onChange={set('admin_phone')} error={fieldErrors.admin_phone} />
              <TextField label="Temporary password" type="text" value={form.temporary_password} onChange={set('temporary_password')} error={fieldErrors.temporary_password} hint="Use at least 8 characters, including a letter and a number. Share it securely." required />
              <Button type="submit" variant="navy" size="lg" loading={busy} block><LuBuilding2 aria-hidden /> Create LGU and administrator</Button>
            </form>
            {createdAccount && (
              <div style={{ marginTop: 20 }}>
                <Alert type="success" title="LGU created successfully">
                  <p><strong>{createdAccount.lguName}</strong> is ready.</p>
                  <p>Administrator: <strong>{createdAccount.adminEmail}</strong></p>
                  <p>Temporary password: <strong>{createdAccount.temporaryPassword}</strong></p>
                  <p className="small">Save these credentials and share them securely. This message disappears if you leave this page.</p>
                  <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(`LGU: ${createdAccount.lguName}\nAdministrator: ${createdAccount.adminEmail}\nTemporary password: ${createdAccount.temporaryPassword}`)}>Copy credentials</Button>
                </Alert>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel__head">
              <h2><LuBuilding2 aria-hidden /> Registered LGUs</h2>
              <span className="badge">{data?.items?.length ?? 0}</span>
            </div>
            {loading ? <Loading label="Loading LGUs…" /> : error ? <Alert type="error">{error.message}</Alert> : !data?.items?.length ? (
              <EmptyState title="No LGUs yet" description="Create the first local government workspace using the form." />
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                <div className="panel" style={{ background: 'var(--surface-sunken)', padding: 14 }}>
                  <strong>Jurisdiction hierarchy</strong>
                  <p className="muted small" style={{ margin: '6px 0 10px' }}>Island Group → Region → Province / Independent City → Municipality / Component City → Barangay</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {LEVEL_OPTIONS.map((level) => <span key={level.value} className="badge">{level.label}</span>)}
                  </div>
                  <p className="muted small" style={{ margin: '10px 0 0' }}>Directory source: Philippine Statistics Authority (PSA), PSGC, 2026-Q2 publication (30 June 2026), checked against the official Q3 2026 release (30 September 2026). The Q3 release's changes did not alter these region, province, city or municipality entries. Island groups are organizational groupings for WayGuard.</p>
                </div>
                {islandGroups.length > 0 ? (
                  <div style={{ display: 'grid', gap: 12 }}>{islandGroups.map((lgu) => renderNode(lgu))}</div>
                ) : (
                  <EmptyState title="Start with an island group" description="Create Luzon, Visayas or Mindanao first. Regions must be placed under an island group." />
                )}
                {unplacedRoots.length > 0 && (
                  <section className="panel" style={{ borderColor: 'var(--warning, #d97706)' }}>
                    <h3 style={{ marginTop: 0 }}>Needs hierarchy placement</h3>
                    <p className="muted small">These existing or legacy records are not connected to an island-group node. Open each one to assign its correct level and parent.</p>
                    <div style={{ display: 'grid', gap: 10 }}>{unplacedRoots.map((lgu) => renderNode(lgu))}</div>
                  </section>
                )}
              </div>
            )}
            <p className="muted small" style={{ marginTop: 16 }}>An inactive LGU's personnel can no longer sign in. Its historical records are retained and become available again if reactivated.</p>
          </section>
        </div>
        <p className="small muted" style={{ marginTop: 20 }}>Need help? Go back to the <Link to="/">public Wayguard site</Link>.</p>
      </div>
    </PublicLayout>
  );
}
