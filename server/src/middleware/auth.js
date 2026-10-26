// Authentication and role-based authorization guards. Every protected route
// uses these on the server, so hiding a button in the UI is never the only
// protection.
import { HttpError, unauthorized, forbidden } from '../lib/http.js';

export const ROLES = ['citizen', 'admin', 'staff', 'maintenance', 'platform_admin'];

// Routes that remain reachable while a user must change a temporary password.
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/change-password']);

export function requireAuth() {
  return async function ensureSignedIn(ctx, next) {
    if (!ctx.user) throw unauthorized();
    if (ctx.user.must_change_password && !PASSWORD_CHANGE_ALLOWED.has(ctx.path)) {
      throw new HttpError(
        403,
        'Please change your temporary password before continuing.',
        undefined,
        'password_change_required',
      );
    }
    await next();
  };
}

export function requireRole(...roles) {
  const auth = requireAuth();
  return async function ensureRole(ctx, next) {
    await auth(ctx, async () => {
      if (!roles.includes(ctx.user.role)) throw forbidden();
      await next();
    });
  };
}
