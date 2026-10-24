// Marker artwork shared by every map engine (MapLibre, Google, Leaflet).
// Reports appear as rounded "report bubbles" with a pothole icon, as in
// driving apps: severity sets the colour AND a letter tag (H/M/L), repaired
// reports are white with a check mark, and work awaiting LGU checking shows
// an hourglass, so meaning never relies on colour alone.
export const GLYPH = { low: 'L', medium: 'M', high: 'H' };

// Wayguard's own pothole symbol: a stretch of road in perspective (edges and
// centre line) with a hole broken into it.
export const POTHOLE_ICON =
  '<svg class="wg-bubble__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 2.5 3 21.5M15.8 2.5 21 21.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 3v2.6M12 8.2v1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6.4 16.3c.4-2.2 2.6-3.6 5.4-3.6 3 0 5.4 1.3 5.8 3.4.3 1.9-2.2 3.4-5.6 3.4-3.6 0-5.9-1.3-5.6-3.2z" fill="currentColor"/><path d="M8.7 16.4c.5-1.1 1.7-1.7 3.2-1.7 1.6 0 2.8.6 3.2 1.6-.6.8-1.8 1.2-3.2 1.2-1.5 0-2.7-.4-3.2-1.1z" fill="var(--bubble-hole)"/></svg>';
const CHECK_ICON =
  '<svg class="wg-bubble__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const WAIT_ICON =
  '<svg class="wg-bubble__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const BUBBLE =
  '<svg class="wg-bubble__shape" viewBox="0 0 44 52" aria-hidden="true"><path d="M16 2h12c7.7 0 14 6.3 14 14v8c0 7.7-6.3 14-14 14h-1.8L22 49.5 17.8 38H16C8.3 38 2 31.7 2 24v-8C2 8.3 8.3 2 16 2z"/></svg>';

export function pinMarkup({ severity, status, selected = false, awaiting = false }) {
  const resolved = status === 'resolved';
  const closed = status === 'rejected' || status === 'duplicate';
  const className = [
    'wg-bubble',
    `wg-bubble--${severity}`,
    resolved && 'wg-bubble--resolved',
    awaiting && 'wg-bubble--awaiting',
    closed && 'wg-bubble--closed',
    selected && 'wg-bubble--selected',
  ]
    .filter(Boolean)
    .join(' ');
  const icon = resolved ? CHECK_ICON : awaiting ? WAIT_ICON : POTHOLE_ICON;
  const tag = resolved ? '' : `<span class="wg-bubble__tag">${GLYPH[severity] || '?'}</span>`;
  return { className, html: `${BUBBLE}${icon}${tag}` };
}

// Marker size and the point (tail tip) that sits on the location.
export const BUBBLE_SIZE = [44, 52];
export const BUBBLE_ANCHOR = [22, 50];

export const PICK_HTML =
  '<svg viewBox="0 0 36 48" aria-hidden="true"><path d="M18 1C8.6 1 1 8.4 1 17.6 1 30 18 47 18 47s17-17 17-29.4C35 8.4 27.4 1 18 1z"/><circle cx="18" cy="17.5" r="6.5"/></svg>';

// "You are here" puck, shown only after the person taps "Locate me". In
// drive mode it becomes an amber arrow pointing where you are heading.
export const ME_HTML =
  '<span class="wg-me__pulse"></span><span class="wg-me__dot"></span><svg class="wg-me__arrow" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 33.5 34.5 20 27.2 6.5 34.5z"/></svg>';
