// System settings: LGU name, duplicate detection, photo limits, public map
// window, default map position and the road-type → agency routing.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { useToast } from '../../lib/toast.jsx';
import { Alert, Button, ErrorState, Loading, SelectField, TextField } from '../../components/ui.jsx';
import MapView from '../../components/MapView.jsx';
import { ROAD_TYPES } from '../../lib/format.js';

export default function Settings() {
  useDocumentTitle('System settings');
  const toast = useToast();
  const { refresh } = useAuth();
  const { data, error, loading, reload } = useApi('/api/admin/settings');
  const { data: agencies } = useApi('/api/admin/agencies');
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      const s = data.settings;
      setForm({
        lgu_name: s.lgu_name,
        duplicate_radius_m: String(s.duplicate_radius_m),
        duplicate_window_days: String(s.duplicate_window_days),
        max_photos_per_report: String(s.max_photos_per_report),
        public_resolved_days: String(s.public_resolved_days),
        lat: String(s.map_center.lat),
        lng: String(s.map_center.lng),
        zoom: String(s.map_center.zoom),
        road_type_agency: Object.fromEntries(Object.keys(ROAD_TYPES).map((k) => [k, s.road_type_agency?.[k] ? String(s.road_type_agency[k]) : ''])),
      });
    }
  }, [data]);

  if (error) return <div className="container page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !form || !agencies) return <Loading />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setSaveError(null);
    try {
      await api.put('/api/admin/settings', {
        lgu_name: form.lgu_name,
        duplicate_radius_m: Number(form.duplicate_radius_m),
        duplicate_window_days: Number(form.duplicate_window_days),
        max_photos_per_report: Number(form.max_photos_per_report),
        public_resolved_days: Number(form.public_resolved_days),
        map_center: { lat: Number(form.lat), lng: Number(form.lng), zoom: Number(form.zoom) },
        road_type_agency: Object.fromEntries(Object.entries(form.road_type_agency).map(([k, v]) => [k, v ? Number(v) : null])),
      });
      setErrors({});
      toast('Settings saved.');
      refresh();
    } catch (err) {
      setErrors(err.fields || {});
      setSaveError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container page page--narrow">
      <div className="page-head">
        <div>
          <h1>System settings</h1>
          <p>Changes apply immediately for everyone and are recorded in the activity log.</p>
        </div>
      </div>
      <form className="stack stack--lg" onSubmit={save} noValidate>
        {saveError && <Alert type="error">{saveError}</Alert>}
        <section className="panel form-stack" aria-labelledby="g-title">
          <h2 id="g-title" className="section-title">
            General
          </h2>
          <TextField label="LGU name" hint="Shown to citizens on the home page and in exported reports." value={form.lgu_name} onChange={set('lgu_name')} error={errors.lgu_name} />
          <div className="form-row form-row--2">
            <TextField label="Photos allowed per report" type="number" min={1} max={10} value={form.max_photos_per_report} onChange={set('max_photos_per_report')} error={errors.max_photos_per_report} />
            <TextField
              label="Keep repaired potholes on the public map for"
              hint="Days after resolution (0 hides them immediately)."
              type="number"
              min={0}
              max={3650}
              value={form.public_resolved_days}
              onChange={set('public_resolved_days')}
              error={errors.public_resolved_days}
            />
          </div>
        </section>

        <section className="panel form-stack" aria-labelledby="d-title">
          <h2 id="d-title" className="section-title">
            Duplicate detection
          </h2>
          <p className="small muted">Open reports closer than this distance, within this many days of each other, are flagged as possible duplicates.</p>
          <div className="form-row form-row--2">
            <TextField label="Radius in metres" type="number" min={5} max={500} value={form.duplicate_radius_m} onChange={set('duplicate_radius_m')} error={errors.duplicate_radius_m} />
            <TextField label="Time window in days" type="number" min={1} max={730} value={form.duplicate_window_days} onChange={set('duplicate_window_days')} error={errors.duplicate_window_days} />
          </div>
        </section>

        <section className="panel form-stack" aria-labelledby="r-title">
          <h2 id="r-title" className="section-title">
            Responsible agency by road type
          </h2>
          <p className="small muted">New reports are routed to this agency automatically. Administrators can change it during review.</p>
          {Object.entries(ROAD_TYPES).map(([k, label]) => (
            <SelectField
              key={k}
              label={label}
              value={form.road_type_agency[k]}
              onChange={(e) => setForm({ ...form, road_type_agency: { ...form.road_type_agency, [k]: e.target.value } })}
              placeholder="No automatic agency"
              options={agencies.items.filter((a) => a.is_active).map((a) => ({ value: String(a.id), label: a.name }))}
            />
          ))}
        </section>

        <section className="panel form-stack" aria-labelledby="m-title">
          <h2 id="m-title" className="section-title">
            Default map position
          </h2>
          <p className="small muted">Click the map to move the centre, or type coordinates.</p>
          <MapView
            height={260}
            center={{ lat: Number(form.lat) || 0, lng: Number(form.lng) || 0 }}
            zoom={Number(form.zoom) || 14}
            pick={{ lat: Number(form.lat) || 0, lng: Number(form.lng) || 0 }}
            onMapClick={(p) => setForm({ ...form, lat: p.lat.toFixed(5), lng: p.lng.toFixed(5) })}
            onPickMove={(p) => setForm({ ...form, lat: p.lat.toFixed(5), lng: p.lng.toFixed(5) })}
            label="Choose the default map centre"
          />
          <div className="form-row form-row--3">
            <TextField label="Latitude" inputMode="decimal" value={form.lat} onChange={set('lat')} error={errors['map_center.lat']} />
            <TextField label="Longitude" inputMode="decimal" value={form.lng} onChange={set('lng')} error={errors['map_center.lng']} />
            <TextField label="Zoom (3–19)" type="number" min={3} max={19} value={form.zoom} onChange={set('zoom')} error={errors['map_center.zoom']} />
          </div>
        </section>

        <div>
          <Button type="submit" variant="primary" size="lg" loading={busy}>
            Save settings
          </Button>
        </div>
      </form>
    </div>
  );
}
