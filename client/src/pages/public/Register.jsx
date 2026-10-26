import { useState } from 'react';
import { LuEye, LuEyeOff } from 'react-icons/lu';
import { Link, Navigate, useLocation, useNavigate } from '../../lib/router.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';
import { AuthLayout } from '../../components/Shells.jsx';
import { Button, TextField, Alert } from '../../components/ui.jsx';
import { safeNext } from './Login.jsx';

function validate(f) {
  const e = {};
  if (f.full_name.trim().length < 2) e.full_name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'Enter a valid e-mail address.';
  if (f.phone && !/^\+?[0-9 ()-]{7,20}$/.test(f.phone.trim())) e.phone = 'Enter a valid phone number, or leave it blank.';
  if (f.password.length < 8) e.password = 'Use at least 8 characters.';
  else if (!/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) e.password = 'Include at least one letter and one number.';
  if (f.confirm !== f.password) e.confirm = 'The passwords do not match.';
  return e;
}

export default function Register() {
  useDocumentTitle('Create an account');
  const { user, register } = useAuth();
  const { query } = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  if (user) return <Navigate to={safeNext(query.next, user.role)} />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

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
      });
      navigate(query.next && query.next.startsWith('/app') ? query.next : '/app/report', { replace: true });
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Create a citizen account</h1>
      <p className="muted">You need an account so the LGU can send you updates about your reports.</p>
      <form className="form-stack" onSubmit={submit} noValidate>
        {error && <Alert type="error">{error}</Alert>}
        <TextField label="Full name" autoComplete="name" value={form.full_name} onChange={set('full_name')} error={errors.full_name} />
        <TextField
          label="E-mail"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
        />
        <TextField
          label="Mobile number"
          optional
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          hint="Only LGU personnel can see it, in case they need to ask about a report."
          value={form.phone}
          onChange={set('phone')}
          error={errors.phone}
        />
        <TextField
          label="Password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number."
          value={form.password}
          onChange={set('password')}
          error={errors.password}
        />
        <button type="button" className="linkish password-visibility" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}>
          {showPassword ? <LuEyeOff aria-hidden /> : <LuEye aria-hidden />}
          {showPassword ? 'Hide password' : 'Show password'}
        </button>
        <TextField
          label="Repeat password"
          type={showConfirm ? 'text' : 'password'}
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
        />
        <button type="button" className="linkish password-visibility" aria-label={showConfirm ? 'Hide confirmation password' : 'Show confirmation password'} aria-pressed={showConfirm} onClick={() => setShowConfirm((shown) => !shown)}>
          {showConfirm ? <LuEyeOff aria-hidden /> : <LuEye aria-hidden />}
          {showConfirm ? 'Hide password' : 'Show password'}
        </button>
        <Button type="submit" variant="navy" size="lg" block loading={busy}>
          Create account
        </Button>
      </form>
      <p className="auth__switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
