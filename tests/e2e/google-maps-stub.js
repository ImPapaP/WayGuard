// Minimal stand-in for the Google Maps JavaScript API, served by the browser
// test at https://maps.googleapis.com/maps/api/js so Wayguard's Google Maps
// code can be exercised without contacting Google. It implements only the
// calls Wayguard makes and records them on window.__gm for assertions.
// Set window.__gmMode = 'auth-failure' (via an init script) to simulate a
// rejected API key.
(function () {
  const script = document.currentScript;
  const params = new URL(script.src).searchParams;
  const rec = (window.__gm = { url: script.src, maps: [], markers: [], circles: [] });

  function Listeners() {
    const map = {};
    return {
      add(name, fn) {
        (map[name] = map[name] || []).push(fn);
        return { remove: () => (map[name] = map[name].filter((f) => f !== fn)) };
      },
      fire(name, arg) {
        (map[name] || []).slice().forEach((fn) => fn(arg));
      },
      clear() {
        for (const k of Object.keys(map)) delete map[k];
      },
    };
  }
  const ll = (lat, lng) => ({ lat: () => lat, lng: () => lng });

  class LatLngBounds {
    constructor() {
      this.pts = [];
    }
    extend(p) {
      this.pts.push(p);
      return this;
    }
    contains(p) {
      return this.pts.length > 0 && Math.abs(p.lat - this.pts[0].lat) < 0.01 && Math.abs(p.lng - this.pts[0].lng) < 0.01;
    }
  }

  class Map {
    constructor(el, opts) {
      this.el = el;
      this.opts = opts;
      this.center = opts.center;
      this.zoom = opts.zoom;
      this.l = Listeners();
      el.classList.add('gm-stub');
      el.style.position = 'relative';
      el.style.background = '#e5e3df';
      this.layer = document.createElement('div');
      this.layer.style.cssText = 'position:absolute;inset:0;overflow:hidden';
      el.appendChild(this.layer);
      el.addEventListener('click', (e) => {
        if (e.target !== this.layer) return;
        this.l.fire('click', { latLng: ll(14.85, 120.815) });
      });
      rec.maps.push(this);
      setTimeout(() => this.l.fire('idle'), 0);
    }
    addListener(name, fn) {
      return this.l.add(name, fn);
    }
    setCenter(c) {
      this.center = c;
    }
    panTo(c) {
      this.center = c;
    }
    getCenter() {
      return ll(this.center.lat, this.center.lng);
    }
    getZoom() {
      return this.zoom;
    }
    setZoom(z) {
      this.zoom = z;
    }
    fitBounds(b) {
      this.fitted = b.pts.length;
      this.zoom = 18;
      setTimeout(() => this.l.fire('idle'), 0);
    }
    getBounds() {
      const b = new LatLngBounds();
      b.extend(this.center);
      return b;
    }
  }

  class AdvancedMarkerElement {
    constructor(o) {
      this.l = Listeners();
      this.title = o.title;
      this.content = o.content;
      this.gmpClickable = o.gmpClickable;
      this.gmpDraggable = o.gmpDraggable;
      this.zIndex = o.zIndex;
      this.wrap = document.createElement('div');
      this.wrap.className = 'gm-stub-marker';
      this.wrap.title = o.title || '';
      this.wrap.style.cssText = 'position:absolute';
      if (o.gmpClickable) {
        this.wrap.setAttribute('role', 'button');
        this.wrap.tabIndex = 0;
      }
      this.wrap.appendChild(o.content);
      this.wrap.addEventListener('click', () => this.l.fire('click', {}));
      this.position = o.position;
      this.map = o.map;
      rec.markers.push(this);
    }
    set position(p) {
      this._p = p;
      if (this.wrap) {
        const i = rec.markers.indexOf(this);
        this.wrap.style.left = `${40 + ((Math.abs(p.lng * 1e4) % 60) * 5)}px`;
        this.wrap.style.top = `${240 + ((Math.abs(p.lat * 1e4) % 30) * 6) + (i % 3)}px`;
      }
    }
    get position() {
      return this._p;
    }
    set map(m) {
      this._m = m;
      if (m) m.layer.appendChild(this.wrap);
      else this.wrap.remove();
    }
    get map() {
      return this._m;
    }
    addListener(name, fn) {
      return this.l.add(name, fn);
    }
    // test helper: simulate dragging the marker to a new place
    __drag(lat, lng) {
      this.position = { lat, lng };
      this.l.fire('dragend', { latLng: ll(lat, lng) });
    }
  }

  class Circle {
    constructor(o) {
      this.o = o;
      rec.circles.push(this);
    }
    setMap(m) {
      this.o.map = m;
    }
  }

  const event = {
    addListenerOnce(target, name, fn) {
      const h = target.addListener(name, (a) => {
        h.remove();
        fn(a);
      });
      return h;
    },
    clearInstanceListeners(target) {
      target.l?.clear();
    },
  };

  window.google = { maps: { Map, LatLngBounds, Circle, event, marker: { AdvancedMarkerElement } } };
  setTimeout(() => {
    if (window.__gmMode === 'auth-failure') {
      window[params.get('callback')]();
      setTimeout(() => window.gm_authFailure?.(), 50);
      return;
    }
    window[params.get('callback')]();
  }, 30);
})();
