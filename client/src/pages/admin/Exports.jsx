// Export tools (FR-18) and the printable summary report (role: generate
// summary reports and statistics).
import { useState } from 'react';
import { LuFileSpreadsheet, LuFileText, LuChartColumn } from 'react-icons/lu';
import { qs, withFocus } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { ALL_STATUSES, STATUS } from '../../lib/format.js';

export default function Exports() {
  useDocumentTitle('Exports and summaries');
  const { data: brgys } = useApi('/api/admin/barangays');
  const [f, setF] = useState({ status: [], severity: '', barangay: '', from: '', to: '' });
  const [range, setRange] = useState({ from: '', to: '' });
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const params = qs({ ...f, status: f.status });
  const toggle = (s) => setF({ ...f, status: f.status.includes(s) ? f.status.filter((x) => x !== s) : [...f.status, s] });

  return (
    <div className="container page page--narrow">
      <div className="page-head">
        <div>
          <h1>Exports and summaries</h1>
          <p>Download report data for planning and meetings. Exports leave out reporters&apos; names and contact details.</p>
        </div>
      </div>
      <div className="stack stack--lg">
        <section className="panel form-stack" aria-labelledby="ex-title">
          <h2 id="ex-title" className="section-title">
            Report list
          </h2>
          <fieldset className="fieldset">
            <legend className="field__label">Status</legend>
            <div className="chips">
              {ALL_STATUSES.map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={f.status.includes(s)} onClick={() => toggle(s)}>
                  {STATUS[s].label}
                </button>
              ))}
            </div>
            <p className="field__hint">Leave all unselected to include every status.</p>
          </fieldset>
          <div className="form-row form-row--2">
            <label className="field">
              <span className="field__label">Severity</span>
              <select className="select" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
                <option value="">Any</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Barangay</span>
              <select className="select" value={f.barangay} onChange={(e) => setF({ ...f, barangay: e.target.value })}>
                <option value="">All</option>
                {brgys?.items.map((b) => (
                  <option key={b.barangay} value={b.barangay}>
                    {b.barangay}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row form-row--2">
            <label className="field">
              <span className="field__label">Reported from</span>
              <input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">Reported to</span>
              <input type="date" className="input" value={f.to} min={f.from || undefined} onChange={(e) => setF({ ...f, to: e.target.value })} />
            </label>
          </div>
          <div className="cluster">
            <a className="btn btn--navy" href={withFocus(`/api/admin/exports/reports.csv${params}`)} download>
              <LuFileSpreadsheet aria-hidden /> Download CSV
            </a>
            <a className="btn btn--secondary" href={withFocus(`/api/admin/exports/reports.pdf${params}`)} download>
              <LuFileText aria-hidden /> Download PDF
            </a>
          </div>
          <p className="field__hint">CSV opens in Excel or Google Sheets. The PDF is a printable table (up to 2,000 reports).</p>
        </section>

        <section className="panel form-stack" aria-labelledby="sum-title">
          <h2 id="sum-title" className="section-title">
            Summary report
          </h2>
          <p className="small muted">
            One page with totals, reports by status and severity, the monthly trend, open reports by barangay, team workload and
            reporter feedback.
          </p>
          <div className="form-row form-row--2">
            <label className="field">
              <span className="field__label">Reported from</span>
              <input type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">Reported to</span>
              <input type="date" className="input" value={range.to} min={range.from || undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </label>
          </div>
          <div>
            <a className="btn btn--primary" href={withFocus(`/api/admin/exports/summary.pdf${qs(range)}`)} download>
              <LuChartColumn aria-hidden /> Download summary PDF
            </a>{' '}
            <a className="btn btn--secondary" href={withFocus(`/api/admin/exports/stats.csv${qs(range)}`)} download>
              <LuFileSpreadsheet aria-hidden /> Dashboard figures (CSV)
            </a>
          </div>
        </section>

        <section className="panel form-stack" aria-labelledby="month-title">
          <h2 id="month-title" className="section-title">
            Monthly accomplishment report
          </h2>
          <p className="small muted">
            A printable report for the mayor or council: reports received, verified and repaired in the month, a short written
            summary, barangays, road crews, every pothole repaired, and lines for &ldquo;Prepared by&rdquo; and &ldquo;Noted by&rdquo;.
          </p>
          <label className="field" style={{ maxWidth: 260 }}>
            <span className="field__label">Month</span>
            <input type="month" className="input" value={month} max={thisMonth} onChange={(e) => setMonth(e.target.value || thisMonth)} />
          </label>
          <div>
            <a className="btn btn--navy" href={withFocus(`/api/admin/exports/monthly.pdf${qs({ month })}`)} download>
              <LuFileText aria-hidden /> Download monthly report (PDF)
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
