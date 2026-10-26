// Management of maintenance teams and responsible agencies within each delegated LGU.
import { useState } from 'react';
import {
  LuPlus, LuPencil, LuUsers, LuBuilding2, LuMapPin, LuShieldCheck,
  LuClipboardList, LuInfo, LuCircleCheck,
} from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { useToast } from '../../lib/toast.jsx';
import { Link } from '../../lib/router.jsx';
import { Alert, Button, EmptyState, ErrorState, Loading, Modal, SelectField, TextField } from '../../components/ui.jsx';
import { JURISDICTIONS } from '../../lib/format.js';

function areaLabel(lgu) {
  if (!lgu) return 'Assigned jurisdiction';
  const level = (lgu.jurisdiction_level || 'municipality').replaceAll('_', ' ');
  const location = [lgu.city, lgu.province].filter(Boolean).join(', ');
  return [lgu.name, level, location].filter(Boolean).join(' · ');
}

function FormIntro({ icon: Icon, eyebrow, title, children }) {
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

function ScopeCard({ lgu }) {
  return (
    <div className="workspace-form__scope">
      <LuMapPin aria-hidden />
      <div>
        <strong>{lgu?.name || 'Assigned jurisdiction'}</strong>
        <p>{areaLabel(lgu)}</p>
      </div>
    </div>
  );
}

function TeamModal({ team, agencies, jurisdictions, primaryLguId, onClose, onSaved }) {
  const toast = useToast();
  const isEditing = Boolean(team);
  const [form, setForm] = useState(() => ({
    name: team?.name || '',
    lgu_id: String(team?.lgu_id ?? primaryLguId ?? jurisdictions[0]?.id ?? ''),
    agency_id: team?.agency_id ? String(team.agency_id) : '',
    description: team?.description || '',
    is_active: team ? team.is_active : true,
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const lguId = Number(form.lgu_id || primaryLguId || jurisdictions[0]?.id);
  const selectedLgu = jurisdictions.find((item) => Number(item.id) === lguId);
  const availableAgencies = agencies.filter((agency) =>
    Number(agency.lgu_id) === lguId && (agency.is_active || String(agency.id) === form.agency_id),
  );

  function changeJurisdiction(value) {
    setForm((current) => ({ ...current, lgu_id: value, agency_id: '' }));
    setError(null);
  }

  async function save() {
    setError(null);
    if (!form.name.trim()) {
      setError({ message: 'Enter a name for this maintenance team.', fields: { name: 'Team name is required.' } });
      return;
    }
    if (!lguId || !selectedLgu) {
      setError({ message: 'Select a jurisdiction before saving.' });
      return;
    }
    if (form.agency_id && !availableAgencies.some((item) => String(item.id) === form.agency_id)) {
      setError({ message: 'Choose an agency in the same jurisdiction as this team.' });
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        agency_id: form.agency_id ? Number(form.agency_id) : null,
        description: form.description.trim() || null,
        is_active: form.is_active,
      };
      if (!isEditing) body.lgu_id = lguId;
      if (isEditing) await api.patch('/api/admin/teams/' + team.id, body);
      else await api.post('/api/admin/teams', body);
      toast(isEditing ? 'Team details updated.' : 'Maintenance team created.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isEditing ? 'Edit maintenance team' : 'New maintenance team'}
      className="modal--workspace"
      onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="navy" loading={busy} onClick={save}>{isEditing ? 'Save changes' : 'Create team'}</Button></>}
    >
      <div className="workspace-form">
        <FormIntro icon={LuUsers} eyebrow={isEditing ? 'Team settings' : 'Team setup'} title={isEditing ? team.name : 'Build your maintenance team'}>
          {isEditing
            ? 'Update team details and its responsible agency. Existing repair history stays attached to its original records.'
            : 'Create an operational team for repair assignments. Choose the jurisdiction first so the team and its agency stay correctly matched.'}
        </FormIntro>

        {error && <Alert type="error" title="Could not save team">{error.message}</Alert>}

        <section className="workspace-form__section">
          <div className="workspace-form__section-head">
            <span className="workspace-form__section-icon"><LuClipboardList aria-hidden /></span>
            <div><h3>Team details</h3><p>Give the team a clear name staff can recognize.</p></div>
          </div>
          <TextField
            label="Team name"
            value={form.name}
            onChange={(event) => setForm((old) => ({ ...old, name: event.target.value }))}
            placeholder="e.g. North District Road Crew"
            autoComplete="off"
            required
            error={error?.fields?.name}
          />
          <TextField
            label="Description"
            optional
            multiline
            value={form.description}
            onChange={(event) => setForm((old) => ({ ...old, description: event.target.value }))}
            placeholder="Area covered, team responsibilities, or operating notes"
            rows={3}
            hint="Internal note to help administrators understand the team's role."
          />
        </section>

        <section className="workspace-form__section">
          <div className="workspace-form__section-head">
            <span className="workspace-form__section-icon"><LuMapPin aria-hidden /></span>
            <div><h3>Jurisdiction and agency</h3><p>Every team must operate inside a jurisdiction assigned to your account.</p></div>
          </div>
          {!isEditing && jurisdictions.length > 1 ? (
            <SelectField
              label="Operating jurisdiction"
              value={form.lgu_id}
              onChange={(event) => changeJurisdiction(event.target.value)}
              options={jurisdictions.map((lgu) => ({ value: String(lgu.id), label: areaLabel(lgu) }))}
              hint="Changing the jurisdiction refreshes the available agencies."
              required
            />
          ) : <ScopeCard lgu={selectedLgu} />}
          <SelectField
            label="Responsible agency"
            optional
            value={form.agency_id}
            onChange={(event) => setForm((old) => ({ ...old, agency_id: event.target.value }))}
            placeholder="No agency linked"
            options={availableAgencies.map((agency) => ({ value: String(agency.id), label: agency.is_active ? agency.name : agency.name + ' (inactive)' }))}
            hint={availableAgencies.length
              ? 'Only agencies from this jurisdiction are shown.'
              : 'No active agencies are configured for this jurisdiction. You can create one from Teams & agencies.'}
          />
          {!isEditing && <div className="workspace-form__hint"><LuInfo aria-hidden /> New teams are activated when created. You can edit the team later to pause it, provided it has no active tasks.</div>}
          {isEditing && (
            <label className="checkline">
              <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((old) => ({ ...old, is_active: event.target.checked }))} />
              <span><strong>Team is active</strong><span className="field__hint" style={{ display: 'block' }}>Inactive teams cannot receive new work. Active tasks must be reassigned before deactivation.</span></span>
            </label>
          )}
        </section>
      </div>
    </Modal>
  );
}

function AgencyModal({ agency, jurisdictions, primaryLguId, onClose, onSaved }) {
  const toast = useToast();
  const isEditing = Boolean(agency);
  const [form, setForm] = useState(() => ({
    name: agency?.name || '',
    lgu_id: String(agency?.lgu_id ?? primaryLguId ?? jurisdictions[0]?.id ?? ''),
    jurisdiction: agency?.jurisdiction || 'city_municipal',
    contact_email: agency?.contact_email || '',
    contact_phone: agency?.contact_phone || '',
    is_active: agency ? agency.is_active : true,
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const lguId = Number(form.lgu_id || primaryLguId || jurisdictions[0]?.id);
  const selectedLgu = jurisdictions.find((item) => Number(item.id) === lguId);

  async function save() {
    setError(null);
    if (!form.name.trim()) {
      setError({ message: 'Enter a name for this responsible agency.', fields: { name: 'Agency name is required.' } });
      return;
    }
    if (!lguId || !selectedLgu) {
      setError({ message: 'Select a jurisdiction before saving.' });
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        jurisdiction: form.jurisdiction,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        is_active: form.is_active,
      };
      if (!isEditing) body.lgu_id = lguId;
      if (isEditing) await api.patch('/api/admin/agencies/' + agency.id, body);
      else await api.post('/api/admin/agencies', body);
      toast(isEditing ? 'Agency details updated.' : 'Responsible agency created.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isEditing ? 'Edit responsible agency' : 'New responsible agency'}
      className="modal--workspace"
      onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="navy" loading={busy} onClick={save}>{isEditing ? 'Save changes' : 'Create agency'}</Button></>}
    >
      <div className="workspace-form">
        <FormIntro icon={LuBuilding2} eyebrow={isEditing ? 'Agency settings' : 'Agency setup'} title={isEditing ? agency.name : 'Register a responsible agency'}>
          {isEditing
            ? "Keep the agency's contact details and road coverage up to date."
            : 'Identify the office responsible for road work so administrators can route verified reports to the right agency.'}
        </FormIntro>

        {error && <Alert type="error" title="Could not save agency">{error.message}</Alert>}

        <section className="workspace-form__section">
          <div className="workspace-form__section-head">
            <span className="workspace-form__section-icon"><LuBuilding2 aria-hidden /></span>
            <div><h3>Agency details</h3><p>Use the official office name and a clear road coverage type.</p></div>
          </div>
          <TextField
            label="Agency or office name"
            value={form.name}
            onChange={(event) => setForm((old) => ({ ...old, name: event.target.value }))}
            placeholder="e.g. City Engineering Office"
            autoComplete="organization"
            required
            error={error?.fields?.name}
          />
          <SelectField
            label="Road jurisdiction covered"
            value={form.jurisdiction}
            onChange={(event) => setForm((old) => ({ ...old, jurisdiction: event.target.value }))}
            options={Object.entries(JURISDICTIONS).map(([value, label]) => ({ value, label }))}
            hint="This describes the road types the office handles, not the geographic access granted to an account."
            required
          />
        </section>

        <section className="workspace-form__section">
          <div className="workspace-form__section-head">
            <span className="workspace-form__section-icon"><LuMapPin aria-hidden /></span>
            <div><h3>Management jurisdiction</h3><p>Sets the LGU that owns this agency record.</p></div>
          </div>
          {!isEditing && jurisdictions.length > 1 ? (
            <SelectField
              label="Assigned LGU"
              value={form.lgu_id}
              onChange={(event) => setForm((old) => ({ ...old, lgu_id: event.target.value }))}
              options={jurisdictions.map((lgu) => ({ value: String(lgu.id), label: areaLabel(lgu) }))}
              required
            />
          ) : <ScopeCard lgu={selectedLgu} />}
        </section>

        <section className="workspace-form__section">
          <div className="workspace-form__section-head">
            <span className="workspace-form__section-icon"><LuShieldCheck aria-hidden /></span>
            <div><h3>Contact and status</h3><p>Give the operations team a way to coordinate with this office.</p></div>
          </div>
          <div className="workspace-form__grid">
            <TextField label="Contact e-mail" optional type="email" autoComplete="email" value={form.contact_email} onChange={(event) => setForm((old) => ({ ...old, contact_email: event.target.value }))} placeholder="office@example.gov.ph" error={error?.fields?.contact_email} />
            <TextField label="Contact phone" optional type="tel" autoComplete="tel" value={form.contact_phone} onChange={(event) => setForm((old) => ({ ...old, contact_phone: event.target.value }))} placeholder="e.g. 044 123 4567" error={error?.fields?.contact_phone} />
          </div>
          {isEditing ? (
            <label className="checkline">
              <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((old) => ({ ...old, is_active: event.target.checked }))} />
              <span><strong>Agency is active</strong><span className="field__hint" style={{ display: 'block' }}>Inactive agencies are hidden from new assignment choices.</span></span>
            </label>
          ) : <div className="workspace-form__hint"><LuCircleCheck aria-hidden /> New agencies are active immediately and can be used when verifying and assigning reports.</div>}
        </section>
      </div>
    </Modal>
  );
}

export default function Teams() {
  useDocumentTitle('Teams and agencies');
  const { user } = useAuth();
  const teams = useApi('/api/admin/teams');
  const agencies = useApi('/api/admin/agencies');
  const jurisdictions = useApi('/api/admin/jurisdictions');
  const [modal, setModal] = useState(null);
  const primaryLguId = user?.lgu_id == null ? '' : String(user.lgu_id);
  const done = () => {
    setModal(null);
    teams.reload();
    agencies.reload();
  };
  if (teams.error || agencies.error || jurisdictions.error) {
    return <div className="container page"><ErrorState error={teams.error || agencies.error || jurisdictions.error} onRetry={() => { teams.reload(); agencies.reload(); jurisdictions.reload(); }} /></div>;
  }
  if (!teams.data || !agencies.data || !jurisdictions.data) return <Loading />;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Workspace operations</p>
          <h1>Teams and agencies</h1>
          <p>Set up the crews that perform repairs and the offices accountable for road work across your assigned jurisdictions.</p>
        </div>
      </div>
      <div className="split split--even">
        <section className="panel panel--flush" aria-labelledby="teams-title">
          <div className="panel__head panel__head--pad">
            <div><h2 id="teams-title"><LuUsers aria-hidden /> Maintenance teams</h2><p className="muted small">Crews that receive and complete repair tasks.</p></div>
            <Button size="sm" variant="navy" onClick={() => setModal({ type: 'team' })}><LuPlus aria-hidden /> New team</Button>
          </div>
          <ul className="entity-list">
            {teams.data.items.map((team) => (
              <li key={team.id} className={team.is_active ? '' : 'row--inactive'}>
                <div>
                  <strong>{team.name}</strong> {!team.is_active && <span className="badge badge--duplicate">Inactive</span>}
                  <span className="table__sub">
                    {team.lgu_name ? team.lgu_name + ' · ' : ''}{team.agency_name || 'No agency'}, {team.member_count} member{team.member_count === 1 ? '' : 's'},{' '}
                    <Link to={'/admin/reports?team_id=' + team.id}>{team.active_tasks} active task{team.active_tasks === 1 ? '' : 's'}</Link>
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setModal({ type: 'team', item: team })} aria-label={'Edit ' + team.name}><LuPencil aria-hidden /> Edit</Button>
              </li>
            ))}
            {!teams.data.items.length && <li className="muted">No teams yet. Use “New team” to set up the first repair crew.</li>}
          </ul>
          <p className="small muted" style={{ padding: '0 20px 16px' }}>
            Add crew members through <Link to="/admin/users">Users</Link>. Each maintenance account must belong to an active team in the same LGU.
          </p>
        </section>

        <section className="panel panel--flush" aria-labelledby="ag-title">
          <div className="panel__head panel__head--pad">
            <div><h2 id="ag-title"><LuBuilding2 aria-hidden /> Responsible agencies</h2><p className="muted small">Offices used to route verified reports and repairs.</p></div>
            <Button size="sm" variant="navy" onClick={() => setModal({ type: 'agency' })}><LuPlus aria-hidden /> New agency</Button>
          </div>
          <ul className="entity-list">
            {agencies.data.items.map((agency) => (
              <li key={agency.id} className={agency.is_active ? '' : 'row--inactive'}>
                <div>
                  <strong>{agency.name}</strong> {!agency.is_active && <span className="badge badge--duplicate">Inactive</span>}
                  <span className="table__sub">
                    {agency.lgu_name ? agency.lgu_name + ' · ' : ''}{JURISDICTIONS[agency.jurisdiction]} roads, {agency.report_count} report{agency.report_count === 1 ? '' : 's'}
                    {agency.contact_email ? ', ' + agency.contact_email : ''}
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setModal({ type: 'agency', item: agency })} aria-label={'Edit ' + agency.name}><LuPencil aria-hidden /> Edit</Button>
              </li>
            ))}
            {!agencies.data.items.length && <li className="muted">No agencies yet. Use “New agency” to register a responsible office.</li>}
          </ul>
          <p className="small muted" style={{ padding: '0 20px 16px' }}>
            Configure automatic road-type routing in <Link to="/admin/settings">System settings</Link>.
          </p>
        </section>
      </div>
      {modal?.type === 'team' && <TeamModal team={modal.item} agencies={agencies.data.items} jurisdictions={jurisdictions.data.items} primaryLguId={primaryLguId} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.type === 'agency' && <AgencyModal agency={modal.item} jurisdictions={jurisdictions.data.items} primaryLguId={primaryLguId} onClose={() => setModal(null)} onSaved={done} />}
    </div>
  );
}
