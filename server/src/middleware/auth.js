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

// The platform administrator is the highest authority: anything an LGU
// administrator or staff member may do, it may do in every LGU (its scope,
// resolved in sessions.js, is every jurisdiction). Citizen-only and
// crew-only actions stay with those roles.
export function hasRole(user, roles) {
  if (!user) return false;
  if (roles.includes(user.role)) return true;
  return user.role === 'platform_admin' && (roles.includes('admin') || roles.includes('staff'));
}

// True for anyone who manages reports for an LGU (admin, staff, platform admin).
export function isLguManager(user) {
  return hasRole(user, ['admin', 'staff']);
}

// True for an LGU administrator or the platform administrator.
export function isAdministrator(user) {
  return hasRole(user, ['admin']);
}

export function requireRole(...roles) {
  const auth = requireAuth();
  return async function ensureRole(ctx, next) {
    await auth(ctx, async () => {
      if (!hasRole(ctx.user, roles)) throw forbidden();
      await next();
    });
  };
}
