import { Router, Routes, Navigate, Link, useLocation, useParams } from './lib/router.jsx';
import { AuthProvider, useAuth, HOME_BY_ROLE } from './lib/auth.jsx';
import { ToastProvider } from './lib/toast.jsx';
import { Loading } from './components/ui.jsx';
import { PublicLayout, AppShell, AdminShell } from './components/Shells.jsx';

import Landing from './pages/public/Landing.jsx';
import PublicMap from './pages/public/PublicMap.jsx';
import Login from './pages/public/Login.jsx';
import Register from './pages/public/Register.jsx';
import NotFound from './pages/public/NotFound.jsx';
import ForcePasswordChange from './pages/shared/ForcePasswordChange.jsx';
import Notifications from './pages/shared/Notifications.jsx';
import Profile from './pages/shared/Profile.jsx';

import CitizenHome from './pages/citizen/CitizenHome.jsx';
import NewReport from './pages/citizen/NewReport.jsx';
import MyReports from './pages/citizen/MyReports.jsx';
import ReportDetail from './pages/citizen/ReportDetail.jsx';

import Dashboard from './pages/admin/Dashboard.jsx';
import AdminReports from './pages/admin/AdminReports.jsx';
import ReportReview from './pages/admin/ReportReview.jsx';
import AdminMap from './pages/admin/AdminMap.jsx';
import Users from './pages/admin/Users.jsx';
import Teams from './pages/admin/Teams.jsx';
import Settings from './pages/admin/Settings.jsx';
import Exports from './pages/admin/Exports.jsx';
import Activity from './pages/admin/Activity.jsx';
import LGUs from './pages/platform/LGUs.jsx';
import Accounts from './pages/platform/Accounts.jsx';

import Tasks from './pages/crew/Tasks.jsx';
import TaskDetail from './pages/crew/TaskDetail.jsx';
import CrewMap from './pages/crew/CrewMap.jsx';

// Shows the page only to signed-in users with one of `roles`. The server
// enforces the same rules; this guard just routes people to the right place.
function Protected({ roles, children, explainAccessDenied = false }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  if (user === undefined) return <Loading label="Opening Wayguard…" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} />;
  if (user.must_change_password) return <ForcePasswordChange />;
  if (!roles.includes(user.role)) {
    if (explainAccessDenied) {
      return (
        <PublicLayout>
          <div className="container page">
            <section className="panel" style={{ maxWidth: 760, margin: '36px auto' }}>
              <p className="eyebrow">Platform administration</p>
              <h1>Platform management access required</h1>
              <p className="muted">
                Accounts and jurisdiction assignments are available only to a platform administrator.
                You are currently signed in with the {String(user.role || 'unknown').replaceAll('_', ' ')} role.
                LGU administrator accounts can manage only their own assigned operational area.
              </p>
              <Link className="btn btn--navy" to={HOME_BY_ROLE[user.role] || '/'}>
                Return to my workspace
              </Link>
            </section>
          </div>
        </PublicLayout>
      );
    }
    return <Navigate to={HOME_BY_ROLE[user.role] || '/'} />;
  }
  return children;
}

// Links in e-mails point to /r/:id; send each role to its own report view.
function ReportRedirect() {
  const { id } = useParams();
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  if (!user) return <Navigate to={`/login?next=/r/${id}`} />;
  const path = { citizen: `/app/reports/${id}`, admin: `/admin/reports/${id}`, staff: `/admin/reports/${id}`, maintenance: `/crew/tasks/${id}`, platform_admin: '/platform/lgus' }[user.role];
  return <Navigate to={path} />;
}

const citizen = (el) => (
  <Protected roles={['citizen']}>
    <AppShell kind="citizen">{el}</AppShell>
  </Protected>
);
const crew = (el) => (
  <Protected roles={['maintenance']}>
    <AppShell kind="crew">{el}</AppShell>
  </Protected>
);
const admin = (el) => (
  <Protected roles={['admin', 'platform_admin']}>
    <AdminShell>{el}</AdminShell>
  </Protected>
);
const adminStaff = (el) => (
  <Protected roles={['admin', 'staff', 'platform_admin']}>
    <AdminShell>{el}</AdminShell>
  </Protected>
);
const platformAdmin = (el) => <Protected roles={['platform_admin']} explainAccessDenied>{el}</Protected>;

const routes = [
  { path: '/', element: <PublicLayout><Landing /></PublicLayout> },
  { path: '/map', element: <PublicLayout bare><PublicMap /></PublicLayout> },
  { path: '/login', element: <Login /> },
  { path: '/platform/lgus', element: platformAdmin(<LGUs />) },
  { path: '/platform/accounts', element: platformAdmin(<Accounts />) },
  { path: '/register', element: <Register /> },
  { path: '/r/:id', element: <ReportRedirect /> },

  { path: '/app', element: citizen(<CitizenHome />) },
  { path: '/app/report', element: citizen(<NewReport />) },
  { path: '/app/reports', element: citizen(<MyReports />) },
  { path: '/app/reports/:id', element: citizen(<ReportDetail />) },
  { path: '/app/map', element: citizen(<PublicMap inApp />) },
  { path: '/app/notifications', element: citizen(<Notifications />) },
  { path: '/app/profile', element: citizen(<Profile />) },

  { path: '/crew', element: crew(<Tasks scope="active" />) },
  { path: '/crew/history', element: crew(<Tasks scope="history" />) },
  { path: '/crew/map', element: crew(<CrewMap />) },
  { path: '/crew/tasks/:id', element: crew(<TaskDetail />) },
  { path: '/crew/notifications', element: crew(<Notifications />) },
  { path: '/crew/profile', element: crew(<Profile />) },

  { path: '/admin', element: adminStaff(<Dashboard />) },
  { path: '/admin/reports', element: adminStaff(<AdminReports />) },
  { path: '/admin/reports/:id', element: adminStaff(<ReportReview />) },
  { path: '/admin/map', element: adminStaff(<AdminMap />) },
  { path: '/admin/exports', element: adminStaff(<Exports />) },
  { path: '/admin/users', element: admin(<Users />) },
  { path: '/admin/teams', element: admin(<Teams />) },
  { path: '/admin/settings', element: admin(<Settings />) },
  { path: '/admin/activity', element: admin(<Activity />) },
  { path: '/admin/notifications', element: adminStaff(<Notifications />) },
  { path: '/admin/profile', element: adminStaff(<Profile />) },
];

// `banner` is only used by the self-contained browser preview build.
export default function App({ banner = null }) {
  return (
    <Router>
      <AuthProvider>
        <ToastProvider>
          {banner}
          <Routes routes={routes} fallback={<PublicLayout><NotFound /></PublicLayout>} />
        </ToastProvider>
      </AuthProvider>
    </Router>
  );
}
