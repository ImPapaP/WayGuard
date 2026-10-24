import { useState } from 'react';
import { LuSmartphone, LuLayoutDashboard, LuHardHat, LuCircleCheck } from 'react-icons/lu';
import { Link, Navigate, useLocation, useNavigate } from '../../lib/router.jsx';
import { useAuth, HOME_BY_ROLE } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../lib/hooks.js';
import { AuthLayout } from '../../components/Shells.jsx';
import { Button, TextField, Alert } from '../../components/ui.jsx';

// Only same-site paths are accepted as a redirect target.
export function safeNext(next, role) {
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) {
    const prefix = { citizen: '/app', admin: '/admin', maintenance: '/crew' }[role];
    if (next.startsWith(prefix) || next.startsWith('/r/') || next === '/map') return next;
  }
  return HOME_BY_ROLE[role];
}

// Where each kind of account lands after signing in.
const DESTINATION = {
  citizen: { label: 'Citizen', place: 'your reports', icon: LuSmartphone },
  admin: { label: 'LGU administrator', place: 'the LGU dashboard', icon: LuLayoutDashboard },
  maintenance: { label: 'Road crew', place: 'your repair tasks', icon: LuHardHat },
};

// Demo accounts listed only in the self-contained browser preview.
const PREVIEW_ACCOUNTS = [
  ['maria@demo.wayguard.test', 'Citizen'],
  ['admin@demo.wayguard.test', 'LGU administrator'],
  ['crew.alpha@demo.wayguard.test', 'Road crew'],
];

export default function Login() {
  useDocumentTitle('Sign in');
  const { user, setUser } = useAuth();
  const { query } = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(null);

  if (user && !welcome) return <Navigate to={safeNext(query.next, user.role)} />;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.email || !form.password) {
      setError('Enter your e-mail and password.');
      return;
    }
    setBusy(true);
    try {
      // The server recognises the account type; show it briefly, then hand
      // the signed-in user to the app and open the right workspace.
      const { user: u } = await api.post('/api/auth/login', { email: form.email.trim(), password: form.password });
      setWelcome(u);
      setTimeout(() => {
        setUser(u);
        navigate(safeNext(query.next, u.role), { replace: true });
      }, 900);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (welcome) {
    const d = DESTINATION[welcome.role];
    return (
      <AuthLayout>
        <div className="signin-welcome" role="status" aria-live="polite">
          <span className={`signin-welcome__icon signin-welcome__icon--${welcome.role}`} aria-hidden>
            <d.icon />
          </span>
          <p className="signin-welcome__check">
            <LuCircleCheck aria-hidden /> Signed in
          </p>
          <h1>Welcome, {welcome.full_name.split(' ')[0]}</h1>
          <p>
            <span className={`role-pill role-pill--${welcome.role}`}>{d.label} account</span>
          </p>
          <p className="muted">Opening {d.place}…</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>Sign in</h1>
      <p className="muted">One sign-in for everyone. Wayguard recognises your account and opens the right place.</p>
      <ul className="signin-roles" aria-label="Where you will go">
        {Object.entries(DESTINATION).map(([key, d]) => (
          <li key={key}>
            <d.icon aria-hidden />
            <span>
              <strong>{d.label}</strong> → {d.place}
            </span>
          </li>
        ))}
      </ul>
      <form className="form-stack" onSubmit={submit} noValidate>
        {error && <Alert type="error">{error}</Alert>}
        <TextField
          label="E-mail"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <Button type="submit" variant="navy" size="lg" block loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="auth__switch">
        New to Wayguard? <Link to={`/register${query.next ? `?next=${encodeURIComponent(query.next)}` : ''}`}>Create a citizen account</Link>
      </p>
      <p className="auth__switch small">
        Forgot your password? Ask your LGU administrator to reset it.
      </p>
      {__WG_PREVIEW__ && (
        <div className="signin-demo">
          <p className="small">
            <strong>Preview demo accounts</strong> (password <code>preview</code>). Tap one to fill the form:
          </p>
          <div className="cluster">
            {PREVIEW_ACCOUNTS.map(([email, label]) => (
              <button key={email} type="button" className="chip" onClick={() => setForm({ email, password: 'preview' })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
