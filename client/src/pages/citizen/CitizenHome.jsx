import { LuCamera, LuMap, LuChevronRight } from 'react-icons/lu';
import { useAuth } from '../../lib/auth.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { Link } from '../../lib/router.jsx';
import { Loading } from '../../components/ui.jsx';
import ReportCard from '../../components/ReportCard.jsx';

export default function CitizenHome() {
  useDocumentTitle('Home');
  const { user, config } = useAuth();
  const { data, loading } = useApi('/api/reports/mine?pageSize=3');
  const counts = data?.counts || {};
  const open = ['submitted', 'under_review', 'verified', 'assigned', 'in_progress'].reduce((n, s) => n + (counts[s] || 0), 0);
  const firstName = user.full_name.split(' ')[0];

  return (
    <div className="container page page--narrow">
      <h1 className="home-greeting">Hi, {firstName}</h1>
      <Link to="/app/report" className="report-cta">
        <span className="report-cta__icon" aria-hidden>
          <LuCamera />
        </span>
        <span>
          <strong>Report a pothole</strong>
          <span>Photo, location and a short description. It takes about a minute.</span>
        </span>
        <LuChevronRight aria-hidden className="report-cta__chev" />
      </Link>

      <section className="home-summary" aria-label="Your reports at a glance">
        <Link to="/app/reports?filter=open" className="home-summary__item">
          <span className="numeral">{data ? open : '–'}</span>
          <span>being handled</span>
        </Link>
        <Link to="/app/reports?filter=resolved" className="home-summary__item">
          <span className="numeral">{data ? counts.resolved || 0 : '–'}</span>
          <span>repaired</span>
        </Link>
        <Link to="/app/map" className="home-summary__item home-summary__item--map">
          <LuMap aria-hidden />
          <span>Pothole map</span>
        </Link>
      </section>

      <section aria-labelledby="recent-title">
        <div className="panel__head">
          <h2 id="recent-title">Your latest reports</h2>
          {data?.total > 3 && <Link to="/app/reports">See all {data.total}</Link>}
        </div>
        {loading && !data ? (
          <Loading />
        ) : data?.items.length ? (
          <ul className="report-list">
            {data.items.map((r) => (
              <li key={r.id}>
                <ReportCard report={r} to={`/app/reports/${r.id}`} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            Reports you send will appear here so you can follow them. Reports go to {config?.lgu_name || 'your LGU'}.
          </p>
        )}
      </section>
    </div>
  );
}
