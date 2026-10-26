// Platform administrator workspace: create LGU tenants and their first LGU admin.
import { useState } from 'react';
import { LuBuilding2, LuCircleCheck, LuCircleX, LuLogOut, LuShieldCheck, LuUserPlus } from 'react-icons/lu';
import { Link, useNavigate } from '../../lib/router.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';
import { Alert, Button, EmptyState, Loading, TextField } from '../../components/ui.jsx';
import { PublicLayout } from '../../components/Shells.jsx';

const EMPTY_FORM = {
  name: '',
  slug: '',
  city: '',
  province: '',
  map_latitude: '',
  map_longitude: '',
  jurisdiction_boundary: '',
  admin_name: '',
  admin_email: '',
  admin_phone: '',
  temporary_password: '',
};

export default function LGUs() {
  useDocumentTitle('LGU management');
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

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function createLgu(event) {
    event.preventDefault();
    setFormError(null);
    setCreatedAccount(null);
    setBusy(true);
    try {
      const result = await api.post('/api/platform/lgus', {
        ...form,
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
            <h1>LGU management</h1>
            <p className="muted">Create independent local government workspaces. Every LGU gets its own administrator, staff, teams, reports and settings.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="small muted">{user?.full_name}</span>
            <Button variant="secondary" onClick={signOut}><LuLogOut aria-hidden /> Sign out</Button>
          </div>
        </div>

        <div className="form-row form-row--2" style={{ alignItems: 'start' }}>
          <section className="panel">
            <div className="panel__head">
              <h2><LuUserPlus aria-hidden /> Create an LGU</h2>
            </div>
            <p className="muted small">The administrator you create here is automatically assigned to this LGU and must change the temporary password after signing in.</p>
            {formError && <Alert type="error">{formError.message}</Alert>}
            <form className="form-stack" onSubmit={createLgu} noValidate>
              <TextField label="LGU / local government name" value={form.name} onChange={set('name')} error={fieldErrors.name} placeholder="e.g. City of Meycauayan" required />
              <div className="form-row form-row--2">
                <TextField label="City / municipality" value={form.city} onChange={set('city')} error={fieldErrors.city} required />
                <TextField label="Province" value={form.province} onChange={set('province')} error={fieldErrors.province} required />
              </div>
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
              <div style={{ display: 'grid', gap: 12 }}>
                {data.items.map((lgu) => (
                  <article key={lgu.id} className="panel" style={{ padding: 16, background: 'var(--surface-sunken)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div>
                        <h3 style={{ margin: 0 }}>{lgu.name}</h3>
                        <p className="muted small" style={{ margin: '4px 0' }}>{[lgu.city, lgu.province].filter(Boolean).join(', ')}</p>
                        <p className="muted small" style={{ margin: '4px 0' }}>Workspace: <code>{lgu.slug}</code></p>
                      </div>
                      <span className={`badge ${lgu.is_active ? 'badge--resolved' : 'badge--rejected'}`}>
                        {lgu.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="form-row form-row--2" style={{ margin: '12px 0' }}>
                      <div><strong>{lgu.staff_count}</strong><p className="muted small" style={{ margin: 0 }}>Active staff and crews</p></div>
                      <div><strong>{lgu.report_count}</strong><p className="muted small" style={{ margin: 0 }}>Reports</p></div>
                    </div>
                    <p className="muted small">Administrator: {lgu.administrator_name || 'Not assigned'}</p>
                    <label className="field"><span className="field__label">Jurisdiction boundary</span><textarea className="input" rows={4} spellCheck={false} value={boundaryDrafts[lgu.id] ?? (lgu.jurisdiction_boundary ? JSON.stringify(lgu.jurisdiction_boundary, null, 2) : '')} onChange={(e) => setBoundaryDrafts((old) => ({ ...old, [lgu.id]: e.target.value }))} placeholder="Paste GeoJSON Polygon or MultiPolygon" /><span className="field__hint">{lgu.jurisdiction_boundary ? 'Boundary configured. Empty field removes it.' : 'No boundary configured; location checks are not active until one is saved.'}</span></label>
                    <Button size="sm" variant="navy" loading={savingBoundary === lgu.id} onClick={() => saveBoundary(lgu)}>Save jurisdiction boundary</Button>
                    <Button size="sm" variant={lgu.is_active ? 'secondary' : 'navy'} loading={busyLgu === lgu.id} onClick={() => toggleLgu(lgu)}>
                      {lgu.is_active ? <><LuCircleX aria-hidden /> Deactivate LGU</> : <><LuCircleCheck aria-hidden /> Reactivate LGU</>}
                    </Button>
                  </article>
                ))}
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
