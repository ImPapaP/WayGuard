// "Wayguard Road" map styles for MapLibre GL: road maps that look and read
// like a driving app such as Waze, drawn in Wayguard's own colours.
//   night (default)  Night Ink land, slate-grey streets, Road Amber main roads
//                    and highways, white route-number shields, light labels
//   day              Cloud land, white streets, amber main roads, Navy labels
// Few shops or icons, thick rounded roads and large readable road names.
// Data: OpenStreetMap through any OpenMapTiles-schema vector tile service
// (OpenFreeMap by default; see server/src/config.js `maps.vector`).

export const PALETTES = {
  day: {
    land: '#EEF1F5',
    residential: '#E7EBF0',
    park: '#D3EACB',
    wood: '#C8E3BD',
    sand: '#F3ECD6',
    water: '#AED6F1',
    waterLabel: '#2F6E9E',
    building: '#DCE1E8',
    buildingLine: '#CDD4DE',
    aeroway: '#E2E6ED',
    minor: '#FFFFFF',
    minorCasing: '#C7CFDA',
    service: '#FFFFFF',
    secondary: '#FFF0C2',
    secondaryCasing: '#E3C46A',
    primary: '#FFD36B',
    primaryCasing: '#E09A00',
    motorway: '#FAAE0B',
    motorwayCasing: '#B87800',
    path: '#C3CBD6',
    rail: '#B9C1CC',
    boundary: '#97A3B6',
    roadText: '#24344D',
    placeText: '#0A2244',
    placeTextMinor: '#3E4C63',
    halo: '#FFFFFF',
    shield: '#FFFFFF',
    shieldLine: '#0A2244',
    shieldText: '#0A2244',
    overlayFill: '#6D8BBE',
    overlayLine: '#2B4F8A',
  },
  // Night Ink #061429 / Wayguard Navy #0A2244 base, like a driving app's night mode.
  night: {
    land: '#0B1A31',
    residential: '#0E1F3A',
    park: '#0F3330',
    wood: '#11382F',
    sand: '#1C2433',
    water: '#06253F',
    waterLabel: '#6D8BBE',
    building: '#14284A',
    buildingLine: '#1B335A',
    aeroway: '#13233F',
    minor: '#3A4A63',
    minorCasing: '#0A1830',
    service: '#2F3E56',
    secondary: '#56657D',
    secondaryCasing: '#0A1830',
    primary: '#B87800',
    primaryCasing: '#061429',
    motorway: '#FAAE0B',
    motorwayCasing: '#061429',
    path: '#33435C',
    rail: '#3A4A63',
    boundary: '#55657F',
    roadText: '#D7DFEA',
    placeText: '#F5F7FA',
    placeTextMinor: '#9FB0C8',
    halo: '#061429',
    shield: '#F5F7FA',
    shieldLine: '#061429',
    shieldText: '#061429',
    overlayFill: '#6D8BBE',
    overlayLine: '#9FB6DD',
  },
};

// Stretchable rounded "route number" shield, drawn at runtime (no sprite).
export function shieldImage(theme = 'night') {
  const C = PALETTES[theme] || PALETTES.night;
  const size = 40;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = C.shield;
  g.strokeStyle = C.shieldLine;
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(2.5, 2.5, size - 5, size - 5, 9);
  g.fill();
  g.stroke();
  return {
    image: g.getImageData(0, 0, size, size),
    options: { pixelRatio: 2, stretchX: [[12, 28]], stretchY: [[12, 28]], content: [8, 8, 32, 32] },
  };
}

const cls = (...classes) => ['match', ['get', 'class'], classes, true, false];
const notBrunnel = (b) => ['!=', ['get', 'brunnel'], b];
const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const width = (stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()];
const round = { 'line-cap': 'round', 'line-join': 'round' };

// Road widths in pixels by zoom, Waze-like: generous and rounded.
const roads = (C) => [
  { id: 'service', classes: ['service', 'track'], minzoom: 14, fill: C.service, casing: C.minorCasing, w: [[14, 1], [16, 4], [18, 11]] },
  { id: 'minor', classes: ['minor'], minzoom: 12, fill: C.minor, casing: C.minorCasing, w: [[12, 0.8], [14, 4], [16, 9], [18, 22]] },
  { id: 'secondary', classes: ['secondary', 'tertiary'], minzoom: 9, fill: C.secondary, casing: C.secondaryCasing, w: [[9, 0.8], [12, 2.5], [14, 7], [16, 13], [18, 28]] },
  { id: 'primary', classes: ['primary', 'trunk'], minzoom: 7, fill: C.primary, casing: C.primaryCasing, w: [[7, 0.8], [10, 2], [12, 4], [14, 9], [16, 16], [18, 34]] },
  { id: 'motorway', classes: ['motorway'], minzoom: 5, fill: C.motorway, casing: C.motorwayCasing, w: [[5, 0.8], [9, 2.5], [12, 5], [14, 10], [16, 18], [18, 38]] },
];

