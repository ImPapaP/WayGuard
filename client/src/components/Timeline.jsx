// Report history (FR-15). Citizens receive only public events from the API;
// staff also see internal notes, marked "Staff only".
import {
  LuFlag,
  LuStickyNote,
  LuStar,
  LuWrench,
  LuCircleCheck,
  LuTriangleAlert,
  LuBuilding2,
  LuGauge,
  LuUndo2,
  LuPencil,
  LuLink,
  LuUsers,
  LuPlus,
} from 'react-icons/lu';
import { STATUS, formatDateTime } from '../lib/format.js';
import { statusIcon } from './ui.jsx';

const EVENT = {
  created: { icon: LuPlus, title: () => 'Report submitted' },
  status_changed: { icon: null, title: (e) => STATUS[e.to_status]?.label || e.to_status },
  duplicate_flagged: { icon: LuTriangleAlert, title: () => 'Possible duplicates found' },
  duplicate_linked: { icon: LuLink, title: () => 'Duplicate linked' },
  severity_changed: { icon: LuGauge, title: () => 'Severity adjusted' },
  agency_set: { icon: LuBuilding2, title: () => 'Responsible agency set' },
  reassigned: { icon: LuUsers, title: () => 'Reassigned' },
  repair_progress: { icon: LuWrench, title: () => 'Repair update' },
  repair_completed: { icon: LuCircleCheck, title: () => 'Repair reported complete' },
  completion_returned: { icon: LuUndo2, title: () => 'Returned for more work' },
  internal_note: { icon: LuStickyNote, title: () => 'Internal note' },
  public_note: { icon: LuFlag, title: () => 'Update from the LGU' },
  details_updated: { icon: LuPencil, title: () => 'Details updated' },
  feedback: { icon: LuStar, title: () => 'Feedback received' },
};

export default function Timeline({ events, showActors = false }) {
  if (!events?.length) return <p className="muted">No history yet.</p>;
  return (
    <ol className="timeline">
      {[...events].reverse().map((e) => {
        const def = EVENT[e.event_type] || { icon: LuFlag, title: () => e.event_type.replace(/_/g, ' ') };
        const Icon = def.icon || statusIcon(e.to_status);
        const isStatus = e.event_type === 'status_changed';
        return (
          <li
            key={e.id}
            className={`timeline__item ${isStatus ? 'timeline__item--status' : ''} ${e.is_public ? '' : 'timeline__item--private'}`}
          >
            <span className="timeline__icon" aria-hidden>
              <Icon />
            </span>
            <div>
              <div className="timeline__title">
                {def.title(e)}
                {!e.is_public && <span className="private-tag">Staff only</span>}
              </div>
              <div className="timeline__meta">
                <time dateTime={e.created_at}>{formatDateTime(e.created_at)}</time>
                {showActors && e.actor_name ? ` by ${e.actor_name}` : ''}
              </div>
              {e.message && e.message !== 'Report submitted.' && <p className="timeline__msg">{e.message}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
