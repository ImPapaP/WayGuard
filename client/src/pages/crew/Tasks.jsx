// Assigned repair tasks for the signed-in crew member's team.
import { LuClipboardList, LuCalendarClock, LuMapPin, LuHourglass } from 'react-icons/lu';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { Link } from '../../lib/router.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { EmptyState, ErrorState, Loading, SeverityBadge, StatusBadge, DemoTag } from '../../components/ui.jsx';
import { formatDate, isAwaitingVerification, timeAgo } from '../../lib/format.js';

function dueText(due) {
  if (!due) return null;
  const days = Math.round((new Date(`${String(due).slice(0, 10)}T23:59:59`) - Date.now()) / 86_400_000);
  if (days < 0) return { text: `Overdue by ${-days} day${days === -1 ? '' : 's'}`, late: true };
  if (days === 0) return { text: 'Due today', late: true };
  return { text: `Due in ${days} day${days === 1 ? '' : 's'}`, late: false };
}

export default function Tasks({ scope = 'active' }) {
  useDocumentTitle(scope === 'history' ? 'Task history' : 'My tasks');
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi(`/api/maintenance/tasks?scope=${scope}`);

  return (
    <div className="container page page--narrow">
      <div className="page-head">
        <div>
          <h1>{scope === 'history' ? 'Task history' : 'Repair tasks'}</h1>
          <p>{user.team_name ? `${user.team_name}` : 'No team assigned. Ask an administrator to add you to a team.'}</p>
        </div>
      </div>
      {scope === 'active' && data && (
        <div className="crew-counts" aria-label="Task summary">
          <span>
            <span className="numeral">{data.counts.assigned}</span> to start
          </span>
          <span>
            <span className="numeral">{data.counts.in_progress}</span> in progress
          </span>
          <span>
            <span className="numeral">{data.counts.awaiting_verification}</span> waiting for LGU check
          </span>
        </div>
      )}
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data.items.length ? (
        <div className="panel">
          <EmptyState icon={LuClipboardList} title={scope === 'history' ? 'No finished tasks yet' : 'No tasks right now'}>
            {scope === 'history'
              ? 'Completed and reassigned tasks will be listed here.'
              : 'When the LGU assigns a pothole to your team it will appear here, and you will get a notification.'}
          </EmptyState>
        </div>
      ) : (
        <ul className="task-list">
          {data.items.map((t) => {
            const due = scope === 'active' ? dueText(t.due_date) : null;
            const awaiting = isAwaitingVerification(t);
            return (
              <li key={t.id}>
                <Link to={`/crew/tasks/${t.id}`} className={`task ${t.severity === 'high' ? 'task--high' : ''}`}>
                  <span className="task__photo">{t.photo && <img src={t.photo.thumb_url} alt="" loading="lazy" />}</span>
                  <span className="task__body">
                    <span className="task__top">
                      <strong className="numeral">{t.code}</strong>
                      {t.is_demo && <DemoTag />}
                      <SeverityBadge severity={t.severity} />
                    </span>
                    <span className="task__road">
                      <LuMapPin aria-hidden /> {t.road_name}
                      {t.barangay ? `, ${t.barangay}` : ''}
                    </span>
                    {t.landmark && <span className="task__landmark">Landmark: {t.landmark}</span>}
                    <span className="cluster">
                      <StatusBadge status={t.status} awaiting={awaiting} />
                      {scope === 'history' ? (
                        <span className="small muted">
                          {t.end_reason === 'completed' ? 'Completed' : t.end_reason === 'reassigned' ? 'Reassigned' : 'Unassigned'}{' '}
                          {formatDate(t.ended_at)}
                        </span>
                      ) : awaiting ? (
                        <span className="small muted">
                          <LuHourglass aria-hidden /> Sent {timeAgo(t.work_completed_at)}
                        </span>
                      ) : (
                        due && (
                          <span className={`due ${due.late ? 'due--late' : ''}`}>
                            <LuCalendarClock aria-hidden /> {due.text}
                          </span>
                        )
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
