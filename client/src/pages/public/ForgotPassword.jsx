// "Forgot your password?": asks for the e-mail address and sends a one-time
// reset link. The reply never says whether the address has an account.
import { useState } from 'react';
import { LuMailCheck, LuKeyRound, LuArrowLeft } from 'react-icons/lu';
import { Link } from '../../lib/router.jsx';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../lib/hooks.js';
import { AuthLayout } from '../../components/Shells.jsx';
import { Alert, Button, TextField } from '../../components/ui.jsx';

export default function ForgotPassword() {
  useDocumentTitle('Reset your password');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError({ fields: { email: 'Enter the e-mail address you sign in with.' } });
      return;
    }
    setBusy(true);
    try {
      setSent(await api.post('/api/auth/forgot-password', { email: email.trim() }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      {sent ? (
        <div className="reset-done">
          <span className="register-heading__icon" aria-hidden><LuMailCheck /></span>
          <h1>Check your e-mail</h1>
          {sent.email_enabled ? (
            <p className="muted">
              If <strong>{email.trim()}</strong> has a Wayguard account, a link to choose a new password is on its way. It works once and expires in {sent.minutes} minutes. Check your spam folder too.
            </p>
          ) : (
            <Alert type="warn" title="E-mail is not set up on this Wayguard yet">
              Ask your LGU administrator to reset your password; they can give you a temporary one from the Users page.
            </Alert>
          )}
          <p className="auth__switch"><Link to="/login"><LuArrowLeft aria-hidden /> Back to sign in</Link></p>
        </div>
      ) : (
        <>
          <div className="register-heading">
            <span className="register-heading__icon" aria-hidden><LuKeyRound /></span>
            <p className="eyebrow">Account help</p>
            <h1>Forgot your password?</h1>
            <p className="muted">Enter the e-mail address you sign in with and we will send you a link to choose a new one.</p>
          </div>
          <form className="form-stack" onSubmit={submit} noValidate>
            {error?.message && <Alert type="error">{error.message}</Alert>}
            <TextField
              label="E-mail"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error?.fields?.email}
            />
            <Button type="submit" variant="navy" size="lg" block loading={busy}>Send reset link</Button>
          </form>
          <p className="auth__switch"><Link to="/login">Back to sign in</Link></p>
        </>
      )}
    </AuthLayout>
  );
}
