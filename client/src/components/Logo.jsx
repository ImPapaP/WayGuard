// Official Wayguard logo artwork, used as supplied (never recoloured, stretched
// or redrawn). Variant files come from the supplied PNGs and the Brand Sheet.
// The component enforces the Brand Sheet minimum sizes: the full lockup is
// never narrower than 160 px and the W mark never shorter than 32 px.
const VARIANTS = {
  // Logotype with W mark + slogan, full colour on white (#FFFFFF surfaces)
  'horizontal-color': { src: '/brand/wayguard-logotype-wmark-color.png', w: 1143, h: 273, lockup: true },
  // Same, reversed — only on Night Ink (#061429)
  'horizontal-reversed': { src: '/brand/wayguard-logotype-wmark-reversed.png', w: 1143, h: 273, lockup: true },
  // Stacked full lockup (supplied transparent PNG) for light surfaces
  'full-color': { src: '/brand/wayguard-logo-full-color.png', w: 1000, h: 683, lockup: true },
  // Stacked full lockup reversed — only on Night Ink (#061429)
  'full-reversed': { src: '/brand/wayguard-logo-full-reversed.png', w: 595, h: 414, lockup: true },
  'mark-color': { src: '/brand/wayguard-mark-color.png', w: 600, h: 307, lockup: false },
  'mark-reversed': { src: '/brand/wayguard-mark-reversed.png', w: 573, h: 303, lockup: false },
};

export default function Logo({ variant = 'horizontal-color', height = 40, className = '', alt }) {
  const v = VARIANTS[variant];
  let h = height;
  if (v.lockup && (h * v.w) / v.h < 160) h = Math.ceil((160 * v.h) / v.w);
  if (!v.lockup && h < 32) h = 32;
  const w = Math.round((h * v.w) / v.h);
  const label = alt ?? (v.lockup ? 'Wayguard — Spot the dip, save the trip.' : 'Wayguard');
  return (
    <span className={`logo ${className}`} style={{ height: h }}>
      <img src={(__WG_PREVIEW__ && globalThis.__WG_ASSETS__?.[v.src]) || v.src} width={w} height={h} alt={label} decoding="async" />
    </span>
  );
}
