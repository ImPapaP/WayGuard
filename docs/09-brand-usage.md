# 9. Brand usage

Authority: *Wayguard Brand Sheet* (logo, logotype, typography, colour
palette, logo rules). Supplied originals are kept in `assets/brand-source/`.

## 9.1 Logo files used

| File (`client/public/brand/`) | Source | Variant | Used on |
| --- | --- | --- | --- |
| `wayguard-logotype-wmark-color.png` | Brand Sheet p.5 "Logotype with W mark — Full color · On white" (cropped from the sheet's artwork, background white) | W-mark logotype + slogan, full colour | White headers: public site, citizen app; PDF exports |
| `wayguard-logotype-wmark-reversed.png` | Brand Sheet p.5 "Reversed · On Night Ink #061429" | W-mark logotype + slogan, reversed | Night Ink surfaces: admin sidebar and mobile bar, crew app header |
| `wayguard-logo-full-color.png` | Supplied `Wayguard-Full-Logotype-with-Slogan-color.png` (transparent, proportionally resized to 1000 px) | Full lockup, full colour | Sign-in/registration on phones |
| `wayguard-logo-full-reversed.png` | Brand Sheet p.4 "Full lockup · Reversed on Night Ink" | Full lockup, reversed | Night Ink: sign-in brand panel, site footer |
| `wayguard-logo-mark-wordmark-color.png` | Supplied `Wayguard-Mark-and-Wordmark-color.png` (resized) | Mark and wordmark without slogan | Available for small placements |
| `wayguard-mark-color.png` | Mark portion of the supplied mark-and-wordmark PNG | W mark, full colour | Source for app icons and favicon |
| `wayguard-mark-reversed.png` | Brand Sheet p.3 "Reversed · On Night Ink" | W mark, reversed | Available for dark placements |

The Brand Sheet PDF contains only flattened page images, so the reversed and
W-mark logotype variants were cut from the sheet's lossless page images
exactly as drawn, trimmed against their solid backgrounds, and are placed
only on that same background colour (white or Night Ink `#061429`). No logo
was redrawn, recoloured, stretched, rotated or given effects, and the slogan
appears only as part of the artwork ("Spot the dip, save the trip.").
Vector originals were not supplied; if they become available, replace these
PNGs with the vector files (same names) for sharper print output.

App icons (`client/public/icons/`) place the full-colour W mark, unchanged,
on a white square with padding (larger padding for the maskable icon).

## 9.2 Rules applied

| Rule (Brand Sheet p.9) | How it is met |
| --- | --- |
| Clear space = height of the letter A on every side | Logos sit in bars with at least that much space: e.g. the 40 px header logotype (A ≈ 17 px) in a 72 px bar with 16–24 px gutters; sidebar logo with 20–24 px margins; PDF logo inside 36 pt page margins |
| Full lockup never below 160 px wide | Enforced in the `Logo` component (`client/src/components/Logo.jsx`): any lockup is enlarged to at least 160 px wide (header logotype is 167 px, sidebar 201 px, PDF ≈ 200 px) |
| W mark never below 32 px high on screen | Enforced in the `Logo` component. Exception: browser favicons (16–48 px) are drawn by the browser at system sizes; the 32 px and 48 px favicons are the smallest rendition |
| Keep it intact; reversed version on dark backgrounds | Only supplied artwork; reversed variants only on Night Ink |

## 9.3 Colour

Design tokens in `client/src/styles/tokens.css`:

| Token | Hex | Use |
| --- | --- | --- |
| `--navy` | `#0A2244` | Headings, primary dark buttons, navigation highlights |
| `--amber` | `#FAAE0B` | The one main action per screen (e.g. Report a pothole, Verify report), lane-line motif, attention markers |
| `--night` | `#061429` | Dark surfaces (admin sidebar, crew header, footer), body text |
| `--cloud` | `#F5F7FA` | Page background |
| Navy scale | `#061429 #0A2244 #12305F #2B4F8A #6D8BBE` | Supporting navy shades |
| Amber scale | `#B87800 #E09A00 #FAAE0B #FFC94D #FFE29A` | Supporting amber shades |

The suggested 50% Cloud / 30% Navy / 15% Amber / 5% neutrals balance is
followed: Cloud and white surfaces dominate, navy carries structure and text,
amber is reserved for primary actions and the road motif. Status colours
(red for high severity/rejected, green for resolved) are supporting neutrals
and always appear with an icon and a label.

## 9.4 Typography

Montserrat ExtraBold (800) for headings, titles and numerals; Montserrat
Bold (700) for sub-headings; Nunito Sans Regular/SemiBold/Bold (400/600/700)
for body text and the interface. Fonts are self-hosted from the official
Google Fonts sources (SIL Open Font License, licence files in
`client/public/fonts/`), with system sans-serif fallbacks. PDF exports use
the built-in Helvetica because the PDF library available cannot embed custom
fonts without an extra package.

## 9.5 Brand motif

The road from the W mark recurs as a functional element, not decoration:
the report progress is drawn as a road with an amber lane line and a stop per
status; the landing page "What happens after you report" uses the same road;
the amber dashed lane line from the Brand Sheet cover appears beside the
landing map, on the sign-in panel and on the citizen's Report card.

**Map style.** The default map ("Wayguard Road", `client/src/components/roadStyle.js`)
uses the brand palette. *Night* (default): Night Ink / Navy land
(`#0B1A31`), slate-grey streets, Road Amber main roads and highways
(`#B87800`, `#FAAE0B`), Cloud labels with Night Ink halos, white route-number
shields. *Day*: Cloud-tinted land, white streets, Road Amber scale for main
roads and highways (`#FFF0C2` → `#FFD36B` → `#FAAE0B`), Navy place labels.
The drive-mode arrow is Road Amber with a white outline. Report bubbles use the semantic colours (danger red, Road Amber, Navy
500) plus a letter tag, and the Report button is Road Amber with a Navy icon.
The layout borrows the *behaviour* of driving apps such as Waze (full-screen
map, floating controls, slide-up sheets); no Waze logo, mascot, icons or
colours are used.

## 9.6 Backgrounds and motion

- **Backdrops** (`client/src/components/HeroBackdrop.jsx`): roads drawn in the
  W-mark style (Navy/Cloud roads, Road Amber dashed lanes) drift slowly behind
  the landing hero, the roles band and the sign-in panel; a few report bubbles
  float at the edges (hidden on phones). Pages use a faint street pattern on
  Cloud (`#F5F7FA`).
- **Logo on dark:** the reversed logo is only placed on plain Night Ink
  (`#061429`), never on the gradient or the moving roads.
- **Motion** (`client/src/styles/motion.css`): rise-in of hero content,
  count-up numbers, scroll reveal (`data-reveal`), button press/sheen, card
  lift, footer road band. Only `transform`/`opacity` are animated, so it stays
  smooth on low-end phones. With the operating system's "reduce motion"
  setting on, all animation is switched off and content shows immediately.

