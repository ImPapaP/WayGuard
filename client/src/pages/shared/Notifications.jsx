// Notification centre (FR-11): status changes, new tasks, completions.
import { useState } from 'react';
import { LuBell, LuCheckCheck } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { useNavigate } from '../../lib/router.jsx';
import { Button, EmptyState, ErrorState, Loading, Pagination } from '../../components/ui.jsx';
import { notifyNotificationsChanged } from '../../components/Shells.jsx';
import { formatDateTime, timeAgo } from '../../lib/format.js';

export default function Notifications() {
  useDocumentTitle('Notifications');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, error, loading, reload, setData } = useApi(
    `/api/notifications${qs({ page, unread: unreadOnly ? 'true' : '' })}`,
  );

  const linkFor = (n) => {
    if (!n.report_id) return null;
    return { citizen: `/app/reports/${n.report_id}`, admin: `/admin/reports/${n.report_id}`, maintenance: `/crew/tasks/${n.report_id}` }[
      user.role
    ];
  };

  async function open(n) {
    if (!n.read_at) {
      await api.post(`/api/notifications/${n.id}/read`).catch(() => {});
      notifyNotificationsChanged();
    }
    const href = linkFor(n);
    if (href) navigate(href);
    else reload();
  }

  async function markAll() {
    await api.post('/api/notifications/read-all');
    setData((d) => ({ ...d, unread: 0, items: d.items.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })) }));
    notifyNotificationsChanged();
  }

  return (
    <div className="container page page--narrow">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>{data ? (data.unread ? `${data.unread} unread` : 'You are all caught up.') : ' '}</p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="chip" aria-pressed={unreadOnly} onClick={() => { setUnreadOnly((u) => !u); setPage(1); }}>
            Unread only
          </button>
          {data?.unread > 0 && (
            <Button size="sm" onClick={markAll}>
              <LuCheckCheck aria-hidden /> Mark all as read
            </Button>
          )}
        </div>
      </div>
      <div className="panel panel--flush">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : !data.items.length ? (
          <EmptyState icon={LuBell} title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}>
            {user.role === 'citizen'
              ? 'You will be notified here when the LGU reviews or repairs a pothole you reported.'
              : 'New work and status changes will appear here.'}
          </EmptyState>
        ) : (
          <>
            <ul className="notif-list">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`notif ${n.read_at ? '' : 'notif--unread'}`} onClick={() => open(n)}>
                    <span className="notif__dot" aria-hidden />
                    <span className="notif__body">
                      <span className="notif__title">
                        {!n.read_at && <span className="visually-hidden">Unread: </span>}
                        {n.title}
                      </span>
                      <span className="notif__text">{n.body}</span>
                    </span>
                    <time className="notif__time" dateTime={n.created_at} title={formatDateTime(n.created_at)}>
                      {timeAgo(n.created_at)}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
