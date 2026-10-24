// Pothole report form (FR-02 to FR-07): location, photos, description and
// severity, sent as one multipart request.
import { useRef, useState } from 'react';
import { LuCircleCheck, LuSend, LuTriangleAlert } from 'react-icons/lu';
import { upload } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';
import { Link, useLocation } from '../../lib/router.jsx';
import { Button, Field, TextField, SelectField, Alert } from '../../components/ui.jsx';
import LocationPicker from '../../components/LocationPicker.jsx';
import { PhotoPicker } from '../../components/Photos.jsx';
import { SEVERITY, HAZARDS, ROAD_TYPES } from '../../lib/format.js';

const EMPTY = {
  road_name: '',
  barangay: '',
  city: '',
  landmark: '',
  road_type: 'unknown',
  description: '',
  hazards: [],
  severity: '',
};

function validate(form, location, photos) {
  const e = {};
  if (!location) e.location = 'Set the pothole location with GPS, the map or an address search.';
  if (!photos.length) e.photos = 'Add at least one photo of the pothole.';
  if (form.road_name.trim().length < 2) e.road_name = 'Enter the road or street name.';
  if (form.description.trim().length < 10) e.description = 'Describe the pothole in at least 10 characters.';
  if (!form.severity) e.severity = 'Choose how severe the pothole is.';
  return e;
}

