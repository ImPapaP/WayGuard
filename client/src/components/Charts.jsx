// Lightweight, accessible charts for the dashboard. Colours come from the
// brand scales and were checked with a colour-vision validator:
// series A #2B4F8A (navy 500), series B #B87800 (amber 800).
// Every chart also renders a screen-reader table and direct value labels.
import { useEffect, useRef, useState } from 'react';
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
      <div className="visually-hidden"><table>
        <caption>{label}</caption>
        <tbody>
          {items.map((i) => (
            <tr key={i.key ?? i.text ?? i.label}>
              <th scope="row">{i.href ? <Link to={i.href}>{i.text ?? i.label}</Link> : i.text ?? i.label}</th>
              <td>{i.value}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
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
      <div className="visually-hidden"><table>
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
      </table></div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Headline figure (no plot): value, label and an optional comparison line.
export function StatTile({ label, value, unit, sub, tone, icon: Icon, href }) {
  const body = (
    <>
      <span className="stat-tile__label">
        {Icon && <Icon aria-hidden />}
        {label}
      </span>
      <span className="stat-tile__value numeral">
        {value ?? '—'}
        {value != null && unit && <small>{unit}</small>}
      </span>
      {sub && <span className={`stat-tile__sub${tone ? ` stat-tile__sub--${tone}` : ''}`}>{sub}</span>}
    </>
  );
  return href ? (
    <Link to={href} className="stat-tile stat-tile--link">{body}</Link>
  ) : (
    <div className="stat-tile">{body}</div>
  );
}

// Two series over days with a snapping crosshair and one tooltip for both.
// data: [{ key, label (short tick), long (tooltip date), a, b }]
export function LineTrend({ data, aLabel, bLabel, label }) {
  const [hover, setHover] = useState(null);
  // Draw at the real width so text stays readable on phones and wide screens.
  const box = useRef(null);
  const [W, setW] = useState(900);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(300, Math.min(1000, Math.round(entry.contentRect.width)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 520 ? 200 : 240;
  const every = W < 520 ? 10 : 7;
  const pad = { top: 16, right: 14, bottom: 26, left: 30 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const max = Math.max(4, ...data.flatMap((d) => [d.a, d.b]));
  const niceMax = Math.ceil(max / 4) * 4;
  const x = (i) => pad.left + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2);
  const y = (v) => pad.top + plotH - (v / niceMax) * plotH;
  const path = (k) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - pad.left) / plotW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const h = hover == null ? null : data[hover];
  const last = data.length - 1;
  return (
    <figure className="trend" aria-label={label}>
      <div className="chart-legend" aria-hidden>
        <span><i className="chart-legend__line" style={{ background: SERIES_A }} /> {aLabel}</span>
        <span><i className="chart-legend__line" style={{ background: SERIES_B }} /> {bLabel}</span>
      </div>
      <div className="trend__plot" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} className="paired__svg" aria-hidden onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={pad.left} x2={W - pad.right} y1={y(niceMax * f)} y2={y(niceMax * f)} className={f ? 'chart-grid' : 'chart-axis'} />
              <text x={pad.left - 6} y={y(niceMax * f) + 4} className="chart-tick" textAnchor="end">{Math.round(niceMax * f)}</text>
            </g>
          ))}
          {data.map((d, i) => (i % every === last % every ? (
            <text key={d.key} x={x(i)} y={H - 6} className="chart-tick" textAnchor={i === last ? 'end' : 'middle'}>{d.label}</text>
          ) : null))}
          <path d={path('b')} fill="none" stroke={SERIES_B} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <path d={path('a')} fill="none" stroke={SERIES_A} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {h && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} className="trend__crosshair" />
              <circle cx={x(hover)} cy={y(h.b)} r="4.5" fill={SERIES_B} stroke="#fff" strokeWidth="2" />
              <circle cx={x(hover)} cy={y(h.a)} r="4.5" fill={SERIES_A} stroke="#fff" strokeWidth="2" />
            </g>
          )}
          {!h && data.length > 0 && (
            <g>
              <circle cx={x(last)} cy={y(data[last].a)} r="4" fill={SERIES_A} stroke="#fff" strokeWidth="2" />
              <circle cx={x(last)} cy={y(data[last].b)} r="4" fill={SERIES_B} stroke="#fff" strokeWidth="2" />
            </g>
          )}
          <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="transparent" />
        </svg>
        {h && (
          <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }} role="presentation">
            <span className="chart-tip__title">{h.long}</span>
            <span><i style={{ background: SERIES_A }} /><strong className="numeral">{h.a}</strong> {aLabel.toLowerCase()}</span>
            <span><i style={{ background: SERIES_B }} /><strong className="numeral">{h.b}</strong> {bLabel.toLowerCase()}</span>
          </div>
        )}
      </div>
      <div className="visually-hidden"><table>
        <caption>{label}</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">{aLabel}</th><th scope="col">{bLabel}</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.key}><th scope="row">{d.long}</th><td>{d.a}</td><td>{d.b}</td></tr>)}</tbody>
      </table></div>
    </figure>
  );
}

