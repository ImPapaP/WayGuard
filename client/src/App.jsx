import { Router, Routes, Navigate, useLocation, useParams } from './lib/router.jsx';
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

import Tasks from './pages/crew/Tasks.jsx';
import TaskDetail from './pages/crew/TaskDetail.jsx';
import CrewMap from './pages/crew/CrewMap.jsx';

// Shows the page only to signed-in users with one of `roles`. The server
// enforces the same rules; this guard just routes people to the right place.
function Protected({ roles, children }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  if (user === undefined) return <Loading label="Opening Wayguard…" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} />;
  if (user.must_change_password) return <ForcePasswordChange />;
  if (!roles.includes(user.role)) return <Navigate to={HOME_BY_ROLE[user.role]} />;
  return children;
}

// Links in e-mails point to /r/:id; send each role to its own report view.
function ReportRedirect() {
  const { id } = useParams();
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  if (!user) return <Navigate to={`/login?next=/r/${id}`} />;
  const path = { citizen: `/app/reports/${id}`, admin: `/admin/reports/${id}`, maintenance: `/crew/tasks/${id}` }[user.role];
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
  <Protected roles={['admin']}>
    <AdminShell>{el}</AdminShell>
  </Protected>
);

const routes = [
  { path: '/', element: <PublicLayout><Landing /></PublicLayout> },
  { path: '/map', element: <PublicLayout bare><PublicMap /></PublicLayout> },
  { path: '/login', element: <Login /> },
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

  { path: '/admin', element: admin(<Dashboard />) },
  { path: '/admin/reports', element: admin(<AdminReports />) },
  { path: '/admin/reports/:id', element: admin(<ReportReview />) },
  { path: '/admin/map', element: admin(<AdminMap />) },
  { path: '/admin/exports', element: admin(<Exports />) },
  { path: '/admin/users', element: admin(<Users />) },
  { path: '/admin/teams', element: admin(<Teams />) },
  { path: '/admin/settings', element: admin(<Settings />) },
  { path: '/admin/activity', element: admin(<Activity />) },
  { path: '/admin/notifications', element: admin(<Notifications />) },
  { path: '/admin/profile', element: admin(<Profile />) },
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
