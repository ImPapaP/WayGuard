// Labels and formatting shared across the interface.
export const STATUS = {
  submitted: { label: 'Submitted', help: 'Received and waiting for an LGU administrator.' },
  under_review: { label: 'Under review', help: 'An administrator is checking the location, photos and severity.' },
  verified: { label: 'Verified', help: 'Confirmed by the LGU and waiting for a maintenance team.' },
  assigned: { label: 'Assigned', help: 'A maintenance team has been assigned to repair it.' },
  in_progress: { label: 'In progress', help: 'Inspection or repair work has started.' },
  resolved: { label: 'Resolved', help: 'The repair was completed and verified by the LGU.' },
  rejected: { label: 'Rejected', help: 'The report could not be accepted. See the reason below.' },
  duplicate: { label: 'Duplicate', help: 'Another report already covers this pothole.' },
};
export const STATUS_ORDER = ['submitted', 'under_review', 'verified', 'assigned', 'in_progress', 'resolved'];
export const ALL_STATUSES = [...STATUS_ORDER, 'rejected', 'duplicate'];

export const SEVERITY = {
  low: { label: 'Low', help: 'Small or shallow. Not yet a danger to most vehicles.' },
  medium: { label: 'Medium', help: 'Tyre-sized or collects water. Drivers slow down or swerve.' },
  high: { label: 'High', help: 'Deep or wide. Can damage vehicles or cause accidents.' },
};

export const HAZARDS = {
  deep: 'Deep',
  wide: 'Wide (most of the lane)',
  water_filled: 'Fills with water',
  causes_swerving: 'Vehicles swerve around it',
  near_school_or_crossing: 'Near a school or crossing',
  poor_lighting: 'Hard to see at night',
  motorcycle_risk: 'Danger to motorcycles',
  damaged_vehicles: 'Has damaged vehicles',
};

export const ROAD_TYPES = {
  unknown: 'Not sure',
  barangay: 'Barangay road',
  city_municipal: 'City / municipal road',
  provincial: 'Provincial road',
  national: 'National highway',
  private: 'Private / subdivision road',
};

export const JURISDICTIONS = {
  national: 'National',
  provincial: 'Provincial',
  city_municipal: 'City / municipal',
  barangay: 'Barangay',
  other: 'Other',
};

export const ROLES = { citizen: 'Citizen', admin: 'LGU administrator', staff: 'LGU staff', maintenance: 'Maintenance personnel' };

const dateFmt = new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-PH', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const rel = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatDate(value) {
  return value ? dateFmt.format(new Date(value)) : '';
}
export function formatDateTime(value) {
  return value ? dateTimeFmt.format(new Date(value)) : '';
}
export function timeAgo(value) {
  if (!value) return '';
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rel.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rel.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rel.format(Math.round(diff / 86400), 'day');
  return formatDate(value);
}
export function formatDistance(m) {
  if (m === null || m === undefined) return '';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
export function formatCoords(lat, lng) {
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}
export function initials(name = '') {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('') || '?'
  );
}
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
export function locationLine(r) {
  return [r.road_name, r.barangay].filter(Boolean).join(', ');
}
export function isAwaitingVerification(r) {
  return r.status === 'in_progress' && Boolean(r.work_completed_at);
}
