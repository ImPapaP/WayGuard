// Audit trail of administrative actions (users, settings, exports).
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useQueryState } from '../../lib/router.jsx';
import { EmptyState, ErrorState, Loading, Pagination } from '../../components/ui.jsx';
import { formatDateTime } from '../../lib/format.js';

const LABELS = {
  'user.create': 'Created a user account',
  'user.update': 'Updated a user',
  'user.reset_password': 'Reset a password',
  'user.create_admin_cli': 'Administrator created from the command line',
  'team.create': 'Created a team',
  'team.update': 'Updated a team',
  'agency.create': 'Added an agency',
  'agency.update': 'Updated an agency',
  'settings.update': 'Changed system settings',
  'export.csv': 'Exported reports (CSV)',
  'export.pdf': 'Exported reports (PDF)',
  'export.summary_pdf': 'Downloaded the summary report',
  'demo.seed': 'Loaded demonstration data',
};

function describe(row) {
  const d = row.details || {};
  if (row.action.startsWith('export.') && d.count !== undefined) return `${d.count} report(s)`;
  if (row.action === 'user.create') return `${d.email}, ${d.role}`;
  if (row.action === 'user.update') {
    return Object.entries(d)
      .map(([k, v]) => `${k.replace('_', ' ')}: ${v?.from ?? '–'} to ${v?.to ?? '–'}`)
      .join('; ');
  }
  if (row.action === 'settings.update') return Object.keys(d).join(', ').replace(/_/g, ' ');
  if (d.name) return d.name;
  return '';
}

export default function Activity() {
  useDocumentTitle('Activity log');
  const [query, setQuery] = useQueryState();
  const { data, error, loading, reload } = useApi(`/api/admin/audit?page=${query.page || 1}`);
  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Activity log</h1>
          <p>Administrative actions on accounts, settings and exports. Report changes are in each report&apos;s history.</p>
        </div>
      </div>
      <div className="panel panel--flush">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : !data.items.length ? (
          <EmptyState title="No activity yet" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table--stack">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">Action</th>
                    <th scope="col">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td className="nowrap">{formatDateTime(row.created_at)}</td>
                      <td>{row.actor_name || 'System'}</td>
                      <td className="td-wide">{LABELS[row.action] || row.action}</td>
                      <td className="td-wide small muted">{describe(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQuery({ page: p })} />
          </>
        )}
      </div>
    </div>
  );
}