function roadLayers(C) {
  const ROADS = roads(C);
  const casings = [];
  const fills = [];
  for (const r of ROADS) {
    const filter = ['all', isLine, cls(...r.classes), notBrunnel('tunnel')];
    const casingW = width(r.w.map(([z, w]) => [z, w + (z >= 13 ? 2.5 : 1)]));
    casings.push({
      id: `road-${r.id}-casing`,
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: r.minzoom,
      filter,
      layout: round,
      paint: { 'line-color': r.casing, 'line-width': casingW },
    });
    fills.push({
      id: `road-${r.id}`,
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: r.minzoom,
      filter,
      layout: round,
      paint: { 'line-color': r.fill, 'line-width': width(r.w) },
    });
  }
  // Tunnels: same colours, faded and dashed casing.
  const tunnels = ROADS.map((r) => ({
    id: `tunnel-${r.id}`,
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    minzoom: r.minzoom,
    filter: ['all', isLine, cls(...r.classes), ['==', ['get', 'brunnel'], 'tunnel']],
    layout: round,
    paint: { 'line-color': r.fill, 'line-opacity': 0.55, 'line-width': width(r.w) },
  }));
  return [...tunnels, ...casings, ...fills];
}

export function buildRoadStyle({ tilejson, glyphs, attribution }, theme = 'night') {
  const C = PALETTES[theme] || PALETTES.night;
  return {
    version: 8,
    name: `Wayguard Road (${theme})`,
    glyphs,
    sources: {
      openmaptiles: { type: 'vector', url: tilejson, attribution },
      // GPS accuracy ring and similar overlays
      overlay: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': C.land } },
      {
        id: 'landuse-residential',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: cls('residential', 'suburb', 'neighbourhood'),
        paint: { 'fill-color': C.residential },
      },
      {
        id: 'landcover-wood',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: cls('wood', 'forest'),
        paint: { 'fill-color': C.wood },
      },
      {
        id: 'landcover-grass',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: cls('grass', 'farmland', 'wetland'),
        paint: { 'fill-color': C.park, 'fill-opacity': 0.7 },
      },
      {
        id: 'landcover-sand',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: cls('sand'),
        paint: { 'fill-color': C.sand },
      },
      { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: { 'fill-color': C.park } },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        filter: notBrunnel('tunnel'),
        paint: { 'fill-color': C.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        filter: notBrunnel('tunnel'),
        layout: round,
        paint: { 'line-color': C.water, 'line-width': width([[8, 0.5], [13, 2], [16, 5], [18, 9]]) },
      },
      {
        id: 'aeroway',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'aeroway',
        minzoom: 11,
        filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        paint: { 'fill-color': C.aeroway },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 15,
        paint: {
          'fill-color': C.building,
          'fill-outline-color': C.buildingLine,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 1],
        },
      },
      {
        id: 'path',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 15,
        filter: ['all', isLine, cls('path', 'pedestrian')],
        layout: round,
        paint: { 'line-color': C.path, 'line-width': width([[15, 1], [18, 3]]), 'line-dasharray': [1, 1.5] },
      },
      ...roadLayers(C),
      {
        id: 'rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: ['all', isLine, cls('rail', 'transit')],
        paint: { 'line-color': C.rail, 'line-width': width([[11, 1], [16, 2.5], [18, 4]]) },
      },
      {
        id: 'boundary-country',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': C.boundary, 'line-width': 1.2, 'line-dasharray': [3, 2] },
      },
      {
        id: 'overlay-fill',
        type: 'fill',
        source: 'overlay',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': C.overlayFill, 'fill-opacity': 0.16 },
      },
      {
        id: 'overlay-line',
        type: 'line',
        source: 'overlay',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': C.overlayLine, 'line-width': 1.5 },
      },
      ...['point', 'line'].map((placement) => ({
        id: `water-name-${placement}`,
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'water_name',
        filter:
          placement === 'line'
            ? ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
            : ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'symbol-placement': placement,
        },
        paint: { 'text-color': C.waterLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
      })),
      {
        id: 'road-name-minor',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 15,
        filter: ['all', isLine, cls('minor', 'service')],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 18, 14],
          'symbol-placement': 'line',
          'text-max-angle': 30,
        },
        paint: { 'text-color': C.roadText, 'text-halo-color': C.halo, 'text-halo-width': 2 },
      },
      {
        id: 'road-name-major',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 11,
        filter: ['all', isLine, cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary')],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 14, 18, 16],
          'symbol-placement': 'line',
          'text-max-angle': 30,
        },
        paint: { 'text-color': C.roadText, 'text-halo-color': C.halo, 'text-halo-width': 2.2 },
      },
      {
        // Route numbers in white shields, as on driving apps.
        id: 'road-shield',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 9,
        filter: ['all', isLine, ['has', 'ref'], ['<=', ['length', ['to-string', ['get', 'ref']]], 6], cls('motorway', 'trunk', 'primary')],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 420,
          'text-field': ['get', 'ref'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-rotation-alignment': 'viewport',
          'icon-rotation-alignment': 'viewport',
          'icon-image': 'wg-shield',
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [3, 6, 3, 6],
        },
        paint: { 'text-color': C.shieldText },
      },
      {
        id: 'place-minor',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 12,
        filter: cls('village', 'suburb', 'neighbourhood', 'quarter', 'hamlet'),
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 14],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.06,
          'text-max-width': 8,
        },
        paint: { 'text-color': C.placeTextMinor, 'text-halo-color': C.halo, 'text-halo-width': 1.8 },
      },
      {
        id: 'place-town',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        filter: cls('city', 'town'),
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 12, 16, 16, 20],
          'text-max-width': 8,
        },
        paint: { 'text-color': C.placeText, 'text-halo-color': C.halo, 'text-halo-width': 2 },
      },
      {
        id: 'place-region',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        maxzoom: 9,
        filter: cls('country', 'state'),
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Bold'],
          'text-size': 13,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.1,
        },
        paint: { 'text-color': C.placeTextMinor, 'text-halo-color': C.halo, 'text-halo-width': 2 },
      },
    ],
  };
}
