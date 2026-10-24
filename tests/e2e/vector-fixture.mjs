// Local stand-in for a vector map tile service, for browser tests without
// internet. Serves a TileJSON, Mapbox Vector Tiles (OpenMapTiles layer and
// field names) generated on the fly from a small SYNTHETIC test town around
// the demo map centre, and label glyphs from tests/e2e/fixtures/glyphs.
// The streets are made up for testing; they are not real Malolos geometry.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENT = 4096;

// ---------------------------------------------------------------- protobuf
class Pbf {
  constructor() {
    this.bytes = [];
  }
  varint(n) {
    let v = n;
    while (v > 0x7f) {
      this.bytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.bytes.push(v);
  }
  tag(field, wire) {
    this.varint((field << 3) | wire);
  }
  uint(field, n) {
    this.tag(field, 0);
    this.varint(n);
  }
  bytesField(field, buf) {
    this.tag(field, 2);
    this.varint(buf.length);
    for (const b of buf) this.bytes.push(b);
  }
  string(field, s) {
    this.bytesField(field, [...Buffer.from(s, 'utf8')]);
  }
  packed(field, nums) {
    const p = new Pbf();
    for (const n of nums) p.varint(n);
    this.bytesField(field, p.bytes);
  }
  message(field, fn) {
    const p = new Pbf();
    fn(p);
    this.bytesField(field, p.bytes);
  }
}
const zig = (n) => (n << 1) ^ (n >> 31);

// ---------------------------------------------------------------- geometry
function project(lng, lat, z, x, y) {
  const n = 2 ** z;
  const px = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [Math.round((px - x) * EXTENT), Math.round((py - y) * EXTENT)];
}

function encodeGeometry(type, rings) {
  const out = [];
  let cx = 0;
  let cy = 0;
  for (const ring of rings) {
    const pts = type === 3 ? ring.slice(0, -1) : ring;
    out.push((1 & 7) | (1 << 3));
    out.push(zig(pts[0][0] - cx), zig(pts[0][1] - cy));
    [cx, cy] = pts[0];
    if (type === 1) continue;
    out.push((2 & 7) | ((pts.length - 1) << 3));
    for (const p of pts.slice(1)) {
      out.push(zig(p[0] - cx), zig(p[1] - cy));
      [cx, cy] = p;
    }
    if (type === 3) out.push((7 & 7) | (1 << 3));
  }
  return out;
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i += 1) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

// ---------------------------------------------------------------- test town
const C = { lat: 14.8505, lng: 120.815 };
const at = (dx, dy) => [C.lng + dx * 0.001, C.lat + dy * 0.001]; // ~110 m steps
const rect = (x0, y0, x1, y1) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];

const FEATURES = [];
const add = (layer, type, coords, props = {}) => FEATURES.push({ layer, type, coords, props });

add('water', 3, [[at(-60, -60), at(-14, -60), at(-12, -20), at(-16, 10), at(-13, 60), at(-60, 60), at(-60, -60)]], { class: 'river' });
add('waterway', 2, [[at(-12, -60), at(-9, -25), at(-11, 0), at(-8, 30), at(-10, 60)]], { class: 'river' });
add('water_name', 2, [[at(-30, -20), at(-30, 20)]], { name: 'Test River', class: 'river' });
add('landuse', 3, [rect(-8, -30, 30, 30)], { class: 'residential' });
add('park', 3, [rect(4, 4, 9, 9)], { class: 'park' });
add('landcover', 3, [rect(18, -28, 30, -16)], { class: 'farmland', subclass: 'farmland' });
for (let i = -6; i <= 26; i += 3) {
  for (let j = -26; j <= 26; j += 3) {
    if ((i * 7 + j * 3) % 5 === 0) continue;
    add('building', 3, [rect(i + 0.4, j + 0.4, i + 1.6, j + 1.4)], {});
  }
}
const road = (cls, name, pts, extra = {}) => {
  add('transportation', 2, [pts.map(([x, y]) => at(x, y))], { class: cls, ...extra });
  if (name || extra.ref) {
    const props = { class: cls, ...(name ? { name } : {}), ...(extra.ref ? { ref: extra.ref, ref_length: extra.ref.length } : {}) };
    add('transportation_name', 2, [pts.map(([x, y]) => at(x, y))], props);
  }
};
road('motorway', 'Test Expressway', [[-40, 40], [0, 34], [40, 30], [60, 28]], { ref: 'E1' });
road('primary', 'Test Highway', [[-30, -40], [2, -2], [10, 12], [40, 50]], { ref: 'N1' });
road('secondary', 'Test Avenue', [[-8, -12], [30, -12]]);
road('tertiary', 'Congress Road', [[-8, 2], [30, 2]]);
for (const x of [-4, 6, 14, 22]) road('minor', `Street ${x + 10}`, [[x, -26], [x, 26]]);
for (const y of [-22, -6, 14, 22]) road('minor', null, [[-8, y], [30, y]]);
road('service', null, [[8, 4], [8, 9]]);
road('minor', 'Underpass', [[24, -26], [26, 26]], { brunnel: 'tunnel' });
add('place', 1, [[at(10, 8)]], { class: 'town', name: 'Test Town', rank: 10 });
add('place', 1, [[at(16, -18)]], { class: 'suburb', name: 'North Barangay', rank: 15 });
add('place', 1, [[at(0, 20)]], { class: 'village', name: 'South Barangay', rank: 16 });

