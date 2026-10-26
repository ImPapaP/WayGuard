// Citizen sign-up. Public registration only ever creates citizen accounts;
// LGU personnel accounts are created by their administrators.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  LuShieldCheck,
  LuMapPin,
  LuCamera,
  LuBellRing,
  LuSearch,
  LuX,
  LuUserRound,
  LuKeyRound,
  LuBuilding2,
  LuArrowRight,
  LuLock,
} from 'react-icons/lu';
import { Link, Navigate, useLocation, useNavigate } from '../../lib/router.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { AuthLayout } from '../../components/Shells.jsx';
import Logo from '../../components/Logo.jsx';
import { Button, TextField, PasswordField, PasswordRules, Field, Alert } from '../../components/ui.jsx';
import { safeNext } from './Login.jsx';

function validate(f) {
  const e = {};
  if (f.full_name.trim().length < 2) e.full_name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'Enter a valid e-mail address.';
  if (f.phone && !/^\+?[0-9 ()-]{7,20}$/.test(f.phone.trim())) e.phone = 'Enter a valid phone number, or leave it blank.';
  if (f.password.length < 8) e.password = 'Use at least 8 characters.';
  else if (!/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) e.password = 'Include at least one letter and one number.';
  if (!f.lgu_id) e.lgu_id = 'Choose your city or municipality.';
  if (f.confirm !== f.password) e.confirm = 'The passwords do not match.';
  return e;
}

const STEPS = [
  { icon: LuCamera, title: 'Snap a photo', text: 'Take a picture of the pothole right where you are.' },
  { icon: LuMapPin, title: 'Pin the spot', text: 'Your phone’s GPS or a tap on the map marks the exact place.' },
  { icon: LuBellRing, title: 'Follow the repair', text: 'Get an update each time your LGU reviews, assigns and fixes it.' },
];

function RegisterAside() {
  const { data } = useApi('/api/public/stats');
  return (
    <div className="signup-aside">
      <Logo variant="full-reversed" height={120} />
      <div className="signup-aside__body">
        <p className="signup-aside__eyebrow">For residents</p>
        <h2>Report a pothole in a few taps</h2>
        <ol className="signup-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} style={{ '--i': i }}>
              <span className="signup-steps__icon" aria-hidden><s.icon /></span>
              <span>
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      {data && data.total_reports > 0 && (
        <dl className="signup-stats">
          <div><dt>Reports so far</dt><dd className="numeral">{data.total_reports.toLocaleString()}</dd></div>
          <div><dt>Roads repaired</dt><dd className="numeral">{data.resolved.toLocaleString()}</dd></div>
          {data.avg_days_to_resolve != null && <div><dt>Days to fix, on average</dt><dd className="numeral">{data.avg_days_to_resolve}</dd></div>}
        </dl>
      )}
      <p className="signup-aside__privacy">
        <LuLock aria-hidden /> Only LGU personnel see your name, number and photos. The public map shows the pothole, not you.
      </p>
    </div>
  );
}

