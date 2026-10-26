// Shows reports waiting on this phone and sends them when back online.
import { useCallback, useEffect, useState } from 'react';
import { LuCloudUpload, LuTrash2, LuRefreshCw } from 'react-icons/lu';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { useOnline } from '../lib/hooks.js';
import { flushOutbox, listOutbox, onOutboxChange, removeFromOutbox } from '../lib/outbox.js';

export default function OutboxBanner() {
  const { user } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const [items, setItems] = useState([]);
  const [sending, setSending] = useState(false);
  const userId = user?.role === 'citizen' ? user.id : null;

  const load = useCallback(() => {
    if (userId) listOutbox(userId).then(setItems);
  }, [userId]);

  const send = useCallback(async () => {
    if (!userId || navigator.onLine === false) return;
    setSending(true);
    try {
      await flushOutbox(userId, {
        onSent: (res) => toast(`Your saved report was sent: ${res.report.code}.`),
      });
    } finally {
      setSending(false);
      load();
    }
  }, [userId, toast, load]);

  useEffect(() => {
    load();
    return onOutboxChange(load);
  }, [load]);

  // Send when the connection returns, on opening the app and every minute.
  useEffect(() => {
    if (!userId || !online || user?.offline) return undefined;
    send();
    const t = setInterval(send, 60_000);
    return () => clearInterval(t);
  }, [userId, online, user?.offline, send]);

  if (!userId || !items.length) return null;
  const waiting = items.filter((i) => !i.error);
  const failed = items.filter((i) => i.error);
  return (
    <div className="outbox" role="status">
      {waiting.length > 0 && (
        <div className="outbox__row">
          <LuCloudUpload aria-hidden />
          <span>
            <strong>{waiting.length} report{waiting.length === 1 ? '' : 's'} saved on this phone.</strong>{' '}
            {online ? 'Sending…' : 'They will be sent when you are back online.'}
          </span>
          {online && (
            <button type="button" className="btn btn--sm btn--secondary" onClick={send} disabled={sending}>
              <LuRefreshCw aria-hidden /> Send now
            </button>
          )}
        </div>
      )}
      {failed.map((i) => (
        <div className="outbox__row outbox__row--failed" key={i.id}>
          <span>
            <strong>A saved report could not be sent</strong> ({i.fields.road_name || 'no road name'}): {i.error}
          </span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeFromOutbox(i.id)}>
            <LuTrash2 aria-hidden /> Discard
          </button>
        </div>
      ))}
    </div>
  );
}