export default function NewReport() {
  useDocumentTitle('Report a pothole');
  const { config } = useAuth();
  const { query } = useLocation();
  // Coming from the map's Report button: location and severity are filled in.
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    severity: ['low', 'medium', 'high'].includes(query.severity) ? query.severity : '',
  }));
  const [location, setLocation] = useState(() => {
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    if (!query.lat || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const acc = Number(query.acc);
    return { lat, lng, source: query.src === 'gps' ? 'gps' : 'map', accuracy: query.src === 'gps' && Number.isFinite(acc) ? acc : null };
  });
  const [photos, setPhotos] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [done, setDone] = useState(null);
  const formRef = useRef(null);
  const maxPhotos = config?.max_photos_per_report || 5;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Fill road details suggested by the geocoder, without overwriting typing.
  function applyAddress(addr) {
    setForm((f) => ({
      ...f,
      road_name: f.road_name || addr.road_name || '',
      barangay: f.barangay || addr.barangay || '',
      city: f.city || addr.city || '',
    }));
  }

  function toggleHazard(h) {
    setForm((f) => ({ ...f, hazards: f.hazards.includes(h) ? f.hazards.filter((x) => x !== h) : [...f.hazards, h] }));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const v = validate(form, location, photos);
    setErrors(v);
    if (Object.keys(v).length) {
      setError('Some details are missing. Check the highlighted sections.');
      const first = formRef.current?.querySelector('[data-error="true"]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const fd = new FormData();
    for (const [k, val] of Object.entries(form)) {
      if (k === 'hazards') fd.append('hazards', val.join(','));
      else fd.append(k, typeof val === 'string' ? val.trim() : val);
    }
    fd.append('latitude', location.lat.toFixed(7));
    fd.append('longitude', location.lng.toFixed(7));
    fd.append('location_source', location.source);
    if (location.accuracy) fd.append('location_accuracy_m', String(location.accuracy));
    photos.forEach((p, i) => fd.append('photos', p.file, p.file.name || `photo-${i + 1}.jpg`));
    setProgress(0);
    try {
      const res = await upload('/api/reports', fd, { onProgress: setProgress });
      setDone(res);
      window.scrollTo(0, 0);
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  if (done) {
    return (
      <div className="container page page--narrow">
        <div className="panel success-card">
          <span className="success-card__icon" aria-hidden>
            <LuCircleCheck />
          </span>
          <h1>Report sent</h1>
          <p className="success-card__code numeral">{done.report.code}</p>
          <p>
            Thank you. An LGU administrator will review the photo and location. You will get a notification when the status
            changes.
          </p>
          {done.possible_duplicates > 0 && (
            <Alert type="warn" title="Someone may have reported this pothole already">
              The LGU will check and, if it is the same pothole, link your report to the existing one so it is repaired once.
            </Alert>
          )}
          <div className="cluster" style={{ justifyContent: 'center', marginTop: 20 }}>
            <Link to={`/app/reports/${done.report.id}`} className="btn btn--navy">
              Track this report
            </Link>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setDone(null);
                setForm(EMPTY);
                setLocation(null);
                setPhotos([]);
              }}
            >
              Report another pothole
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container page page--narrow">
      <div className="page-head">
        <div>
          <h1>Report a pothole</h1>
          <p>Four quick parts. Fields marked optional can be left blank.</p>
        </div>
      </div>
      <form ref={formRef} className="report-form" onSubmit={submit} noValidate>
        <section className="form-section" data-error={Boolean(errors.location || errors.latitude)} aria-labelledby="s-loc">
          <h2 id="s-loc">
            <span className="form-section__num">1</span> Where is it?
          </h2>
          <LocationPicker value={location} onChange={setLocation} onAddress={applyAddress} error={errors.location || errors.latitude} />
        </section>

        <section className="form-section" data-error={Boolean(errors.photos)} aria-labelledby="s-photo">
          <h2 id="s-photo">
            <span className="form-section__num">2</span> Photos of the damage
          </h2>
          <p className="field__hint">Take the photo from the side of the road where it is safe. Include something for scale if you can.</p>
          <PhotoPicker value={photos} onChange={setPhotos} max={maxPhotos} maxMb={config?.max_photo_mb || 8} error={errors.photos} />
        </section>

        <section className="form-section" data-error={Boolean(errors.road_name || errors.description)} aria-labelledby="s-desc">
          <h2 id="s-desc">
            <span className="form-section__num">3</span> Describe it
          </h2>
          <div className="form-stack">
            <div className="form-row form-row--2">
              <TextField label="Road or street name" value={form.road_name} onChange={set('road_name')} error={errors.road_name} />
              <TextField label="Barangay" optional value={form.barangay} onChange={set('barangay')} error={errors.barangay} />
            </div>
            <div className="form-row form-row--2">
              <TextField
                label="Nearest landmark"
                optional
                placeholder="e.g. in front of the elementary school"
                value={form.landmark}
                onChange={set('landmark')}
                error={errors.landmark}
              />
              <TextField label="City or municipality" optional value={form.city} onChange={set('city')} error={errors.city} />
            </div>
            <SelectField
              label="Type of road"
              optional
              hint="Helps the LGU send the report to the agency responsible for the road."
              value={form.road_type}
              onChange={set('road_type')}
              options={Object.entries(ROAD_TYPES).map(([value, label]) => ({ value, label }))}
            />
            <TextField
              label="What does it look like?"
              multiline
              hint="Size, depth, which lane, and anything that makes it dangerous."
              value={form.description}
              onChange={set('description')}
              error={errors.description}
              maxLength={2000}
            />
            <fieldset className="fieldset">
              <legend className="field__label">
                Hazards you noticed <span className="field__optional">(optional)</span>
              </legend>
              <div className="choices choices--wrap">
                {Object.entries(HAZARDS).map(([key, label]) => (
                  <label key={key} className="choice choice--chip">
                    <input type="checkbox" checked={form.hazards.includes(key)} onChange={() => toggleHazard(key)} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        <section className="form-section" data-error={Boolean(errors.severity)} aria-labelledby="s-sev">
          <h2 id="s-sev">
            <span className="form-section__num">4</span> How severe is it?
          </h2>
          <Field error={errors.severity}>
            {() => (
              <div className="choices choices--3" role="radiogroup" aria-labelledby="s-sev">
                {['low', 'medium', 'high'].map((s) => (
                  <label key={s} className={`choice choice--sev choice--${s}`}>
                    <input type="radio" name="severity" value={s} checked={form.severity === s} onChange={set('severity')} />
                    <span className="choice__title">
                      <span className={`sev sev--${s}`} aria-hidden>
                        <span className="sev__bars">
                          <i />
                          <i />
                          <i />
                        </span>
                      </span>
                      {SEVERITY[s].label}
                    </span>
                    <span className="choice__desc">{SEVERITY[s].help}</span>
                  </label>
                ))}
              </div>
            )}
          </Field>
        </section>

        <div className="form-submit">
          {error && (
            <Alert type="error">
              {error}
            </Alert>
          )}
          <p className="field__hint">
            <LuTriangleAlert aria-hidden style={{ verticalAlign: '-2px' }} /> Only report from a safe place. Never stop in
            traffic to take a photo.
          </p>
          <Button type="submit" variant="primary" size="lg" block loading={progress !== null}>
            <LuSend aria-hidden /> {progress !== null ? `Sending… ${progress}%` : 'Send report'}
          </Button>
        </div>
      </form>
    </div>
  );
}
