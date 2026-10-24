import { AuthLayout } from '../../components/Shells.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';
import { Alert, Button } from '../../components/ui.jsx';
import ChangePasswordForm from './ChangePasswordForm.jsx';

// Shown after signing in with a temporary password set by an administrator.
export default function ForcePasswordChange() {
  useDocumentTitle('Choose a new password');
  const { user, logout } = useAuth();
  return (
    <AuthLayout>
      <h1>Choose your own password</h1>
      <Alert type="info" className="mb">
        Hello {user?.full_name}. Your account was set up by an LGU administrator with a temporary password. Choose a new one
        that only you know before continuing.
      </Alert>
      <div style={{ marginTop: 20 }}>
        <ChangePasswordForm submitLabel="Save and continue" />
      </div>
      <p className="auth__switch">
        <Button variant="ghost" onClick={logout}>
          Sign out instead
        </Button>
      </p>
    </AuthLayout>
  );
}
