// Maintenance teams and responsible agencies (system set-up).
import { useState } from 'react';
import { LuPlus, LuPencil } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';
import { Link } from '../../lib/router.jsx';
import { Alert, Button, ErrorState, Loading, Modal, SelectField, TextField } from '../../components/ui.jsx';
import { JURISDICTIONS } from '../../lib/format.js';

function TeamModal({ team, agencies, jurisdictions, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: team?.name || '',
    lgu_id: team?.lgu_id ? String(team.lgu_id) : '',
    agency_id: team?.agency_id ? String(team.agency_id) : '',
    description: team?.description || '',
    is_active: team ? team.is_active : true,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const body = { ...form, agency_id: form.agency_id ? Number(form.agency_id) : null, description: form.description || null };
      if (team) delete body.lgu_id;
      else body.lgu_id = form.lgu_id ? Number(form.lgu_id) : undefined;
      if (team) await api.patch(`/api/admin/teams/${team.id}`, body);
      else await api.post('/api/admin/teams', body);
      toast(team ? 'Team updated.' : 'Team created.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={team ? `Edit ${team.name}` : 'New maintenance team'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="navy" loading={busy} onClick={save}>Save</Button></>}>
      <div className="form-stack">
        {error && <Alert type="error">{error.message}</Alert>}
        {!team && jurisdictions.length > 1 && <SelectField label="Jurisdiction" value={form.lgu_id} onChange={(e) => setForm({ ...form, lgu_id: e.target.value })} placeholder="Use my primary LGU" optional options={jurisdictions.map((lgu) => ({ value: String(lgu.id), label: `${lgu.name} — ${(lgu.jurisdiction_level || 'municipality').replaceAll('_', ' ')}` }))} />}
        <TextField label="Team name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={error?.fields?.name} />
        <SelectField label="Agency" optional value={form.agency_id} onChange={(e) => setForm({ ...form, agency_id: e.target.value })} placeholder="None" options={agencies.map((a) => ({ value: String(a.id), label: a.name }))} />
        <TextField label="Description" optional value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {team && (
          <label className="checkline">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Team is active (inactive teams cannot receive new tasks)
          </label>
        )}
      </div>
    </Modal>
  );
}

function AgencyModal({ agency, jurisdictions, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: agency?.name || '',
    lgu_id: agency?.lgu_id ? String(agency.lgu_id) : '',
    jurisdiction: agency?.jurisdiction || 'city_municipal',
    contact_email: agency?.contact_email || '',
    contact_phone: agency?.contact_phone || '',
    is_active: agency ? agency.is_active : true,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const body = { ...form, contact_email: form.contact_email || null, contact_phone: form.contact_phone || null };
      if (agency) delete body.lgu_id;
      else body.lgu_id = form.lgu_id ? Number(form.lgu_id) : undefined;
      if (agency) await api.patch(`/api/admin/agencies/${agency.id}`, body);
      else await api.post('/api/admin/agencies', body);
      toast(agency ? 'Agency updated.' : 'Agency added.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const f = error?.fields || {};
  return (
    <Modal title={agency ? `Edit ${agency.name}` : 'New responsible agency'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="navy" loading={busy} onClick={save}>Save</Button></>}>
      <div className="form-stack">
        {error && <Alert type="error">{error.message}</Alert>}
        {!agency && jurisdictions.length > 1 && <SelectField label="Jurisdiction" value={form.lgu_id} onChange={(e) => setForm({ ...form, lgu_id: e.target.value })} placeholder="Use my primary LGU" optional options={jurisdictions.map((lgu) => ({ value: String(lgu.id), label: `${lgu.name} — ${(lgu.jurisdiction_level || 'municipality').replaceAll('_', ' ')}` }))} />}
        <TextField label="Agency or office name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={f.name} />
        <SelectField label="Jurisdiction" value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} options={Object.entries(JURISDICTIONS).map(([value, label]) => ({ value, label }))} />
        <div className="form-row form-row--2">
          <TextField label="Contact e-mail" optional type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} error={f.contact_email} />
          <TextField label="Contact phone" optional value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} error={f.contact_phone} />
        </div>
        {agency && (
          <label className="checkline">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Agency is active
          </label>
        )}
      </div>
    </Modal>
  );
}

