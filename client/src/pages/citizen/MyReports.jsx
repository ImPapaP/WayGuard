// "My Reports" (FR-09): the citizen's reports and their current status.
import { LuClipboardList, LuPlus } from 'react-icons/lu';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { qs } from '../../lib/api.js';
import { Link, useQueryState } from '../../lib/router.jsx';
import { EmptyState, ErrorState, Loading, Pagination } from '../../components/ui.jsx';
import ReportCard from '../../components/ReportCard.jsx';

const FILTERS = [
  { key: '', label: 'All', statuses: [] },
  { key: 'open', label: 'In progress', statuses: ['submitted', 'under_review', 'verified', 'assigned', 'in_progress'] },
  { key: 'resolved', label: 'Repaired', statuses: ['resolved'] },
  { key: 'closed', label: 'Not accepted', statuses: ['rejected', 'duplicate'] },
];

export default function MyReports() {
  useDocumentTitle('My reports');
  const [query, setQuery] = useQueryState();
  const filter = FILTERS.find((f) => f.key === (query.filter || '')) || FILTERS[0];
  const page = Number(query.page) || 1;
  const { data, error, loading, reload } = useApi(`/api/reports/mine${qs({ status: filter.statuses, page })}`);
  const count = (f) => (data ? (f.statuses.length ? f.statuses.reduce((n, s) => n + (data.counts[s] || 0), 0) : Object.values(data.counts).reduce((a, b) => a + b, 0)) : null);

  return (
    <div className="container page page--narrow">
      <div className="page-head">
        <div>
          <h1>My reports</h1>
          <p>Follow each pothole you reported from review to repair.</p>
        </div>
        <Link to="/app/report" className="btn btn--primary">
          <LuPlus aria-hidden /> Report a pothole
        </Link>
      </div>
      <div className="chips" role="group" aria-label="Filter reports" style={{ marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="chip"
            aria-pressed={filter.key === f.key}
            onClick={() => setQuery({ filter: f.key, page: '' })}
          >
            {f.label} {count(f) !== null && <span className="chip__count">{count(f)}</span>}
          </button>
        ))}
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data.items.length ? (
        <div className="panel">
          <EmptyState
            icon={LuClipboardList}
            title={filter.key ? 'Nothing here' : 'You have not reported any potholes yet'}
            action={
              <Link to="/app/report" className="btn btn--primary">
                Report a pothole
              </Link>
            }
          >
            {filter.key ? 'No reports match this filter.' : 'When you see a pothole, report it here and follow its repair.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <ul className="report-list">
            {data.items.map((r) => (
              <li key={r.id}>
                <ReportCard report={r} to={`/app/reports/${r.id}`} />
              </li>
            ))}
          </ul>
          <div className="panel panel--flush" style={{ marginTop: 12 }}>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQuery({ page: p })} />
          </div>
        </>
      )}
    </div>
  );
}