// Type-to-search picker for the ~1,600 cities and municipalities.
function LguPicker({ lgus, value, onChange, error }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef(null);
  const selected = lgus.find((l) => String(l.id) === String(value));
  const results = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return lgus
      .map((l) => ({ l, hay: [l.name, l.city, l.province].filter(Boolean).join(' ').toLowerCase() }))
      .filter(({ hay }) => words.every((w) => hay.includes(w)))
      .sort((a, b) => Number(b.l.name.toLowerCase().startsWith(words[0])) - Number(a.l.name.toLowerCase().startsWith(words[0])) || a.l.name.localeCompare(b.l.name))
      .slice(0, 8)
      .map(({ l }) => l);
  }, [q, lgus]);
  useEffect(() => setActive(0), [q]);

  const choose = (l) => {
    onChange(String(l.id));
    setQ('');
    setOpen(false);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <Field label="City or municipality" hint={selected ? undefined : 'Type the name of your city or municipality, then pick it from the list.'} error={error}>
      {({ id, describedBy, invalid }) => selected ? (
        <div className="lgu-chosen">
          <LuBuilding2 aria-hidden />
          <span>
            <strong>{selected.name}</strong>
            {selected.province && <span className="muted small">{selected.province}</span>}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => { onChange(''); setTimeout(() => inputRef.current?.focus(), 0); }}>
            Change
          </button>
        </div>
      ) : (
        <div className="lgu-combo">
          <div className="search-input">
            <LuSearch aria-hidden />
            <input
              ref={inputRef}
              id={id}
              className="input"
              type="text"
              role="combobox"
              aria-expanded={open && results.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && results[active] ? `${listId}-${results[active].id}` : undefined}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              autoComplete="off"
              placeholder="e.g. Malolos, Quezon City, Cebu"
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={onKey}
            />
            {q && (
              <button type="button" className="lgu-combo__clear" aria-label="Clear search" onClick={() => { setQ(''); inputRef.current?.focus(); }}>
                <LuX aria-hidden />
              </button>
            )}
          </div>
          {open && q.trim() && (
            <ul className="lgu-combo__list" id={listId} role="listbox" aria-label="Matching cities and municipalities">
              {results.length ? results.map((l, i) => (
                <li
                  key={l.id}
                  id={`${listId}-${l.id}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'is-active' : ''}
                  onMouseDown={(e) => { e.preventDefault(); choose(l); }}
                  onMouseEnter={() => setActive(i)}
                >
                  <strong>{l.name}</strong>
                  <span className="muted small">{l.province || l.city || ''}</span>
                </li>
              )) : <li className="lgu-combo__empty muted small" role="presentation">No match. Check the spelling or try the province.</li>}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}

export default function Register() {
  useDocumentTitle('Create an account');
  const { user, register, config } = useAuth();
  const { query } = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', confirm: '', lgu_id: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={safeNext(query.next, user.role)} />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const lgus = config?.lgus || [];
  const done = {
    about: form.full_name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()),
    area: Boolean(form.lgu_id),
    secure: form.password.length >= 8 && /[A-Za-z]/.test(form.password) && /\d/.test(form.password) && form.password === form.confirm,
  };
  const progress = Object.values(done).filter(Boolean).length;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      await register({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        password: form.password,
        lgu_id: Number(form.lgu_id),
      });
      navigate(query.next && query.next.startsWith('/app') ? query.next : '/app/report', { replace: true });
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const step = (key, n, Icon, title) => (
    <div className={`signup-step__head${done[key] ? ' is-done' : ''}`}>
      <span className="signup-step__num" aria-hidden>{done[key] ? '✓' : n}</span>
      <h2><Icon aria-hidden /> {title}</h2>
    </div>
  );

  return (
    <AuthLayout aside={<RegisterAside />} wide>
      <div className="register-heading">
        <span className="register-heading__icon" aria-hidden><LuShieldCheck /></span>
        <p className="eyebrow">Free citizen account</p>
        <h1>Create your account</h1>
        <p className="muted">Three short parts. You can report a pothole straight after.</p>
      </div>
      <div className="signup-progress" aria-hidden>
        <span style={{ width: `${(progress / 3) * 100}%` }} />
      </div>
      <form className="register-form" onSubmit={submit} noValidate>
        {error && <Alert type="error">{error}</Alert>}

        <fieldset className="signup-step">
          <legend className="visually-hidden">1. About you</legend>
          {step('about', 1, LuUserRound, 'About you')}
          <div className="form-stack">
            <TextField label="Full name" autoComplete="name" value={form.full_name} onChange={set('full_name')} error={errors.full_name} />
            <div className="form-row form-row--2">
              <TextField label="E-mail" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={set('email')} error={errors.email} />
              <TextField
                label="Mobile number"
                optional
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="0917 123 4567"
                value={form.phone}
                onChange={set('phone')}
                error={errors.phone}
              />
            </div>
            <p className="small muted signup-note">Your mobile number is only for LGU personnel, in case they need to ask about a report.</p>
          </div>
        </fieldset>

        <fieldset className="signup-step">
          <legend className="visually-hidden">2. Your area</legend>
          {step('area', 2, LuMapPin, 'Your area')}
          <LguPicker lgus={lgus} value={form.lgu_id} onChange={(v) => setForm((f) => ({ ...f, lgu_id: v }))} error={errors.lgu_id} />
          <p className="small muted signup-note">Your reports go to this local government.</p>
        </fieldset>

        <fieldset className="signup-step">
          <legend className="visually-hidden">3. Secure your account</legend>
          {step('secure', 3, LuKeyRound, 'Secure your account')}
          <div className="form-stack">
            <div className="form-row form-row--2">
              <PasswordField label="Password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} />
              <PasswordField label="Repeat password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
            </div>
            <PasswordRules value={form.password} confirm={form.confirm} />
          </div>
        </fieldset>

        <Button type="submit" variant="primary" size="lg" block loading={busy} className="signup-submit">
          Create my account <LuArrowRight aria-hidden />
        </Button>
        <p className="small muted signup-consent">
          Your reports, photos and pinned locations are shared with your LGU so it can repair the road.
        </p>
      </form>
      <p className="auth__switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
      <p className="auth__switch small">
        Forgot your password? <Link to="/forgot-password">Reset it by e-mail</Link>
      </p>
    </AuthLayout>
  );
}
