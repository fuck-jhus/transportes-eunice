const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/utils/speedAlert.ts');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: mod, exports: mod.exports, Math });
const { nextSpeedAlert, initialSpeedAlert } = mod.exports;
const run = (speeds, opts = {}) => {
  let state = initialSpeedAlert; const notes = [];
  speeds.forEach((speedKmh, i) => {
    const r = nextSpeedAlert(state, { speedKmh, fresh: opts.fresh ?? true, enabled: opts.enabled ?? true, now: i * (opts.step ?? 1000) });
    state = r.state; notes.push(r.notify);
  });
  return { state, notes };
};

test('a single GPS spike over the limit does not alert', () => {
  const { state, notes } = run([70, 95, 70]);
  assert.equal(state.active, false);
  assert.deepEqual(notes, [false, false, false]);
});

test('two readings over 80 km/h alert once and keep the peak', () => {
  const { state, notes } = run([78, 84, 92, 88]);
  assert.equal(state.active, true);
  assert.equal(state.peakKmh, 92);
  assert.deepEqual(notes, [false, false, true, false]);
});

test('alert stays on near the limit and clears under 75 km/h', () => {
  assert.equal(run([85, 86, 78]).state.active, true);
  assert.equal(run([85, 86, 74]).state.active, false);
});

test('continued speeding notifies again after a minute', () => {
  const { notes } = run([90, 90, 90, 90], { step: 30_000 });
  assert.deepEqual(notes, [false, true, false, true]);
});

test('no alert without a trip, in privacy or with stale GPS', () => {
  assert.equal(run([90, 90, 90], { enabled: false }).state.active, false);
  assert.equal(run([90, 90, 90], { fresh: false }).state.active, false);
});
