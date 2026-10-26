import { LuBell, LuCamera, LuCircleCheck, LuHardHat, LuLayoutDashboard, LuLock, LuLogIn, LuSearch, LuSmartphone, LuWrench } from 'react-icons/lu';
import { Link } from '../../lib/router.jsx';
import { useAuth, HOME_BY_ROLE } from '../../lib/auth.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import MapView, { MapLegend } from '../../components/MapView.jsx';
import HeroBackdrop from '../../components/HeroBackdrop.jsx';
import CountUp from '../../components/CountUp.jsx';

const STEPS = [
  { icon: LuCamera, title: 'You report it', text: 'Take a photo, pin the spot with GPS or the map, and rate how dangerous it is.' },
  { icon: LuSearch, title: 'The LGU checks it', text: 'An administrator verifies the photo and location, and flags reports that repeat an existing one.' },
  { icon: LuWrench, title: 'A road crew fixes it', text: 'The repair is assigned to a maintenance team, who upload before-and-after photos.' },
  { icon: LuCircleCheck, title: 'The repair is confirmed', text: 'The LGU checks the finished work and closes the report. You can rate the repair.' },
];

const ROLE_CARDS = [
  {
    key: 'citizen',
    icon: LuSmartphone,
    title: 'Citizens',
    text: 'Report potholes with a photo and location, follow each report to the repair, and rate the work.',
    dest: 'your reports app',
  },
  {
    key: 'admin',
    icon: LuLayoutDashboard,
    title: 'LGU administrators and staff',
    text: 'Work on reports for your own city or municipality. Administrators manage staff and teams; staff review reports and track repairs.',
    dest: 'your LGU workspace',
  },
  {
    key: 'crew',
    icon: LuHardHat,
    title: 'Road crews',
    text: 'See assigned repairs on a map, get directions, post progress and before-and-after photos.',
    dest: 'your repair tasks',
  },
];

export default function Landing() {
  useDocumentTitle(null);
  const { user, config } = useAuth();
  const { data: reports } = useApi('/api/public/reports');
  const { data: stats } = useApi('/api/public/stats');
  const reportHref = user ? (user.role === 'citizen' ? '/app/report' : HOME_BY_ROLE[user.role]) : '/register';

  return (
    <>
      <section className="hero">
        <HeroBackdrop />
        <div className="container hero__inner">
          <div className="hero__copy">
            <h1 className="hero__title">Report a pothole. Follow it until the road is fixed.</h1>
            <p className="hero__lead">
              Send a photo and the exact location to {user?.lgu_name || 'your local government'}. You will be notified as the
              report is reviewed, assigned to a road crew and repaired.
            </p>
            <div className="cluster">
              <Link to={reportHref} className="btn btn--primary btn--lg">
                <LuCamera aria-hidden /> Report a pothole
              </Link>
              <Link to="/map" className="btn btn--secondary btn--lg">
                See reported potholes
              </Link>
            </div>
            {stats && stats.total_reports > 0 && (
              <p className="hero__stats">
                <CountUp value={stats.total_reports} /> reported,{' '}
                <CountUp value={stats.resolved} /> repaired
                {stats.avg_days_to_resolve ? (
                  <>
                    , <CountUp value={stats.avg_days_to_resolve} /> days from report to repair on average
                  </>
                ) : null}
                .
              </p>
            )}
          </div>
          <div className="hero__map" data-reveal>
            <MapView
              markers={reports?.items || []}
              fitToMarkers={(reports?.items?.length || 0) > 1}
              height={440}
              label="Map of verified pothole reports"
            />
            <div className="hero__map-foot">
              <MapLegend />
              <Link to="/map">Open the full map</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="journey" aria-labelledby="journey-title">
        <div className="container">
          <h2 id="journey-title" data-reveal>What happens after you report</h2>
          <ol className="journey__road">
            {STEPS.map((s, i) => (
              <li key={s.title} className="journey__stop" data-reveal style={{ '--i': i }}>
                <span className="journey__marker" aria-hidden>
                  <s.icon />
                </span>
                <span className="journey__num">Step {i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="roles" aria-labelledby="roles-title">
        <HeroBackdrop bubbles={false} />
        <div className="container">
          <div className="roles__head" data-reveal>
            <h2 id="roles-title">One sign-in for everyone</h2>
            <p>
              Citizens, LGU administrators and road crews all use the same sign-in page. Wayguard recognises your account and
              opens the right workspace.
            </p>
          </div>
          <ul className="roles__grid">
            {ROLE_CARDS.map((r, i) => (
              <li key={r.title} className={`role-card role-card--${r.key}`} data-reveal style={{ '--i': i }}>
                <span className="role-card__icon" aria-hidden>
                  <r.icon />
                </span>
                <h3>{r.title}</h3>
                <p>{r.text}</p>
                <span className="role-card__dest">
                  Opens <strong>{r.dest}</strong>
                </span>
              </li>
            ))}
          </ul>
          <div className="roles__cta cluster">
            <Link to={user ? HOME_BY_ROLE[user.role] : '/login'} className="btn btn--navy btn--lg">
              <LuLogIn aria-hidden /> {user ? 'Open my workspace' : 'Sign in'}
            </Link>
            {!user && (
              <Link to="/register" className="btn btn--secondary btn--lg">
                Create a citizen account
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="landing-notes">
        <div className="container landing-notes__grid">
          <div data-reveal style={{ '--i': 0 }}>
            <h3>
              <LuBell aria-hidden /> Updates come to you
            </h3>
            <p>Every status change appears in your Wayguard alerts, and by e-mail if the LGU has e-mail enabled.</p>
          </div>
          <div data-reveal style={{ '--i': 1 }}>
            <h3>
              <LuLock aria-hidden /> Your details stay private
            </h3>
            <p>
              The public map shows only verified potholes. Your name, phone number and photos are visible to LGU personnel
              only.
            </p>
          </div>
          <div data-reveal style={{ '--i': 2 }}>
            <h3>
              <LuWrench aria-hidden /> For LGU staff and road crews
            </h3>
            <p>
              Administrators and maintenance personnel use accounts created by the LGU. <Link to="/login">Sign in here</Link>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