// One measure as vertical columns (e.g. a distribution).
// data: [{ key, label, value, hint }]
export function Columns({ data, label, color = SERIES_A, unit = '' }) {
  const [hover, setHover] = useState(null);
  const W = 380;
  const H = 200;
  const pad = { top: 22, right: 6, bottom: 34, left: 6 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = (W - pad.left - pad.right) / data.length;
  const barW = Math.min(64, slot - 14);
  const plotH = H - pad.top - pad.bottom;
  return (
    <figure className="paired" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} className="paired__svg" aria-hidden>
        <line x1={pad.left} x2={W - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} className="chart-axis" />
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * plotH);
          const bx = pad.left + i * slot + (slot - barW) / 2;
          const top = pad.top + plotH - h;
          const r = Math.min(4, h / 2);
          const active = hover === i;
          return (
            <g key={d.key} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={pad.left + i * slot} y={pad.top - 14} width={slot} height={plotH + 14} fill={active ? 'rgba(10,34,68,0.05)' : 'transparent'} />
              {h > 0 && (
                <path
                  d={`M${bx},${pad.top + plotH} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${pad.top + plotH} Z`}
                  fill={color}
                  opacity={hover == null || active ? 1 : 0.55}
                />
              )}
              <text x={bx + barW / 2} y={top - 6} className="chart-value" textAnchor="middle">{d.value}</text>
              <text x={bx + barW / 2} y={H - 14} className="chart-tick" textAnchor="middle">{d.label}</text>
              <title>{`${d.hint || d.label}: ${d.value}${unit}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="visually-hidden"><table>
        <caption>{label}</caption>
        <tbody>{data.map((d) => <tr key={d.key}><th scope="row">{d.hint || d.label}</th><td>{d.value}</td></tr>)}</tbody>
      </table></div>
    </figure>
  );
}

// Day-of-week × time-of-day grid on one sequential (navy) ramp.
// cells: [{ dow 1-7 (Mon=1), slot 0-7 (3-hour blocks), n }]
const HEAT_STEPS = ['#e3eaf5', '#b8c8e2', '#86a1cd', '#4f6fa6', '#2b4f8a', '#12305f'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS = ['12–3am', '3–6am', '6–9am', '9am–12', '12–3pm', '3–6pm', '6–9pm', '9pm–12'];
const SLOT_TICKS = ['12a', '3a', '6a', '9a', '12p', '3p', '6p', '9p'];
export function Heatmap({ cells, label }) {
  const [hover, setHover] = useState(null);
  const grid = DAYS.map((_, d) => SLOTS.map((__, s) => cells.find((c) => c.dow === d + 1 && c.slot === s)?.n || 0));
  const max = Math.max(1, ...grid.flat());
  const step = (n) => (n === 0 ? null : HEAT_STEPS[Math.max(0, Math.ceil((n / max) * HEAT_STEPS.length) - 1)]);
  const busiest = grid.flatMap((row, d) => row.map((n, s) => ({ n, d, s }))).sort((a, b) => b.n - a.n)[0];
  return (
    <figure className="heat" aria-label={label}>
      <div className="heat__grid" role="presentation" onPointerLeave={() => setHover(null)}>
        <span />
        {SLOT_TICKS.map((t) => <span key={t} className="heat__col">{t}</span>)}
        {grid.map((row, d) => (
          <div key={DAYS[d]} className="heat__row">
            <span className="heat__day">{DAYS[d]}</span>
            {row.map((n, s) => {
              const fill = step(n);
              const dark = fill && HEAT_STEPS.indexOf(fill) >= 3;
              const active = hover && hover.d === d && hover.s === s;
              return (
                <span
                  key={s}
                  className={`heat__cell${active ? ' is-active' : ''}`}
                  style={{ background: fill || undefined, color: dark ? '#fff' : undefined }}
                  title={`${DAYS[d]} ${SLOTS[s]}: ${n} report${n === 1 ? '' : 's'}`}
                  onPointerEnter={() => setHover({ d, s, n })}
                >
                  {n > 0 ? n : ''}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="heat__foot">
        <span className="small muted">
          {hover ? <><strong className="numeral">{hover.n}</strong> on {DAYS[hover.d]}, {SLOTS[hover.s]}</> : busiest?.n ? <>Busiest: {DAYS[busiest.d]}, {SLOTS[busiest.s]}</> : 'No reports yet'}
        </span>
        <span className="heat__scale" aria-hidden>
          Fewer {HEAT_STEPS.map((c) => <i key={c} style={{ background: c }} />)} More
        </span>
      </div>
      <div className="visually-hidden"><table>
        <caption>{label}</caption>
        <thead><tr><th scope="col">Day</th>{SLOTS.map((s) => <th key={s} scope="col">{s}</th>)}</tr></thead>
        <tbody>{grid.map((row, d) => <tr key={DAYS[d]}><th scope="row">{DAYS[d]}</th>{row.map((n, s) => <td key={s}>{n}</td>)}</tr>)}</tbody>
      </table></div>
    </figure>
  );
}

// Share of a whole as one horizontal bar of two parts, e.g. open vs fixed.
export function SplitBar({ a, b, aLabel, bLabel }) {
  const total = a + b;
  if (!total) return null;
  return (
    <span className="split" role="img" aria-label={`${a} ${aLabel}, ${b} ${bLabel}`}>
      {a > 0 && <i style={{ flexGrow: a, background: SERIES_A }} />}
      {b > 0 && <i style={{ flexGrow: b, background: SERIES_B }} />}
    </span>
  );
}
