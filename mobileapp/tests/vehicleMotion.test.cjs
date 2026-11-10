const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadEstimator() {
  const file = path.resolve(__dirname, '../src/services/vehicleMotion.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', code)(mod, mod.exports);
  return mod.exports;
}

const { VehicleMotionEstimator, STANDARD_GRAVITY: G } = loadEstimator();

// Teléfono en un soporte vertical: la gravedad cae sobre su eje Y y "adelante" del bus es su -Z.
const gravityG = { x: 0, y: 1, z: 0 };
const forwardPhone = { x: 0, y: 0, z: -1 };

function drive(est, { seconds, startAt, speed, accel = 0, yaw = 0 }) {
  let t = startAt;
  let v = speed;
  for (let i = 0; i < seconds * 10; i += 1) {
    t += 100;
    v = Math.max(0, v + accel * 0.1);
    est.onAccelerometer({
      x: gravityG.x + (forwardPhone.x * accel) / G,
      y: gravityG.y + (forwardPhone.y * accel) / G,
      z: gravityG.z + (forwardPhone.z * accel) / G,
    }, t);
    est.onGyroscope({ x: 0, y: yaw, z: 0 });
    if (i % 10 === 9) est.onGps(v, t);
  }
  return { t, v };
}

test('sin lecturas no hay sensores', () => {
  assert.equal(new VehicleMotionEstimator().state(), 'unavailable');
});

test('al arrancar no inventa aceleraciones aunque el teléfono vaya vertical', () => {
  const est = new VehicleMotionEstimator();
  const { t } = drive(est, { seconds: 3, startAt: 0, speed: 0 });
  assert.equal(est.state(), 'ready');
  const w = est.takeWindow();
  assert.equal(w.calibrated, true);
  assert.ok(Math.abs(w.longitudinal) < 0.2, `longitudinal ${w.longitudinal}`);
  assert.ok(Math.abs(w.vertical) < 0.2, `vertical ${w.vertical}`);
  assert.ok(t > 0);
});

test('aprende "adelante" con el GPS y mide un frenazo en ejes del autobús', () => {
  const est = new VehicleMotionEstimator();
  let state = drive(est, { seconds: 3, startAt: 0, speed: 0 });
  for (let i = 0; i < 4; i += 1) {
    state = drive(est, { seconds: 3, startAt: state.t, speed: state.v, accel: 1.5 });
    state = drive(est, { seconds: 2, startAt: state.t, speed: state.v, accel: -1.5 });
  }
  est.takeWindow();
  state = drive(est, { seconds: 1, startAt: state.t, speed: 12, accel: -4.5 });
  const w = est.takeWindow();
  assert.equal(w.forwardLearned, true);
  assert.ok(w.longitudinal < -3.5, `frenado ${w.longitudinal}`);
});

test('antes de aprender "adelante" usa la velocidad del GPS para el frenado', () => {
  const est = new VehicleMotionEstimator();
  let state = drive(est, { seconds: 3, startAt: 0, speed: 0 });
  state = drive(est, { seconds: 1, startAt: state.t, speed: 15, accel: 0 });
  est.takeWindow();
  drive(est, { seconds: 1, startAt: state.t, speed: 15, accel: -4 });
  const w = est.takeWindow();
  assert.equal(w.forwardLearned, false);
  assert.ok(w.longitudinal < -3, `frenado ${w.longitudinal}`);
});

test('el giro lateral sale de velocidad × giro, sin importar cómo esté el teléfono', () => {
  const est = new VehicleMotionEstimator();
  let state = drive(est, { seconds: 3, startAt: 0, speed: 0 });
  state = drive(est, { seconds: 1, startAt: state.t, speed: 10 });
  est.takeWindow();
  drive(est, { seconds: 1, startAt: state.t, speed: 10, yaw: 0.35 });
  const w = est.takeWindow();
  assert.ok(Math.abs(w.yawRate - 0.35) < 0.02, `giro ${w.yawRate}`);
  assert.ok(Math.abs(Math.abs(w.lateral) - 3.5) < 0.2, `lateral ${w.lateral}`);
});

test('envía el pico de la ventana, no la última muestra', () => {
  const est = new VehicleMotionEstimator();
  let state = drive(est, { seconds: 3, startAt: 0, speed: 0 });
  state = drive(est, { seconds: 1, startAt: state.t, speed: 10 });
  est.takeWindow();
  state = drive(est, { seconds: 0.4, startAt: state.t, speed: 10, yaw: 0.5 });
  drive(est, { seconds: 0.6, startAt: state.t, speed: 10, yaw: 0 });
  const w = est.takeWindow();
  assert.ok(Math.abs(w.yawRate) > 0.4, `giro ${w.yawRate}`);
});

test('un salto imposible del GPS no se cuenta como frenazo', () => {
  const est = new VehicleMotionEstimator();
  const state = drive(est, { seconds: 3, startAt: 0, speed: 0 });
  est.onGps(20, state.t + 1000);
  est.takeWindow();
  est.onGps(0, state.t + 2000);
  const w = est.takeWindow();
  assert.ok(w.longitudinal > -1, `frenado ${w.longitudinal}`);
});
