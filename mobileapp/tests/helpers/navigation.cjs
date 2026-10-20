const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function loader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
    const req = name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(file), name);
        return load(fs.existsSync(base + '.ts') ? base + '.ts' : base + '.tsx');
      }
      return require(name);
    };
    vm.runInNewContext(code, { module: mod, exports: mod.exports, require: req, AbortController,
      setTimeout, clearTimeout, Date, console, ...globals }, { filename: file });
    return mod.exports;
  }
  return load;
}

// Runs the real generated WebView script; Leaflet primitives and the clock are controlled.
function embeddedMap({ reducedMotion = false } = {}) {
  const { createLeafletDocument } = loader({ react: { forwardRef: fn => fn },
    'react-native': { StyleSheet: { create: x => x } }, 'react-native-webview': {},
    '../screens/leafletAssets': { LEAFLET_CSS: '', LEAFLET_JS: '' } })('src/components/LeafletNativeMap.tsx');
  const markers = [], polylines = [], layers = [], frames = new Map(), pans = [], messages = [], events = {}, domEvents = {};
  let now = 0, frameId = 0, center = [14, -91];
  const map = { zoomControl: { setPosition(value) { this.position = value; } },
    dragging: { enable() {} }, touchZoom: { enable() {} }, doubleClickZoom: { enable() {} }, scrollWheelZoom: { enable() {} },
    on(name, fn) { events[name] = fn; }, getContainer: () => ({ addEventListener(name, fn) { domEvents[name] = fn; } }),
    getCenter: () => ({ lat: center[0], lng: center[1] }),
    getBounds: () => ({ getNorth: () => center[0] + .01, getSouth: () => center[0] - .01,
      getEast: () => center[1] + .01, getWest: () => center[1] - .01 }),
    invalidateSize() {}, panTo(point) { center = point; pans.push(point); events.moveend?.(); }, flyTo(point) { center = point; }, fitBounds() {} };
  const L = { Browser: { retina: false }, map: () => map,
    layerGroup() { const group = { clears: 0, removed: [], addTo() { return this; }, clearLayers() { this.clears++; }, removeLayer(layer) { this.removed.push(layer); } }; layers.push(group); return group; },
    tileLayer: () => ({ addTo() { return this; }, bringToBack() {} }), divIcon: x => x, latLngBounds: x => x,
    polyline(points, options) { const line = { points, options, updates: 0, addTo() { return this; },
      setLatLngs(points) { this.points = points; this.updates++; return this; }, setStyle(style) { Object.assign(this.options, style); }, bringToFront() {} }; polylines.push(line); return line; },
    circle(point, options) { return { point, options, addTo() { return this; }, setLatLng(point) { this.point = point; }, setRadius(radius) { this.options.radius = radius; } }; },
    marker(point, options) { const marker = { position: point, options, addTo() { return this; },
      setIcon(icon) { this.options.icon = icon; }, getLatLng() { return { lat: this.position[0], lng: this.position[1] }; },
      setLatLng(point) { this.position = point; }, on() {}, bindPopup() {} }; markers.push(marker); return marker; } };
  const window = { addEventListener() {}, matchMedia: () => ({ matches: reducedMotion }),
    ReactNativeWebView: { postMessage: data => messages.push(JSON.parse(data)) },
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame(id) { frames.delete(id); } };
  const html = createLeafletDocument();
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInNewContext(script, { window, document: { body: { className: '' } }, L,
    performance: { now: () => now }, setTimeout: fn => fn() });
  return { html, window, markers, polylines, layers, pans, messages, events, domEvents, map,
    routes: routes => window.__EUNICE_MAP_ROUTES(routes),
    update: userMarker => window.__EUNICE_MAP_UPDATE({ theme: 'light', userMarker, buses: [] }),
    advance(time) { now = time; for (const [key, fn] of [...frames]) { frames.delete(key); fn(time); } } };
}
module.exports = { loader, embeddedMap, root };