export default function Teams() {
  useDocumentTitle('Teams and agencies');
  const teams = useApi('/api/admin/teams');
  const agencies = useApi('/api/admin/agencies');
  const jurisdictions = useApi('/api/admin/jurisdictions');
  const [modal, setModal] = useState(null);
  const done = () => {
    setModal(null);
    teams.reload();
    agencies.reload();
  };
  if (teams.error || agencies.error || jurisdictions.error) return <div className="container page"><ErrorState error={teams.error || agencies.error || jurisdictions.error} onRetry={() => { teams.reload(); agencies.reload(); jurisdictions.reload(); }} /></div>;
  if (!teams.data || !agencies.data || !jurisdictions.data) return <Loading />;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Teams and agencies</h1>
          <p>Maintenance teams receive repair assignments. Agencies record who is responsible for each road.</p>
        </div>
      </div>
      <div className="split split--even">
        <section className="panel panel--flush" aria-labelledby="teams-title">
          <div className="panel__head panel__head--pad">
            <h2 id="teams-title">Maintenance teams</h2>
            <Button size="sm" variant="navy" onClick={() => setModal({ type: 'team' })}>
              <LuPlus aria-hidden /> New team
            </Button>
          </div>
          <ul className="entity-list">
            {teams.data.items.map((t) => (
              <li key={t.id} className={t.is_active ? '' : 'row--inactive'}>
                <div>
                  <strong>{t.name}</strong> {!t.is_active && <span className="badge badge--duplicate">Inactive</span>}
                  <span className="table__sub">
                    {t.lgu_name ? `${t.lgu_name} · ` : ''}{t.agency_name || 'No agency'}, {t.member_count} member{t.member_count === 1 ? '' : 's'},{' '}
                    <Link to={`/admin/reports?team_id=${t.id}`}>{t.active_tasks} active task{t.active_tasks === 1 ? '' : 's'}</Link>
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setModal({ type: 'team', item: t })} aria-label={`Edit ${t.name}`}>
                  <LuPencil aria-hidden /> Edit
                </Button>
              </li>
            ))}
            {!teams.data.items.length && <li className="muted">No teams yet.</li>}
          </ul>
          <p className="small muted" style={{ padding: '0 20px 16px' }}>
            Add crew members to a team from <Link to="/admin/users">Users</Link>.
          </p>
        </section>

        <section className="panel panel--flush" aria-labelledby="ag-title">
          <div className="panel__head panel__head--pad">
            <h2 id="ag-title">Responsible agencies</h2>
            <Button size="sm" variant="navy" onClick={() => setModal({ type: 'agency' })}>
              <LuPlus aria-hidden /> New agency
            </Button>
          </div>
          <ul className="entity-list">
            {agencies.data.items.map((a) => (
              <li key={a.id} className={a.is_active ? '' : 'row--inactive'}>
                <div>
                  <strong>{a.name}</strong> {!a.is_active && <span className="badge badge--duplicate">Inactive</span>}
                  <span className="table__sub">
                    {a.lgu_name ? `${a.lgu_name} · ` : ''}{JURISDICTIONS[a.jurisdiction]} roads, {a.report_count} report{a.report_count === 1 ? '' : 's'}
                    {a.contact_email ? `, ${a.contact_email}` : ''}
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setModal({ type: 'agency', item: a })} aria-label={`Edit ${a.name}`}>
                  <LuPencil aria-hidden /> Edit
                </Button>
              </li>
            ))}
            {!agencies.data.items.length && <li className="muted">No agencies yet.</li>}
          </ul>
          <p className="small muted" style={{ padding: '0 20px 16px' }}>
            Choose which agency is suggested for each road type in <Link to="/admin/settings">System settings</Link>.
          </p>
        </section>
      </div>
      {modal?.type === 'team' && <TeamModal team={modal.item} agencies={agencies.data.items.filter((a) => a.is_active)} jurisdictions={jurisdictions.data.items} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.type === 'agency' && <AgencyModal agency={modal.item} jurisdictions={jurisdictions.data.items} onClose={() => setModal(null)} onSaved={done} />}
    </div>
  );
}
