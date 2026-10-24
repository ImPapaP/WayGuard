# Screenshots

Captured from the running application with the demo data, on 23 October 2026,
at 1366 px (prefix `d-`) and 390 px phone width (prefix `m-`).

**Note:** the development environment could not reach the OpenStreetMap tile
server, so map tiles in these screenshots were replaced by a plain grey grid
with white lines. Markers, controls and attribution are real. With internet
access the maps show real OpenStreetMap streets.

Demo photos are generated illustrations stamped "DEMO PHOTO".

`d-16-map-screen.jpg`, `m-16-map-night.jpg` (night map), `d-17-drive-mode.jpg`,
`m-18-drive-mode.jpg` and `m-19-drive-day.jpg` (drive mode, night and day; 24
October) show the Waze-style map screen with the default "Wayguard Road"
vector style; drive mode was fed simulated GPS positions. The streets in them ("Test Town", "Test Highway"…) are a
**synthetic test town** served by `tests/e2e/vector-fixture.mjs`, because
OpenFreeMap could not be reached from the build environment; with internet
access the same style draws the real OpenStreetMap streets of your LGU.
