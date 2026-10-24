import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useToast } from '../../lib/toast.jsx';
import { Button, TextField, Alert } from '../../components/ui.jsx';

export default function ChangePasswordForm({ onDone, submitLabel = 'Change password' }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const v = {};
    if (!form.current_password) v.current_password = 'Enter your current password.';
    if (form.new_password.length < 8) v.new_password = 'Use at least 8 characters.';
    else if (!/[A-Za-z]/.test(form.new_password) || !/\d/.test(form.new_password)) {
      v.new_password = 'Include at least one letter and one number.';
    }
    if (form.confirm !== form.new_password) v.confirm = 'The passwords do not match.';
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const { user } = await api.post('/api/auth/change-password', {
        current_password: form.current_password,
        new_password: form.new_password,
      });
      setUser(user);
      setForm({ current_password: '', new_password: '', confirm: '' });
      toast('Password changed. Other devices were signed out.');
      onDone?.();
    } catch (err) {
      setErrors(err.fields ? { new_password: err.fields.new_password } : {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit} noValidate>
      {error && <Alert type="error">{error}</Alert>}
      <TextField
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={form.current_password}
        onChange={set('current_password')}
        error={errors.current_password}
      />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters, with a letter and a number."
        value={form.new_password}
        onChange={set('new_password')}
        error={errors.new_password}
      />
      <TextField
        label="Repeat new password"
        type="password"
        autoComplete="new-password"
        value={form.confirm}
        onChange={set('confirm')}
        error={errors.confirm}
      />
      <div>
        <Button type="submit" variant="navy" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
