// Searchable, filterable reports table (FR-08). Filters live in the URL so a
// filtered view can be bookmarked or opened from the dashboard.
import { useEffect, useState } from 'react';
import { LuSearch, LuCopy, LuDownload, LuImage, LuX, LuUsers } from 'react-icons/lu';
import { useApi, useDebounced, useDocumentTitle } from '../../lib/hooks.js';
import { qs, withFocus } from '../../lib/api.js';
import { Link, useNavigate, useQueryState } from '../../lib/router.jsx';
import { DemoTag, EmptyState, ErrorState, Loading, Pagination, PriorityBadge, SeverityBadge, StatusBadge } from '../../components/ui.jsx';
import { ALL_STATUSES, STATUS, formatDate, isAwaitingVerification, timeAgo } from '../../lib/format.js';

const FILTER_KEYS = ['q', 'status', 'severity', 'barangay', 'team_id', 'agency_id', 'from', 'to', 'has_duplicates', 'awaiting_completion'];

export function exportQuery(query) {
  return Object.fromEntries(FILTER_KEYS.filter((k) => query[k]).map((k) => [k, query[k]]));
}

export default function AdminReports() {
  useDocumentTitle('Reports');
  const navigate = useNavigate();
  const [query, setQuery] = useQueryState();
  const [search, setSearch] = useState(query.q || '');
  const debounced = useDebounced(search);
  const { data: brgys } = useApi('/api/admin/barangays');
  const { data: teams } = useApi('/api/admin/teams');

  useEffect(() => {
    if ((query.q || '') !== debounced) setQuery({ q: debounced, page: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const params = { ...exportQuery(query), sort: query.sort || 'priority', page: query.page || 1 };
  const { data, error, loading, reload } = useApi(`/api/admin/reports${qs(params)}`);
  const statuses = (query.status || '').split(',').filter(Boolean);
  const activeFilters = FILTER_KEYS.filter((k) => query[k]).length;

  const toggleStatus = (s) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setQuery({ status: next.join(','), awaiting_completion: '', page: '' });
  };

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>{data ? `${data.total} report${data.total === 1 ? '' : 's'}${activeFilters ? ' match these filters' : ''}` : ' '}</p>
        </div>
        <div className="page-head__actions">
          <a className="btn btn--secondary btn--sm" href={withFocus(`/api/admin/exports/reports.csv${qs(exportQuery(query))}`)} download>
            <LuDownload aria-hidden /> CSV
          </a>
          <a className="btn btn--secondary btn--sm" href={withFocus(`/api/admin/exports/reports.pdf${qs(exportQuery(query))}`)} download>
            <LuDownload aria-hidden /> PDF
          </a>
        </div>
      </div>

      <div className="filters panel">
        <div className="filters__row">
          <div className="search-input">
            <LuSearch aria-hidden />
            <input
              className="input"
              type="search"
              placeholder="Search code, road, barangay, landmark or description"
              aria-label="Search reports"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="select select--sm" aria-label="Severity" value={query.severity || ''} onChange={(e) => setQuery({ severity: e.target.value, page: '' })}>
            <option value="">Any severity</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select className="select select--sm" aria-label="Barangay" value={query.barangay || ''} onChange={(e) => setQuery({ barangay: e.target.value, page: '' })}>
            <option value="">All barangays</option>
            {brgys?.items.map((b) => (
              <option key={b.barangay} value={b.barangay}>
                {b.barangay} ({b.n})
              </option>
            ))}
          </select>
          <select className="select select--sm" aria-label="Assigned team" value={query.team_id || ''} onChange={(e) => setQuery({ team_id: e.target.value, page: '' })}>
            <option value="">Any team</option>
            {teams?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select className="select select--sm" aria-label="Sort by" value={query.sort || 'priority'} onChange={(e) => setQuery({ sort: e.target.value })}>
            <option value="priority">Sort: highest priority</option>
            <option value="confirmed">Sort: most confirmed by residents</option>
            <option value="newest">Sort: newest</option>
            <option value="oldest">Sort: oldest</option>
            <option value="severity">Sort: most severe</option>
            <option value="updated">Sort: recently updated</option>
          </select>
        </div>
        <div className="filters__row">
          <div className="chips" role="group" aria-label="Status">
            {ALL_STATUSES.map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={statuses.includes(s)} onClick={() => toggleStatus(s)}>
                {STATUS[s].label}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              aria-pressed={query.awaiting_completion === 'true'}
              onClick={() => setQuery({ awaiting_completion: query.awaiting_completion === 'true' ? '' : 'true', status: '', page: '' })}
            >
              Awaiting repair check
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={query.has_duplicates === 'true'}
              onClick={() => setQuery({ has_duplicates: query.has_duplicates === 'true' ? '' : 'true', page: '' })}
            >
              <LuCopy aria-hidden /> Possible duplicates
            </button>
          </div>
        </div>
        <div className="filters__row filters__row--dates">
          <label className="inline-field">
            Reported from
            <input type="date" className="input input--sm" value={query.from || ''} onChange={(e) => setQuery({ from: e.target.value, page: '' })} />
          </label>
          <label className="inline-field">
            to
            <input type="date" className="input input--sm" value={query.to || ''} onChange={(e) => setQuery({ to: e.target.value, page: '' })} />
          </label>
          {activeFilters > 0 && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setSearch('');
                setQuery(Object.fromEntries([...FILTER_KEYS, 'page'].map((k) => [k, ''])));
              }}
            >
              <LuX aria-hidden /> Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="panel panel--flush">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : !data.items.length ? (
          <EmptyState title="No reports found">
            {activeFilters ? 'Try removing a filter or searching for something else.' : 'New citizen reports will appear here.'}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table--stack table--reports">
                <thead>
                  <tr>
                    <th scope="col">Report</th>
                    <th scope="col" title="Priority score, 0–100">Priority</th>
                    <th scope="col">Status</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Location</th>
                    <th scope="col">Reported</th>
                    <th scope="col">Team</th>
                    <th scope="col">
                      <span className="visually-hidden">Flags</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} data-href={`/admin/reports/${r.id}`} onClick={(e) => {
                      if (e.target.closest('a')) return;
                      navigate(`/admin/reports/${r.id}`);
                    }}>
                      <td>
                        <Link to={`/admin/reports/${r.id}`} className="table__code">
                          {r.code}
                        </Link>{' '}
                        {r.is_demo && <DemoTag />}
                      </td>
                      <td data-label="Priority">
                        <PriorityBadge score={r.priority} />
                      </td>
                      <td>
                        <StatusBadge status={r.status} awaiting={isAwaitingVerification(r)} />
                      </td>
                      <td>
                        <SeverityBadge severity={r.severity} />
                      </td>
                      <td className="td-wide">
                        {r.road_name}
                        <span className="table__sub">{[r.barangay, r.landmark].filter(Boolean).join(', ')}</span>
                      </td>
                      <td data-label="Reported" className="nowrap" title={formatDate(r.created_at)}>
                        {timeAgo(r.created_at)}
                      </td>
                      <td data-label="Team" className={r.team_name ? '' : 'td-hide-sm'}>
                        {r.team_name || <span className="muted">None</span>}
                      </td>
                      <td className="nowrap">
                        {r.possible_duplicates > 0 && !['rejected', 'duplicate', 'resolved'].includes(r.status) && (
                          <span className="dup-flag" title={`${r.possible_duplicates} other open report(s) nearby`}>
                            <LuCopy aria-hidden size={12} /> {r.possible_duplicates} nearby
                          </span>
                        )}{' '}
                        {r.confirmations > 0 && (
                          <span className="confirm-flag" title={`${r.confirmations} resident(s) saw it too`}>
                            <LuUsers aria-hidden size={12} /> +{r.confirmations}
                          </span>
                        )}{' '}
                        <span className="muted small" title={`${r.photo_count} photo(s)`}>
                          <LuImage aria-hidden size={13} style={{ verticalAlign: '-2px' }} /> {r.photo_count}
                        </span>
                      </td>
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
