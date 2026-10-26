import { useState } from 'react';
import { LuSmartphone, LuLayoutDashboard, LuHardHat, LuCircleCheck, LuShieldCheck } from 'react-icons/lu';
import { Link, Navigate, useLocation, useNavigate } from '../../lib/router.jsx';
import { useAuth, HOME_BY_ROLE } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../lib/hooks.js';
import { AuthLayout } from '../../components/Shells.jsx';
import { Button, TextField, PasswordField, Alert } from '../../components/ui.jsx';

// Only same-site paths are accepted as a redirect target.
export function safeNext(next, role) {
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) {
    const prefix = { citizen: '/app', admin: '/admin', staff: '/admin', maintenance: '/crew', platform_admin: '/platform/lgus' }[role];
    if (next.startsWith(prefix) || next.startsWith('/r/') || next === '/map') return next;
  }
  return HOME_BY_ROLE[role];
}

// Where each kind of account lands after signing in.
const DESTINATION = {
  citizen: { label: 'Citizen', place: 'your reports', icon: LuSmartphone },
  admin: { label: 'LGU administrator', place: 'the LGU dashboard', icon: LuLayoutDashboard },
  staff: { label: 'LGU staff', place: 'the LGU report workspace', icon: LuLayoutDashboard },
  maintenance: { label: 'Road crew', place: 'your repair tasks', icon: LuHardHat },
  platform_admin: { label: 'Platform administrator', place: 'LGU management', icon: LuShieldCheck },
};

export default function Login() {
  useDocumentTitle('Sign in');
  const { user, setUser, refreshConfig } = useAuth();
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
      await refreshConfig();
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
      <div className="signin-heading">
        <h1>Welcome back</h1>
        <p className="muted">Sign in to continue to your Wayguard account.</p>
      </div>
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
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <p className="signin-forgot"><Link to="/forgot-password">Forgot your password?</Link></p>
        <Button type="submit" variant="navy" size="lg" block loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="auth__switch">
        New to Wayguard? <Link to={`/register${query.next ? `?next=${encodeURIComponent(query.next)}` : ''}`}>Create a citizen account</Link>
      </p>
      <p className="auth__switch small" id="forgot-password">
        Can’t reach your e-mail? Your LGU administrator can also reset your password.
      </p>
      <p className="auth__switch auth__return-home">
        <Link to="/">← Return to landing page</Link>
      </p>
    </AuthLayout>
  );
}
