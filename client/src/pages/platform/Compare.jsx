// Platform administrator: compare how LGUs handle their pothole reports.
import { useMemo, useState } from 'react';
import { LuArrowDownUp, LuChartColumn, LuDownload } from 'react-icons/lu';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { qs } from '../../lib/api.js';
import { Link } from '../../lib/router.jsx';
import { PublicLayout } from '../../components/Shells.jsx';
import { Alert, EmptyState, Loading } from '../../components/ui.jsx';

const COLUMNS = [
  { key: 'name', label: 'LGU', num: false },
  { key: 'total', label: 'Reports', num: true, best: 'none' },
  { key: 'open', label: 'Open', num: true, best: 'low' },
  { key: 'resolution_rate', label: 'Resolution rate', num: true, unit: '%', best: 'high', bar: 100 },
  { key: 'median_repair_days', label: 'Typical repair (days)', num: true, best: 'low' },
  { key: 'avg_first_response_hours', label: 'First response (hrs)', num: true, best: 'low' },
  { key: 'overdue', label: 'Overdue repairs', num: true, best: 'low' },
  { key: 'rating', label: 'Citizen rating', num: true, unit: '/5', best: 'high' },
];

function csv(items) {
  const head = COLUMNS.map((c) => c.label).concat('Province');
  const lines = items.map((r) => COLUMNS.map((c) => r[c.key] ?? '').concat(r.province || ''));
  return [head, ...lines].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

export default function Compare() {
  useDocumentTitle('Compare LGUs');
  const [range, setRange] = useState({ from: '', to: '' });
  const [sort, setSort] = useState({ key: 'total', dir: 'desc' });
  const [minReports, setMinReports] = useState(1);
  const { data, loading, error } = useApi(`/api/platform/compare${qs(range)}`);

  const items = useMemo(() => {
    const list = (data?.items || []).filter((r) => r.total >= minReports);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return typeof x === 'string' ? x.localeCompare(y) * dir : (x - y) * dir;
    });
  }, [data, sort, minReports]);

  // Best value in each column, to highlight it.
  const best = useMemo(() => {
    const out = {};
    for (const c of COLUMNS) {
      if (!c.best || c.best === 'none') continue;
      const vals = items.map((r) => r[c.key]).filter((v) => v != null);
      if (vals.length > 1) out[c.key] = c.best === 'high' ? Math.max(...vals) : Math.min(...vals);
    }
    return out;
  }, [items]);

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const download = () => {
    const blob = new Blob([csv(items)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wayguard-lgu-comparison-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <PublicLayout>
      <div className="container page">
        <div className="page-head">
          <div>
            <p className="eyebrow"><LuChartColumn aria-hidden /> Platform administration</p>
            <h1>Compare LGUs</h1>
            <p className="muted">How each LGU with reports is doing. Click a column to sort; the best value in each column is highlighted.</p>
          </div>
          <div className="cluster">
            <Link to="/platform/lgus" className="btn btn--secondary">LGUs and jurisdictions</Link>
            <button type="button" className="btn btn--navy" onClick={download} disabled={!items.length}><LuDownload aria-hidden /> CSV</button>
          </div>
        </div>
        <div className="filters panel">
          <div className="filters__row">
            <label className="inline-field">Reports made from
              <input type="date" className="input input--sm" value={range.from} max={range.to || undefined} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            </label>
            <label className="inline-field">to
              <input type="date" className="input input--sm" value={range.to} min={range.from || undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </label>
            <label className="inline-field">At least
              <select className="select select--sm" value={minReports} onChange={(e) => setMinReports(Number(e.target.value))}>
                {[1, 5, 10, 25].map((n) => <option key={n} value={n}>{n} report{n > 1 ? 's' : ''}</option>)}
              </select>
            </label>
          </div>
        </div>
        {loading && !data ? <Loading /> : error ? <Alert type="error">{error.message}</Alert> : !items.length ? (
          <div className="panel"><EmptyState title="No LGUs with reports in this period" /></div>
        ) : (
          <div className="panel panel--flush">
            <div className="table-wrap">
              <table className="table compare-table">
                <thead>
                  <tr>
                    <th scope="col" className="num">#</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} scope="col" className={c.num ? 'num' : ''} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="th-sort" onClick={() => sortBy(c.key)}>
                          {c.label} <LuArrowDownUp aria-hidden />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((r, i) => (
                    <tr key={r.id}>
                      <td className="num muted">{i + 1}</td>
                      {COLUMNS.map((c) => {
                        const v = r[c.key];
                        if (!c.num) return <td key={c.key}><strong>{v}</strong>{r.province && <span className="table__sub">{r.province}</span>}</td>;
                        const isBest = best[c.key] != null && v === best[c.key];
                        return (
                          <td key={c.key} className={`num numeral${isBest ? ' compare-best' : ''}`}>
                            {v == null ? <span className="muted">—</span> : <>{v}{c.unit || ''}</>}
                            {c.bar && v != null && <span className="compare-bar" aria-hidden><i style={{ width: `${v}%` }} /></span>}
                            {isBest && <span className="visually-hidden"> (best)</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 12 }}>
          Resolution rate = repaired ÷ (all reports − rejected and duplicates). Typical repair time is the median from report to verified repair.
          First response is the average time until the LGU first changes the report&apos;s status.
        </p>
      </div>
    </PublicLayout>
  );
}
