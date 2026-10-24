// Lightweight, accessible charts for the dashboard. Colours come from the
// brand scales and were checked with a colour-vision validator:
// series A #2B4F8A (navy 500), series B #B87800 (amber 800).
// Every chart also renders a screen-reader table and direct value labels.
import { useState } from 'react';
import { Link } from '../lib/router.jsx';

export const SERIES_A = '#2B4F8A';
export const SERIES_B = '#B87800';

// Horizontal bars for one measure across categories (magnitude).
// items: [{ label (text or element), text (plain text when label is an element), value, href }]
export function BarList({ items, label, emptyText = 'No data yet.' }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="muted small">{emptyText}</p>;
  return (
    <figure className="barlist" aria-label={label}>
      <ul aria-hidden>
        {items.map((i) => {
          const body = (
            <>
              <span className="barlist__label">
                {i.icon}
                {i.label}
              </span>
              <span className="barlist__track">
                <span className="barlist__bar" style={{ width: `${(i.value / max) * 100}%` }} />
              </span>
              <span className="barlist__value numeral">{i.value}</span>
            </>
          );
          return (
            <li key={i.key ?? i.text ?? i.label} title={`${i.text ?? i.label}: ${i.value}`}>
              {i.href ? (
                <Link to={i.href} className="barlist__row" tabIndex={-1}>
                  {body}
                </Link>
              ) : (
                <div className="barlist__row">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <table className="visually-hidden">
        <caption>{label}</caption>
        <tbody>
          {items.map((i) => (
            <tr key={i.key ?? i.text ?? i.label}>
              <th scope="row">{i.href ? <Link to={i.href}>{i.text ?? i.label}</Link> : i.text ?? i.label}</th>
              <td>{i.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// Grouped columns comparing two measures over time (e.g. reported vs resolved).
export function PairedColumns({ data, aLabel, bLabel, label }) {
  const [hover, setHover] = useState(null);
  const W = 560;
  const H = 210;
  const pad = { top: 22, right: 8, bottom: 28, left: 8 };
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const groupW = (W - pad.left - pad.right) / data.length;
  const barW = Math.min(26, (groupW - 18) / 2);
  const plotH = H - pad.top - pad.bottom;
  const y = (v) => pad.top + plotH - (v / max) * plotH;
  const bar = (x, v, color) => {
    const h = Math.max(v > 0 ? 3 : 0, (v / max) * plotH);
    const top = pad.top + plotH - h;
    const r = Math.min(4, h / 2, barW / 2);
    // Rounded only at the data end; square at the baseline.
    return (
      <path
        d={`M${x},${pad.top + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${pad.top + plotH} Z`}
        fill={color}
      />
    );
  };
  return (
    <figure className="paired" aria-label={label}>
      <div className="chart-legend" aria-hidden>
        <span>
          <i style={{ background: SERIES_A }} /> {aLabel}
        </span>
        <span>
          <i style={{ background: SERIES_B }} /> {bLabel}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="paired__svg" aria-hidden>
        {[0.5, 1].map((f) => (
          <line key={f} x1={pad.left} x2={W - pad.right} y1={y(max * f)} y2={y(max * f)} className="chart-grid" />
        ))}
        <line x1={pad.left} x2={W - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} className="chart-axis" />
        {data.map((d, i) => {
          const gx = pad.left + i * groupW + (groupW - (barW * 2 + 2)) / 2;
          const active = hover === i;
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.left + i * groupW} y={pad.top - 10} width={groupW} height={plotH + 10} fill={active ? 'rgba(10,34,68,0.04)' : 'transparent'} />
              {bar(gx, d.a, SERIES_A)}
              {bar(gx + barW + 2, d.b, SERIES_B)}
              {(active || d.a > 0) && (
                <text x={gx + barW / 2} y={y(d.a) - 5} className="chart-value" textAnchor="middle">
                  {d.a}
                </text>
              )}
              {(active || d.b > 0) && (
                <text x={gx + barW * 1.5 + 2} y={y(d.b) - 5} className="chart-value" textAnchor="middle">
                  {d.b}
                </text>
              )}
              <text x={pad.left + i * groupW + groupW / 2} y={H - 8} className="chart-tick" textAnchor="middle">
                {d.label}
              </text>
              <title>{`${d.label}: ${d.a} ${aLabel.toLowerCase()}, ${d.b} ${bLabel.toLowerCase()}`}</title>
            </g>
          );
        })}
      </svg>
      <table className="visually-hidden">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">{aLabel}</th>
            <th scope="col">{bLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{d.a}</td>
              <td>{d.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
