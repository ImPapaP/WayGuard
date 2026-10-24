// Decorative, animated background for dark hero sections: soft Road Amber
// and Navy glows, winding roads with moving lane markings, and a few report
// bubbles drifting above them. Purely visual (hidden from assistive tech).
import { pinMarkup } from './mapPins.js';

// Placed along the edges so they never sit behind text.
const BUBBLES = [
  { severity: 'high', x: '96%', y: '8%', d: '0s' },
  { severity: 'medium', x: '46%', y: '88%', d: '1.2s' },
  { severity: 'low', x: '2%', y: '90%', d: '2.1s' },
  { severity: 'medium', status: 'resolved', x: '97%', y: '78%', d: '0.6s' },
];

// `glows` is turned off behind the reversed logo, which must sit on plain
// Night Ink (Brand Sheet).
export default function HeroBackdrop({ bubbles = true, glows = true }) {
  return (
    <div className="backdrop" aria-hidden>
      {glows && <span className="backdrop__glow backdrop__glow--amber" />}
      {glows && <span className="backdrop__glow backdrop__glow--navy" />}
      <svg className="backdrop__roads" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice">
        <path className="backdrop__road" d="M-60 520 C 220 430, 360 520, 560 400 S 900 160, 1260 220" />
        <path className="backdrop__lane" d="M-60 520 C 220 430, 360 520, 560 400 S 900 160, 1260 220" />
        <path className="backdrop__road backdrop__road--thin" d="M120 -40 C 220 160, 120 300, 300 420 S 520 640, 640 660" />
        <path className="backdrop__lane backdrop__lane--slow" d="M120 -40 C 220 160, 120 300, 300 420 S 520 640, 640 660" />
        <path className="backdrop__road backdrop__road--thin" d="M760 -40 C 820 120, 1020 160, 1080 320 S 1180 520, 1260 560" />
        <path className="backdrop__lane backdrop__lane--slow" d="M760 -40 C 820 120, 1020 160, 1080 320 S 1180 520, 1260 560" />
      </svg>
      {bubbles &&
        BUBBLES.map((b) => {
          const { className, html } = pinMarkup({ severity: b.severity, status: b.status || 'verified' });
          return (
            <span
              key={`${b.x}${b.y}`}
              className={`${className} backdrop__bubble`}
              style={{ left: b.x, top: b.y, animationDelay: b.d }}
              // Static, trusted SVG markup from mapPins.js.
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        })}
    </div>
  );
}
