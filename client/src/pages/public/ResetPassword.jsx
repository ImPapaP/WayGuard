// Opened from the e-mailed link: choose a new password.
import { useState } from 'react';
import { LuKeyRound, LuCircleCheck } from 'react-icons/lu';
import { Link, useLocation } from '../../lib/router.jsx';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { AuthLayout } from '../../components/Shells.jsx';
import { Alert, Button, Loading, PasswordField, PasswordRules } from '../../components/ui.jsx';

export default function ResetPassword() {
  useDocumentTitle('Choose a new password');
  const { query } = useLocation();
  const token = String(query.token || '');
  const { data: check, loading } = useApi(token ? `/api/auth/reset-password?token=${encodeURIComponent(token)}` : null);
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const v = {};
    if (form.password.length < 8) v.password = 'Use at least 8 characters.';
    else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) v.password = 'Include at least one letter and one number.';
    if (form.confirm !== form.password) v.confirm = 'The passwords do not match.';
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', { token, new_password: form.password });
      setDone(true);
    } catch (err) {
      setErrors(err.fields?.new_password ? { password: err.fields.new_password } : {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (!token || (!loading && check && !check.valid)) {
    body = (
      <>
        <h1>This link can’t be used</h1>
        <Alert type="warn">Reset links work once and expire after an hour. Ask for a new one.</Alert>
        <p className="auth__switch"><Link to="/forgot-password">Send a new reset link</Link></p>
      </>
    );
  } else if (loading || !check) {
    body = <Loading label="Checking your link…" />;
  } else if (done) {
    body = (
      <div className="reset-done">
        <span className="register-heading__icon" aria-hidden><LuCircleCheck /></span>
        <h1>Password changed</h1>
        <p className="muted">For your safety, every device that was signed in to your account has been signed out.</p>
        <Link to="/login" className="btn btn--navy btn--lg btn--block">Sign in</Link>
      </div>
    );
  } else {
    body = (
      <>
        <div className="register-heading">
          <span className="register-heading__icon" aria-hidden><LuKeyRound /></span>
          <p className="eyebrow">Account help</p>
          <h1>Choose a new password</h1>
        </div>
        <form className="form-stack" onSubmit={submit} noValidate>
          {error && <Alert type="error">{error}</Alert>}
          <PasswordField label="New password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} />
          <PasswordField label="Repeat new password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={errors.confirm} />
          <PasswordRules value={form.password} confirm={form.confirm} />
          <Button type="submit" variant="navy" size="lg" block loading={busy}>Save new password</Button>
        </form>
      </>
    );
  }
  return <AuthLayout>{body}</AuthLayout>;
}
