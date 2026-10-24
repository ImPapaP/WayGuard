import { LuImage } from 'react-icons/lu';
import { Link } from '../lib/router.jsx';
import { StatusBadge, SeverityBadge, DemoTag } from './ui.jsx';
import RoadProgress from './RoadProgress.jsx';
import { formatDate, isAwaitingVerification, locationLine } from '../lib/format.js';

// Summary of one report, used in the citizen's lists.
export default function ReportCard({ report, to }) {
  const r = report;
  return (
    <Link to={to} className="report-card">
      <span className="report-card__photo">
        {r.photo ? <img src={r.photo.thumb_url} alt="" loading="lazy" /> : <LuImage aria-hidden />}
      </span>
      <span className="report-card__body">
        <span className="report-card__top">
          <strong className="numeral">{r.code}</strong>
          {r.is_demo && <DemoTag />}
          <span className="report-card__date">{formatDate(r.created_at)}</span>
        </span>
        <span className="report-card__road">{locationLine(r)}</span>
        <span className="cluster">
          <StatusBadge status={r.status} awaiting={isAwaitingVerification(r)} />
          <SeverityBadge severity={r.severity} />
        </span>
        <span className="report-card__road-progress">
          <RoadProgress status={r.status} awaiting={isAwaitingVerification(r)} compact />
        </span>
      </span>
    </Link>
  );
}
