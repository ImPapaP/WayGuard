// Account management (FR-01): profile details, e-mail preference, password.
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useToast } from '../../lib/toast.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';
import { Button, TextField, Alert, Facts } from '../../components/ui.jsx';
import { ROLES, formatDate } from '../../lib/format.js';
import ChangePasswordForm from './ChangePasswordForm.jsx';

export default function Profile() {
  useDocumentTitle('Profile');
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    full_name: user.full_name,
    phone: user.phone || '',
    email_notifications: user.email_notifications,
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user: u } = await api.patch('/api/auth/profile', {
        full_name: form.full_name,
        phone: form.phone || null,
        email_notifications: form.email_notifications,
      });
      setUser(u);
      setErrors({});
      toast('Profile saved.');
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container page page--narrow">
      <div className="page-head">
        <div>
          <h1>Profile</h1>
          <p>Manage your details and password.</p>
        </div>
      </div>
      <div className="stack stack--lg">
        <section className="panel" aria-labelledby="acct-title">
          <h2 id="acct-title" className="section-title">
            Account
          </h2>
          <Facts
            items={[
              ['E-mail', user.email],
              ['Role', ROLES[user.role]],
              ['Team', user.team_name],
              ['Member since', formatDate(user.created_at)],
            ]}
          />
        </section>
        <section className="panel" aria-labelledby="details-title">
          <h2 id="details-title" className="section-title">
            Your details
          </h2>
          <form className="form-stack" onSubmit={save} noValidate>
            {error && <Alert type="error">{error}</Alert>}
            <TextField
              label="Full name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              error={errors.full_name}
              autoComplete="name"
            />
            <TextField
              label="Mobile number"
              optional
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              error={errors.phone}
              autoComplete="tel"
            />
            <label className="checkline">
              <input
                type="checkbox"
                checked={form.email_notifications}
                onChange={(e) => setForm({ ...form, email_notifications: e.target.checked })}
              />
              <span>
                Also send my notifications by e-mail
                <span className="field__hint" style={{ display: 'block' }}>
                  In-app notifications are always on. E-mail works when the LGU has set up an e-mail server.
                </span>
              </span>
            </label>
            <div>
              <Button type="submit" variant="navy" loading={busy}>
                Save details
              </Button>
            </div>
          </form>
        </section>
        <section className="panel" aria-labelledby="pw-title">
          <h2 id="pw-title" className="section-title">
            Password
          </h2>
          <ChangePasswordForm />
        </section>
      </div>
    </div>
  );
}