function bboxOf(f) {
  let a = Infinity;
  let b = Infinity;
  let c = -Infinity;
  let d = -Infinity;
  for (const ring of f.coords) for (const [x, y] of ring) [a, b, c, d] = [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)];
  return [a, b, c, d];
}
for (const f of FEATURES) f.bbox = bboxOf(f);

function tileBounds(z, x, y) {
  const n = 2 ** z;
  const lng = (t) => (t / n) * 360 - 180;
  const lat = (t) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI;
  return [lng(x), lat(y + 1), lng(x + 1), lat(y)];
}

function buildTile(z, x, y) {
  const [w, s, e, nn] = tileBounds(z, x, y);
  const padX = (e - w) * 0.1;
  const padY = (nn - s) * 0.1;
  const byLayer = new Map();
  for (const f of FEATURES) {
    const [a, b, c, d] = f.bbox;
    if (c < w - padX || a > e + padX || d < s - padY || b > nn + padY) continue;
    if (!byLayer.has(f.layer)) byLayer.set(f.layer, []);
    byLayer.get(f.layer).push(f);
  }
  const tile = new Pbf();
  for (const [name, feats] of byLayer) {
    tile.message(3, (layer) => {
      layer.uint(15, 2);
      layer.string(1, name);
      const keys = [];
      const values = [];
      const keyIdx = (k) => (keys.includes(k) ? keys.indexOf(k) : keys.push(k) - 1);
      const valIdx = (v) => {
        const id = `${typeof v}:${v}`;
        const i = values.findIndex((x) => x.id === id);
        return i >= 0 ? i : values.push({ id, v }) - 1;
      };
      feats.forEach((f, i) => {
        const rings = f.coords.map((ring) => ring.map(([lng, lat]) => project(lng, lat, z, x, y)));
        if (f.type === 3) for (const r of rings) if (signedArea(r) < 0) r.reverse();
        layer.message(2, (feat) => {
          feat.uint(1, i + 1);
          const tags = [];
          for (const [k, v] of Object.entries(f.props)) tags.push(keyIdx(k), valIdx(v));
          if (tags.length) feat.packed(2, tags);
          feat.uint(3, f.type);
          feat.packed(4, encodeGeometry(f.type, rings));
        });
      });
      for (const k of keys) layer.string(3, k);
      for (const { v } of values) {
        layer.message(4, (val) => {
          if (typeof v === 'string') val.string(1, v);
          else val.uint(5, v);
        });
      }
      layer.uint(5, EXTENT);
    });
  }
  return Buffer.from(tile.bytes);
}

// ---------------------------------------------------------------- server
export async function startVectorFixture() {
  const hits = { tilejson: 0, tiles: 0, glyphs: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (url.pathname === '/planet') {
      hits.tilejson += 1;
      const base = `http://${req.headers.host}`;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          tilejson: '3.0.0',
          tiles: [`${base}/tiles/{z}/{x}/{y}.pbf`],
          minzoom: 0,
          maxzoom: 14,
          attribution: 'Test tiles (synthetic)',
          // All OpenMapTiles layers, as a real service lists them.
          vector_layers: ['water', 'waterway', 'landcover', 'landuse', 'mountain_peak', 'park', 'boundary', 'aeroway', 'transportation', 'building', 'water_name', 'transportation_name', 'place', 'housenumber', 'poi', 'aerodrome_label'].map((id) => ({ id, fields: {} })),
        }),
      );
      return;
    }
    let m = url.pathname.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (m) {
      hits.tiles += 1;
      res.setHeader('content-type', 'application/x-protobuf');
      res.end(buildTile(Number(m[1]), Number(m[2]), Number(m[3])));
      return;
    }
    m = decodeURIComponent(url.pathname).match(/^\/fonts\/([^/]+)\/(\d+-\d+)\.pbf$/);
    if (m) {
      hits.glyphs += 1;
      const font = m[1].split(',')[0].trim();
      const file = path.join(here, 'fixtures', 'glyphs', font, `${m[2]}.pbf`);
      if (fs.existsSync(file)) {
        res.setHeader('content-type', 'application/x-protobuf');
        res.end(fs.readFileSync(file));
      } else {
        // Only characters 0-255 are included; answer other ranges empty.
        res.setHeader('content-type', 'application/x-protobuf');
        res.end(Buffer.alloc(0));
      }
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    hits,
    tilejson: `${base}/planet`,
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    close: () => new Promise((r) => server.close(r)),
  };
}
