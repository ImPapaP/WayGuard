// The report's journey drawn as a road: each workflow stage is a stop, the
// travelled part is paved navy with the amber lane line.
import { LuCheck, LuCircleX, LuCopy, LuHourglass } from 'react-icons/lu';
import { STATUS, STATUS_ORDER } from '../lib/format.js';
import { statusIcon } from './ui.jsx';

export default function RoadProgress({ status, awaiting = false, compact = false }) {
  const halted = status === 'rejected' || status === 'duplicate';
  // Rejected/duplicate reports stopped after review.
  const index = halted ? 1 : STATUS_ORDER.indexOf(status);
  const stops = STATUS_ORDER;
  const pct = Math.max(0, index) / (stops.length - 1);
  const label = halted
    ? `Progress stopped: ${STATUS[status].label}`
    : `Progress: step ${index + 1} of ${stops.length}, ${STATUS[status].label}${awaiting ? ', repair awaiting LGU check' : ''}`;
  return (
    <div className={`road ${halted ? 'road--halted' : ''}`} role="img" aria-label={label} style={{ '--stops': stops.length }}>
      <div className="road__track">
        <div className="road__fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <ol className="road__stops" aria-hidden>
        {stops.map((s, i) => {
          const done = i < index || (i === index && s === 'resolved');
          const isCurrent = i === index && s !== 'resolved';
          let Icon = done ? LuCheck : statusIcon(s);
          if (isCurrent && halted) Icon = status === 'rejected' ? LuCircleX : LuCopy;
          if (isCurrent && awaiting) Icon = LuHourglass;
          const text = isCurrent && halted ? STATUS[status].label : STATUS[s].label;
          return (
            <li key={s} className={`road__stop ${done ? 'road__stop--done' : ''} ${isCurrent ? 'road__stop--current' : ''}`}>
              <span className="road__dot">
                <Icon />
              </span>
              {!compact && <span className="road__label">{isCurrent && awaiting ? 'Awaiting check' : text}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
