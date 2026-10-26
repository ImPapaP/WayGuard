// "I saw this too": lets a resident confirm someone else's open report.
import { useState } from 'react';
import { LuUsers, LuCheck } from 'react-icons/lu';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';

const OPEN = ['submitted', 'under_review', 'verified', 'assigned', 'in_progress'];

export default function ConfirmButton({ report, size = 'sm', onChange }) {
  const { user } = useAuth();
  const toast = useToast();
  const [state, setState] = useState({ n: report.confirmations || 0, mine: Boolean(report.confirmed_by_me) });
  const [busy, setBusy] = useState(false);
  if (!report || !OPEN.includes(report.status)) return null;
  const count = state.n > 0 ? <span className="confirm-btn__count numeral">{state.n}</span> : null;
  if (!user || user.role !== 'citizen' || report.is_mine) {
    return state.n > 0 ? (
      <span className="confirm-flag" title={`${state.n} resident(s) saw it too`}>
        <LuUsers aria-hidden /> {state.n} {state.n === 1 ? 'resident' : 'residents'} saw it too
      </span>
    ) : null;
  }
  async function toggle() {
    setBusy(true);
    try {
      const res = state.mine
        ? await api.delete(`/api/reports/${report.id}/confirm`)
        : await api.post(`/api/reports/${report.id}/confirm`);
      setState({ n: res.confirmations, mine: res.confirmed_by_me });
      onChange?.(res);
      toast(res.confirmed_by_me ? 'Thanks — your LGU will see that more people saw it.' : 'Confirmation removed.');
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className={`btn btn--${state.mine ? 'navy' : 'secondary'} btn--${size} confirm-btn`}
      aria-pressed={state.mine}
      disabled={busy}
      onClick={toggle}
      title={state.mine ? 'Tap to undo' : 'Tell the LGU you saw this pothole too'}
    >
      {state.mine ? <LuCheck aria-hidden /> : <LuUsers aria-hidden />}
      {state.mine ? 'You saw this too' : 'I saw this too'}
      {count}
    </button>
  );
}
