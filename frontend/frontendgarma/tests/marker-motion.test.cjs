const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const load = () => {
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../src/utils/markerMotion.ts'), 'utf8');
  const frames = [];
  let clock = 0;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module, exports: module.exports, Math, Number, WeakMap,
    performance: { now: () => clock },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => {},
  });
  const runFrame = (at) => { clock = at; const pending = frames.splice(0); pending.forEach((fn) => fn(at)); };
  return { motion: module.exports, setClock: (t) => { clock = t; }, runFrame };
};

const fakeMarker = (lat, lng) => {
  let pos = { lat, lng };
  return { getLatLng: () => pos, setLatLng: (p) => { pos = Array.isArray(p) ? { lat: p[0], lng: p[1] } : p; } };
};

test('bearing points the bus in the direction it travels', () => {
  const { motion } = load();
  assert.ok(Math.abs(motion.bearingDegrees([14.6, -90.5], [14.61, -90.5]) - 0) < 0.5);
  assert.ok(Math.abs(motion.bearingDegrees([14.6, -90.5], [14.6, -90.49]) - 90) < 0.5);
});

test('each segment lasts as long as the real gap between readings, within limits', () => {
  const { motion } = load();
  assert.equal(motion.segmentDuration(null), 1000);
  assert.equal(motion.segmentDuration(1200), 1200);
  assert.equal(motion.segmentDuration(50), 350);
  assert.equal(motion.segmentDuration(60_000), 4000);
});

test('the marker glides between readings and reports its heading', () => {
  const { motion, setClock, runFrame } = load();
  const marker = fakeMarker(14.6, -90.5);
  const headings = [];
  setClock(0);
  motion.animateMarkerPosition(marker, [14.6005, -90.5], (h) => headings.push(h));
  runFrame(500);
  const mid = marker.getLatLng().lat;
  assert.ok(mid > 14.6 && mid < 14.6005, 'moves part of the way');
  runFrame(1000);
  assert.equal(marker.getLatLng().lat, 14.6005);
  assert.equal(headings.length, 1);
  assert.ok(headings[0] < 1 || headings[0] > 359);
});

test('a jump of several kilometers snaps instead of sliding across the city', () => {
  const { motion, setClock } = load();
  const marker = fakeMarker(14.6, -90.5);
  setClock(0);
  motion.animateMarkerPosition(marker, [14.7, -90.5]);
  assert.equal(marker.getLatLng().lat, 14.7);
});
