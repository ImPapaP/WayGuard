// Platform administrator workspace: browse the PSGC jurisdiction directory,
// manage each jurisdiction's placement, boundary and status, and create
// custom LGU workspaces with their first LGU administrator.
import { useMemo, useState } from 'react';
import {
  LuBuilding2,
  LuChevronRight,
  LuCircleCheck,
  LuCircleX,
  LuLogOut,
  LuMapPinned,
  LuPlus,
  LuSearch,
  LuSettings2,
  LuShieldCheck,
  LuUserCheck,
  LuUserPlus,
  LuUsers,
  LuFileWarning,
} from 'react-icons/lu';
import { Link, useNavigate } from '../../lib/router.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';
import { Alert, Button, EmptyState, Loading, Modal, SelectField, TextField } from '../../components/ui.jsx';
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
const LEVEL_ORDER = ['island_group', 'region', 'province', 'special_area', 'independent_city', 'municipality', 'city', 'barangay'];
const LOCAL_LEVELS = ['independent_city', 'city', 'municipality'];
const PAGE = 60;

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
  for (const children of index.values()) children.sort(byLevelThenName);
  return index;
}

function byLevelThenName(a, b) {
  return (LEVEL_ORDER.indexOf(a.jurisdiction_level) - LEVEL_ORDER.indexOf(b.jurisdiction_level)) || a.name.localeCompare(b.name);
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

// "Bulacan · Central Luzon" — the ancestors below the island group.
function pathOf(item, byId) {
  const names = [];
  const seen = new Set();
  let parent = byId.get(Number(item.parent_lgu_id));
  while (parent && !seen.has(parent.id) && parent.jurisdiction_level !== 'island_group') {
    seen.add(parent.id);
    names.push(parent.name);
    parent = byId.get(Number(parent.parent_lgu_id));
  }
  return names.join(' · ');
}

function LevelBadge({ level }) {
  return <span className={`lgu-level lgu-level--${level || 'none'}`}>{LEVEL_LABELS[level] || 'Unclassified'}</span>;
}

function LguRow({ lgu, depth = 0, path, childCount = 0, expanded, onToggle, onManage }) {
  return (
    <div className={`lgu-row${lgu.is_active ? '' : ' is-inactive'}`} style={{ '--depth': depth }} role="listitem">
      <div className="lgu-row__name">
        {onToggle && childCount > 0 ? (
          <button
            type="button"
            className={`lgu-row__toggle${expanded ? ' is-open' : ''}`}
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} ${childCount} areas under ${lgu.name}`}
          >
            <LuChevronRight aria-hidden />
          </button>
        ) : (
          onToggle && <span className="lgu-row__toggle-spacer" aria-hidden />
        )}
        <div className="lgu-row__title">
          <strong>{lgu.name}</strong>
          <span className="lgu-row__meta">
            <LevelBadge level={lgu.jurisdiction_level} />
            {path && <span className="lgu-row__path">{path}</span>}
            {onToggle && childCount > 0 && <span className="lgu-row__path">{childCount} under it</span>}
          </span>
        </div>
      </div>
      <div className="lgu-row__admin">
        {lgu.administrator_name ? (
          <span title="LGU administrator"><LuUserCheck aria-hidden /> {lgu.administrator_name}</span>
        ) : (
          <span className="muted">No administrator</span>
        )}
      </div>
      <div className="lgu-row__counts">
        <span title="Active staff and crews"><LuUsers aria-hidden /> {lgu.staff_count ?? 0}</span>
        <span title="Reports"><LuMapPinned aria-hidden /> {lgu.report_count ?? 0}</span>
      </div>
      <div className="lgu-row__status">
        <span className={'badge ' + (lgu.is_active ? 'badge--resolved' : 'badge--rejected')}>{lgu.is_active ? 'Active' : 'Inactive'}</span>
      </div>
      <div className="lgu-row__actions">
        <Button size="sm" variant="secondary" onClick={() => onManage(lgu)} aria-label={`Manage ${lgu.name}`}>
          <LuSettings2 aria-hidden /> Manage
        </Button>
      </div>
    </div>
  );
}

export default function LGUs() {
  useDocumentTitle('Management workspace');
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/api/platform/lgus');

  // Directory view
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [adminFilter, setAdminFilter] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [shown, setShown] = useState(PAGE);

  // Create form
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [createdAccount, setCreatedAccount] = useState(null);

  // Manage dialog
  const [managingId, setManagingId] = useState(null);
  const [busyLgu, setBusyLgu] = useState(null);
  const [boundaryDrafts, setBoundaryDrafts] = useState({});
  const [savingBoundary, setSavingBoundary] = useState(null);
  const [placementDrafts, setPlacementDrafts] = useState({});
  const [savingPlacement, setSavingPlacement] = useState(null);

  const items = data?.items || [];
  const { byId, childrenByParent, islandGroups, unplacedRoots, stats } = useMemo(() => {
    const map = new Map(items.map((item) => [Number(item.id), item]));
    const children = childrenIndex(items);
    const roots = items.filter((item) => item.parent_lgu_id == null || !map.has(Number(item.parent_lgu_id)));
    return {
      byId: map,
      childrenByParent: children,
      islandGroups: roots.filter((item) => item.jurisdiction_level === 'island_group').sort(byLevelThenName),
      unplacedRoots: roots.filter((item) => item.jurisdiction_level !== 'island_group').sort(byLevelThenName),
      stats: {
        total: items.length,
        local: items.filter((item) => LOCAL_LEVELS.includes(item.jurisdiction_level)).length,
        withAdmin: items.filter((item) => item.administrator_name).length,
        reports: items.reduce((sum, item) => sum + (item.report_count || 0), 0),
        inactive: items.filter((item) => !item.is_active).length,
      },
    };
  }, [items]);

  const filtering = Boolean(search.trim() || levelFilter || statusFilter || adminFilter);
  const results = useMemo(() => {
    if (!filtering) return [];
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items
      .filter((item) => {
        if (levelFilter && item.jurisdiction_level !== levelFilter) return false;
        if (statusFilter === 'active' && !item.is_active) return false;
        if (statusFilter === 'inactive' && item.is_active) return false;
        if (adminFilter === 'with' && !item.administrator_name) return false;
        if (adminFilter === 'without' && item.administrator_name) return false;
        if (!words.length) return true;
        const hay = [item.name, item.province, item.city, item.psgc_code, item.slug, item.administrator_name, pathOf(item, byId)]
          .filter(Boolean).join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => {
        const q = search.trim().toLowerCase();
        const exact = Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q));
        return exact || byLevelThenName(a, b);
      });
  }, [filtering, items, search, levelFilter, statusFilter, adminFilter, byId]);

  const managing = managingId == null ? null : byId.get(Number(managingId)) || null;

  const resetPaging = () => setShown(PAGE);
  const toggle = (id) => setExpanded((old) => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const clearFilters = () => {
    setSearch('');
    setLevelFilter('');
    setStatusFilter('');
    setAdminFilter('');
    resetPaging();
  };

  // ---- placement, boundary, status ----------------------------------------
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

  // ---- create custom LGU ---------------------------------------------------
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setLevel = (event) => setForm((current) => ({
    ...current, jurisdiction_level: event.target.value, parent_lgu_id: '',
    city: ['city', 'municipality', 'barangay'].includes(event.target.value) ? current.city : '',
    province: ['city', 'municipality', 'barangay'].includes(event.target.value) ? current.province : '',
  }));
  async function createLgu(event) {
    event?.preventDefault();
    setFormError(null);
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
      setCreating(false);
      toast(`${result.lgu.name} was created with its own LGU administrator.`);
      reload();
    } catch (err) {
      setFormError(err instanceof SyntaxError ? { message: 'Jurisdiction boundary must be valid GeoJSON.' } : err);
    } finally {
      setBusy(false);
    }
  }
  async function copyCredentials() {
    const text = `LGU: ${createdAccount.lguName}\nAdministrator: ${createdAccount.adminEmail}\nTemporary password: ${createdAccount.temporaryPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Credentials copied.');
    } catch {
      toast('Could not copy automatically — select the text and copy it.', { type: 'error' });
    }
  }

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  // ---- tree rendering -------------------------------------------------------
  function renderTree(nodes, depth, visited) {
    return nodes.map((lgu) => {
      const id = Number(lgu.id);
      if (visited.has(id)) return null;
      const next = new Set(visited).add(id);
      const children = childrenByParent.get(id) || [];
      const open = expanded.has(id);
      return (
        <div key={id} className="lgu-tree__node">
          <LguRow
            lgu={lgu}
            depth={depth}
            childCount={children.length}
            expanded={open}
            onToggle={() => toggle(id)}
            onManage={(l) => setManagingId(l.id)}
          />
          {open && children.length > 0 && <div role="list">{renderTree(children, depth + 1, next)}</div>}
        </div>
      );
    });
  }

  const fieldErrors = formError?.fields || {};
  const visibleResults = results.slice(0, shown);

  return (
    <PublicLayout>
      <div className="container page platform">
        <div className="page-head platform__head">
          <div>
            <p className="eyebrow"><LuShieldCheck aria-hidden /> Platform administration</p>
            <h1>Management workspace</h1>
            <p className="muted">The official Philippine jurisdictions (PSGC) and every LGU workspace on Wayguard.</p>
          </div>
          <div className="platform__head-actions">
            <div className="platform__buttons">
              <Button variant="primary" onClick={() => { setFormError(null); setCreating(true); }}>
                <LuPlus aria-hidden /> Add custom LGU
              </Button>
              <Link to="/platform/accounts" className="btn btn--navy"><LuUserPlus aria-hidden /> Accounts &amp; assignments</Link>
              <Link to="/platform/compare" className="btn btn--secondary">Compare LGUs</Link>
              <Button variant="secondary" onClick={signOut}><LuLogOut aria-hidden /> Sign out</Button>
            </div>
            <span className="small muted">Signed in as <strong>{user?.full_name}</strong></span>
          </div>
        </div>

        {createdAccount && (
          <Alert type="success" title={`${createdAccount.lguName} is ready`} className="platform__created">
            <p>Administrator: <strong>{createdAccount.adminEmail}</strong> · Temporary password: <strong className="mono">{createdAccount.temporaryPassword}</strong></p>
            <p className="small">Share these securely. The administrator must choose a new password at first sign-in. This message disappears when you leave the page.</p>
            <div className="platform__buttons">
              <Button size="sm" variant="secondary" onClick={copyCredentials}>Copy credentials</Button>
              <Button size="sm" variant="secondary" onClick={() => setCreatedAccount(null)}>Dismiss</Button>
            </div>
          </Alert>
        )}

        {!loading && !error && (
          <div className="platform-stats" aria-label="Directory summary">
            <div className="platform-stat"><LuBuilding2 aria-hidden /><strong>{stats.total.toLocaleString()}</strong><span>jurisdictions</span></div>
            <div className="platform-stat"><LuMapPinned aria-hidden /><strong>{stats.local.toLocaleString()}</strong><span>cities &amp; municipalities</span></div>
            <div className="platform-stat"><LuUserCheck aria-hidden /><strong>{stats.withAdmin.toLocaleString()}</strong><span>with an LGU administrator</span></div>
            <div className="platform-stat"><LuFileWarning aria-hidden /><strong>{stats.reports.toLocaleString()}</strong><span>reports</span></div>
            <div className="platform-stat"><LuCircleX aria-hidden /><strong>{stats.inactive.toLocaleString()}</strong><span>inactive</span></div>
          </div>
        )}

        <ol className="platform-flow" aria-label="How access works">
          <li><strong>Platform management</strong><span>You: the directory, LGU workspaces and who manages which area.</span></li>
          <li><strong>Area administrators</strong><span>Assigned to a region, province, city or municipality; access includes every area under it.</span></li>
          <li><strong>LGU staff and road crews</strong><span>Created by the LGU administrator for day-to-day work.</span></li>
        </ol>

        <section className="panel platform-dir" aria-labelledby="dir-title">
          <div className="panel__head">
            <h2 id="dir-title"><LuBuilding2 aria-hidden /> Jurisdiction directory</h2>
            {filtering && <span className="badge">{results.length.toLocaleString()} found</span>}
          </div>

          <div className="platform-dir__filters">
            <div className="search-input">
              <LuSearch aria-hidden />
              <input
                className="input"
                type="search"
                placeholder="Search a city, municipality, province, region or PSGC code"
                aria-label="Search jurisdictions"
                value={search}
                onChange={(e) => { setSearch(e.target.value); resetPaging(); }}
              />
            </div>
            <select className="select select--sm" aria-label="Jurisdiction level" value={levelFilter} onChange={(e) => { setLevelFilter(e.target.value); resetPaging(); }}>
              <option value="">All levels</option>
              {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className="select select--sm" aria-label="Administrator" value={adminFilter} onChange={(e) => { setAdminFilter(e.target.value); resetPaging(); }}>
              <option value="">Any administrator</option>
              <option value="with">Has an administrator</option>
              <option value="without">No administrator yet</option>
            </select>
            <select className="select select--sm" aria-label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); resetPaging(); }}>
              <option value="">Active and inactive</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
            {filtering && <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>}
          </div>

          {loading ? <Loading label="Loading the directory…" /> : error ? <Alert type="error">{error.message}</Alert> : !items.length ? (
            <EmptyState title="No jurisdictions yet" description="The PSGC directory loads when the server starts. Restart the service, or add a custom LGU." />
          ) : (
            <>
              <div className="lgu-list__head" aria-hidden>
                <span>Jurisdiction</span><span>LGU administrator</span><span>Staff · Reports</span><span>Status</span><span />
              </div>
              {filtering ? (
                results.length ? (
                  <>
                    <div role="list" className="lgu-list">
                      {visibleResults.map((lgu) => (
                        <LguRow key={lgu.id} lgu={lgu} path={pathOf(lgu, byId)} onManage={(l) => setManagingId(l.id)} />
                      ))}
                    </div>
                    {results.length > shown && (
                      <div className="platform-dir__more">
                        <span className="small muted">Showing {shown} of {results.length.toLocaleString()}</span>
                        <Button size="sm" variant="secondary" onClick={() => setShown((n) => n + PAGE)}>Show more</Button>
                      </div>
                    )}
                  </>
                ) : (
                  <EmptyState icon={LuSearch} title="No matching jurisdictions" description="Check the spelling, or clear the filters." />
                )
              ) : (
                <>
                  <div role="list" className="lgu-list lgu-tree">{renderTree(islandGroups, 0, new Set())}</div>
                  {unplacedRoots.length > 0 && (
                    <div className="platform-dir__unplaced">
                      <h3>Needs hierarchy placement</h3>
                      <p className="muted small">Not connected to an island group. Open each one and choose its level and parent.</p>
                      <div role="list" className="lgu-list">
                        {unplacedRoots.map((lgu) => <LguRow key={lgu.id} lgu={lgu} onManage={(l) => setManagingId(l.id)} />)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <p className="muted small platform-dir__note">
            Source: Philippine Statistics Authority (PSA), PSGC 2026-Q2 publication (30 June 2026), checked against the Q3 2026 release (30 September 2026).
            Island groups are Wayguard's own grouping. Deactivating an LGU stops its personnel from signing in; its records are kept and return if it is reactivated.
          </p>
        </section>
      </div>

      {managing && (
        <ManageDialog
          lgu={managing}
          items={items}
          byId={byId}
          childrenByParent={childrenByParent}
          draft={placementFor(managing)}
          onChangePlacement={(key, value) => changePlacement(managing, key, value)}
          onSavePlacement={() => savePlacement(managing)}
          savingPlacement={savingPlacement === managing.id}
          boundary={boundaryDrafts[managing.id] ?? (managing.jurisdiction_boundary ? JSON.stringify(managing.jurisdiction_boundary, null, 2) : '')}
          onBoundary={(value) => setBoundaryDrafts((old) => ({ ...old, [managing.id]: value }))}
          onSaveBoundary={() => saveBoundary(managing)}
          savingBoundary={savingBoundary === managing.id}
          onToggle={() => toggleLgu(managing)}
          toggling={busyLgu === managing.id}
          onClose={() => setManagingId(null)}
        />
      )}

      {creating && (
        <Modal
          title="Add a custom LGU"
          className="modal--workspace platform-create"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
              <Button variant="navy" loading={busy} onClick={createLgu}><LuBuilding2 aria-hidden /> Create LGU and administrator</Button>
            </>
          }
        >
          <p className="muted small">
            Every official PSGC area is already in the directory — to give one an administrator, use{' '}
            <Link to="/platform/accounts">Accounts &amp; assignments</Link>. Use this only for a workspace that is not in the official list.
          </p>
          {formError && <Alert type="error">{formError.message}</Alert>}
          <form className="form-stack" onSubmit={createLgu} noValidate>
            <h3 className="platform-create__step">1. Where it belongs</h3>
            <div className="form-row form-row--2">
              <SelectField label="Jurisdiction level" value={form.jurisdiction_level} onChange={setLevel} options={LEVEL_OPTIONS} error={fieldErrors.jurisdiction_level} />
              {form.jurisdiction_level === 'island_group' ? (
                <div className="field"><span className="field__label">Parent jurisdiction</span><div className="input platform-create__none">None — island groups are the top level</div></div>
              ) : (
                <SelectField
                  label="Parent jurisdiction"
                  value={form.parent_lgu_id}
                  onChange={set('parent_lgu_id')}
                  options={[{ value: '', label: 'Choose the parent…' }, ...parentChoices(items, form.jurisdiction_level)]}
                  error={fieldErrors.parent_lgu_id}
                />
              )}
            </div>
            {form.jurisdiction_level !== 'island_group' && (
              <p className="muted small platform-create__rule">
                A {LEVEL_LABELS[form.jurisdiction_level].toLowerCase()} goes under a {(PARENT_LEVELS[form.jurisdiction_level] || []).map((l) => LEVEL_LABELS[l].toLowerCase()).join(' or ')}.
              </p>
            )}
            <TextField
              label="Name"
              value={form.name}
              onChange={set('name')}
              error={fieldErrors.name}
              placeholder={form.jurisdiction_level === 'island_group' ? 'e.g. Luzon' : form.jurisdiction_level === 'region' ? 'e.g. Central Luzon' : 'Official name'}
              required
            />
            {['city', 'municipality', 'barangay'].includes(form.jurisdiction_level) && (
              <div className="form-row form-row--2">
                <TextField label={form.jurisdiction_level === 'city' ? 'Component city' : form.jurisdiction_level === 'municipality' ? 'Municipality' : 'Barangay'} value={form.city} onChange={set('city')} error={fieldErrors.city} />
                <TextField label="Province" optional value={form.province} onChange={set('province')} error={fieldErrors.province} />
              </div>
            )}

            <details className="platform-create__more">
              <summary>Map centre, identifier and boundary (optional)</summary>
              <div className="form-stack">
                <div className="form-row form-row--2">
                  <TextField label="Map latitude" type="number" step="any" value={form.map_latitude} onChange={set('map_latitude')} error={fieldErrors.map_latitude} placeholder="e.g. 14.7678" />
                  <TextField label="Map longitude" type="number" step="any" value={form.map_longitude} onChange={set('map_longitude')} error={fieldErrors.map_longitude} placeholder="e.g. 120.9586" />
                </div>
                <TextField label="Workspace slug" value={form.slug} onChange={set('slug')} error={fieldErrors.slug} placeholder="e.g. meycauayan" hint="A stable identifier. Leave blank to create one from the name." />
                <label className="field">
                  <span className="field__label">Boundary (GeoJSON Polygon or MultiPolygon)</span>
                  <textarea className="input mono" rows={4} value={form.jurisdiction_boundary} onChange={set('jurisdiction_boundary')} placeholder='{"type":"Polygon","coordinates":[[[120.95,14.76], …]]}' spellCheck={false} />
                  <span className="field__hint">Coordinates are [longitude, latitude].</span>
                </label>
              </div>
            </details>

            <h3 className="platform-create__step">2. First LGU administrator</h3>
            <div className="form-row form-row--2">
              <TextField label="Full name" value={form.admin_name} onChange={set('admin_name')} error={fieldErrors.admin_name} required />
              <TextField label="E-mail" type="email" value={form.admin_email} onChange={set('admin_email')} error={fieldErrors.admin_email} required />
            </div>
            <div className="form-row form-row--2">
              <TextField label="Mobile number" optional type="tel" value={form.admin_phone} onChange={set('admin_phone')} error={fieldErrors.admin_phone} />
              <TextField label="Temporary password" type="text" value={form.temporary_password} onChange={set('temporary_password')} error={fieldErrors.temporary_password} hint="8+ characters with a letter and a number. They must change it at first sign-in." required />
            </div>
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        </Modal>
      )}
    </PublicLayout>
  );
}

function ManageDialog({
  lgu, items, byId, childrenByParent, draft, onChangePlacement, onSavePlacement, savingPlacement,
  boundary, onBoundary, onSaveBoundary, savingBoundary, onToggle, toggling, onClose,
}) {
  const id = Number(lgu.id);
  const blocked = descendantsOf(id, childrenByParent);
  const choices = parentChoices(items, draft.jurisdiction_level, [id, ...blocked]);
  const isRoot = draft.jurisdiction_level === 'island_group';
  const hierarchyValid = isRoot ? !draft.parent_lgu_id : choices.some((option) => option.value === String(draft.parent_lgu_id));
  const changed = draft.jurisdiction_level !== lgu.jurisdiction_level || String(draft.parent_lgu_id || '') !== String(lgu.parent_lgu_id ?? '');
  const path = pathOf(lgu, byId);
  const childCount = (childrenByParent.get(id) || []).length;

  return (
    <Modal title={lgu.name} className="modal--workspace platform-manage" onClose={onClose}>
      <div className="platform-manage__summary">
        <LevelBadge level={lgu.jurisdiction_level} />
        <span className={'badge ' + (lgu.is_active ? 'badge--resolved' : 'badge--rejected')}>{lgu.is_active ? 'Active' : 'Inactive'}</span>
      </div>
      <dl className="platform-manage__facts">
        {path && <><dt>Located in</dt><dd>{path}</dd></>}
        {lgu.psgc_code && <><dt>PSGC code</dt><dd className="mono">{lgu.psgc_code}{lgu.psgc_release ? ` (${lgu.psgc_release})` : ''}</dd></>}
        <dt>LGU administrator</dt><dd>{lgu.administrator_name || <span className="muted">None yet — assign one in <Link to="/platform/accounts">Accounts &amp; assignments</Link></span>}</dd>
        <dt>Staff and crews</dt><dd>{lgu.staff_count ?? 0}</dd>
        <dt>Reports</dt><dd>{lgu.report_count ?? 0}</dd>
        {childCount > 0 && <><dt>Areas under it</dt><dd>{childCount}</dd></>}
      </dl>

      <section className="platform-manage__section">
        <h3>Place in the hierarchy</h3>
        <div className="form-row form-row--2">
          <SelectField label="Jurisdiction level" value={draft.jurisdiction_level} onChange={(e) => onChangePlacement('jurisdiction_level', e.target.value)} options={LEVEL_OPTIONS} />
          {isRoot ? (
            <div className="field"><span className="field__label">Parent jurisdiction</span><div className="input platform-create__none">None — top level</div></div>
          ) : (
            <SelectField
              label="Parent jurisdiction"
              value={draft.parent_lgu_id}
              onChange={(e) => onChangePlacement('parent_lgu_id', e.target.value)}
              options={[{ value: '', label: 'Choose the parent…' }, ...choices]}
            />
          )}
        </div>
        {!isRoot && (
          <p className={`small platform-create__rule${hierarchyValid ? ' muted' : ' platform-create__rule--error'}`}>
            A {LEVEL_LABELS[draft.jurisdiction_level].toLowerCase()} goes under a {(PARENT_LEVELS[draft.jurisdiction_level] || []).map((l) => LEVEL_LABELS[l].toLowerCase()).join(' or ')}.
          </p>
        )}
        <Button size="sm" variant="navy" loading={savingPlacement} disabled={!changed || !hierarchyValid || (!isRoot && !draft.parent_lgu_id)} onClick={onSavePlacement}>
          Save placement
        </Button>
      </section>

      <section className="platform-manage__section">
        <h3>Boundary</h3>
        <label className="field">
          <span className="field__label">GeoJSON Polygon or MultiPolygon</span>
          <textarea className="input mono" rows={5} spellCheck={false} value={boundary} onChange={(e) => onBoundary(e.target.value)} placeholder="Paste the official boundary" />
          <span className="field__hint">{lgu.jurisdiction_boundary ? 'A boundary is set. Clear the field and save to remove it.' : 'No boundary yet.'} Coordinates are [longitude, latitude].</span>
        </label>
        <Button size="sm" variant="navy" loading={savingBoundary} onClick={onSaveBoundary}>Save boundary</Button>
      </section>

      <section className="platform-manage__section platform-manage__danger">
        <h3>{lgu.is_active ? 'Deactivate' : 'Reactivate'}</h3>
        <p className="muted small">
          {lgu.is_active
            ? 'Its administrators, staff and crews can no longer sign in. Reports and history are kept.'
            : 'Its personnel can sign in again and its records become available.'}
        </p>
        <Button size="sm" variant={lgu.is_active ? 'secondary' : 'navy'} loading={toggling} onClick={onToggle}>
          {lgu.is_active ? <><LuCircleX aria-hidden /> Deactivate {lgu.name}</> : <><LuCircleCheck aria-hidden /> Reactivate {lgu.name}</>}
        </Button>
      </section>
    </Modal>
  );
}
