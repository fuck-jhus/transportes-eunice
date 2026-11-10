/**
 * Convierte los sensores del teléfono (ejes del teléfono) a ejes del autobús.
 *
 * El teléfono puede ir en cualquier posición (soporte vertical, acostado, girado),
 * así que sus ejes X/Y/Z no son los del vehículo. Para cada ventana de envío:
 *  - Z (vertical) sale de la gravedad, que se estima con un filtro paso bajo.
 *  - Giro (yaw) = giroscopio proyectado sobre la vertical: no depende de cómo esté puesto.
 *  - Lateral (X) = velocidad GPS × yaw (aceleración centrípeta), que tampoco depende de la posición.
 *  - Longitudinal (Y, frenado/aceleración) = acelerómetro proyectado sobre el eje "adelante",
 *    que se aprende comparando con los cambios de velocidad del GPS. Mientras no se aprende,
 *    se usa la derivada de la velocidad GPS.
 *
 * Se envía el pico de cada ventana, no la última muestra: un frenazo dura ~1 s y a 1 envío
 * por segundo una muestra suelta casi nunca lo captura.
 */

export const STANDARD_GRAVITY = 9.80665;

type Vec = { x: number; y: number; z: number };

export interface MotionWindow {
  /** true cuando hay vertical estable y una forma confiable de medir giros. */
  calibrated: boolean;
  /** Longitudinal en m/s²: negativo = frenado. */
  longitudinal: number;
  /** Lateral en m/s² (centrípeta). */
  lateral: number;
  /** Vertical en m/s² (baches), sin la gravedad. */
  vertical: number;
  /** Giro alrededor de la vertical en rad/s. */
  yawRate: number;
  /** Si el eje "adelante" ya se aprendió con el GPS. */
  forwardLearned: boolean;
}

export type SensorState = 'unavailable' | 'calibrating' | 'ready';

const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const norm = (a: Vec) => Math.sqrt(dot(a, a));
const unit = (a: Vec): Vec => { const n = norm(a); return n > 1e-9 ? scale(a, 1 / n) : { x: 0, y: 0, z: 0 }; };
const zero = (): Vec => ({ x: 0, y: 0, z: 0 });
const round2 = (value: number) => Math.round(value * 100) / 100;
const peak = (current: number, next: number) => (Math.abs(next) > Math.abs(current) ? next : current);

/** Constante de tiempo del filtro de gravedad (s): larga para que un frenazo no se confunda con gravedad. */
const GRAVITY_TAU = 4;
/** Si la lectura se aleja de 1 g, el vehículo está acelerando: la gravedad casi no se actualiza. */
const GRAVITY_GATE = 0.4;
/** Muestras mínimas (≈2 s a 10 Hz) antes de confiar en la vertical. */
const GRAVITY_SETTLE_SAMPLES = 20;
/** Si la vertical cambia más que esto, alguien movió el teléfono: se reaprende "adelante". */
const MOUNT_CHANGE_COS = Math.cos((20 * Math.PI) / 180);
/** Cambios de velocidad GPS que sirven para aprender el eje "adelante". */
const LEARN_MIN_DV = 0.8;
const LEARN_MIN_SPEED = 3;
const LEARN_MIN_EVENTS = 6;
const LEARN_MIN_CONSISTENCY = 0.6;
/** Promedio móvil corto para quitar vibración del motor y baches. */
const SMOOTH = 3;

export class VehicleMotionEstimator {
  private gravity: Vec | null = null;
  private gravitySamples = 0;
  private lastAccelAt = 0;
  private accelSeen = false;
  private gyroSeen = false;

  private recentLinear: Vec[] = [];
  private recentYaw: number[] = [];

  private forward: Vec | null = null;
  private forwardGravity: Vec | null = null;
  private learnSum = zero();
  private learnWeight = 0;
  private learnEvents = 0;

  private intervalSum = zero();
  private intervalCount = 0;
  private lastGps: { speed: number; at: number } | null = null;
  private speedMs = 0;

  private win = { longitudinal: 0, lateral: 0, vertical: 0, yaw: 0 };

  /** Acelerómetro de expo-sensors, en unidades de g. */
  onAccelerometer(sample: Vec, at: number = Date.now()) {
    if (![sample.x, sample.y, sample.z].every(Number.isFinite)) return;
    this.accelSeen = true;
    const raw = scale(sample, STANDARD_GRAVITY);
    const dt = this.lastAccelAt > 0 ? Math.min(0.5, Math.max(0.01, (at - this.lastAccelAt) / 1000)) : 0.1;
    this.lastAccelAt = at;

    if (!this.gravity) {
      // Empieza con la primera lectura, no con "teléfono acostado": así no hay un pico falso al arrancar.
      this.gravity = raw;
    } else {
      const offGravity = Math.abs(norm(raw) - STANDARD_GRAVITY) > GRAVITY_GATE;
      const alpha = (dt / (GRAVITY_TAU + dt)) * (offGravity ? 0.1 : 1);
      this.gravity = add(scale(this.gravity, 1 - alpha), scale(raw, alpha));
    }
    this.gravitySamples += 1;

    const up = unit(this.gravity);
    if (this.forward && this.forwardGravity && dot(up, this.forwardGravity) < MOUNT_CHANGE_COS) {
      this.resetForward();
    }

    const linear = sub(raw, this.gravity);
    const vertical = dot(linear, up);
    const horizontal = sub(linear, scale(up, vertical));
    this.recentLinear.push(horizontal);
    if (this.recentLinear.length > SMOOTH) this.recentLinear.shift();
    this.intervalSum = add(this.intervalSum, horizontal);
    this.intervalCount += 1;

    if (!this.gravityReady()) return;
    this.win.vertical = peak(this.win.vertical, vertical);
    if (this.forward) {
      const smoothed = scale(this.recentLinear.reduce(add, zero()), 1 / this.recentLinear.length);
      this.win.longitudinal = peak(this.win.longitudinal, dot(smoothed, this.forward));
    }
  }

  /** Giroscopio de expo-sensors, en rad/s. */
  onGyroscope(sample: Vec) {
    if (![sample.x, sample.y, sample.z].every(Number.isFinite)) return;
    this.gyroSeen = true;
    if (!this.gravityReady() || !this.gravity) return;
    // El signo depende de la orientación del teléfono; el servidor compara el valor absoluto.
    const yaw = dot(sample, unit(this.gravity));
    this.recentYaw.push(yaw);
    if (this.recentYaw.length > SMOOTH) this.recentYaw.shift();
    const smoothed = this.recentYaw.reduce((s, v) => s + v, 0) / this.recentYaw.length;
    this.win.yaw = peak(this.win.yaw, smoothed);
    this.win.lateral = peak(this.win.lateral, this.speedMs * smoothed);
  }

  /** Velocidad GPS en m/s (ya validada por precisión). */
  onGps(speedMs: number, at: number = Date.now()) {
    if (!Number.isFinite(speedMs) || speedMs < 0) return;
    const previous = this.lastGps;
    this.speedMs = speedMs;
    this.lastGps = { speed: speedMs, at };
    const avgHorizontal = this.intervalCount > 0 ? scale(this.intervalSum, 1 / this.intervalCount) : null;
    this.intervalSum = zero();
    this.intervalCount = 0;
    if (!previous) return;
    const dt = (at - previous.at) / 1000;
    if (dt < 0.5 || dt > 3) return;
    const dv = (speedMs - previous.speed) / dt;
    // Un autobús no cambia de velocidad a más de ~1 g: un salto mayor es un error del GPS.
    if (Math.abs(dv) > STANDARD_GRAVITY) return;
    if (!this.forward) this.win.longitudinal = peak(this.win.longitudinal, dv);

    if (!avgHorizontal || !this.gravity || !this.gravityReady()) return;
    if (Math.abs(dv) < LEARN_MIN_DV || Math.max(speedMs, previous.speed) < LEARN_MIN_SPEED) return;
    const magnitude = norm(avgHorizontal);
    if (magnitude < 0.3) return;
    // Acelerar o frenar marca la dirección "adelante" (o "atrás") en los ejes del teléfono.
    this.learnSum = add(this.learnSum, scale(unit(avgHorizontal), Math.sign(dv)));
    this.learnWeight += 1;
    this.learnEvents += 1;
    if (this.learnEvents >= LEARN_MIN_EVENTS && norm(this.learnSum) / this.learnWeight >= LEARN_MIN_CONSISTENCY) {
      this.forward = unit(this.learnSum);
      this.forwardGravity = unit(this.gravity);
    }
  }

  state(): SensorState {
    if (!this.accelSeen && !this.gyroSeen) return 'unavailable';
    return this.isCalibrated() ? 'ready' : 'calibrating';
  }

  /** Devuelve los picos desde el último envío y empieza una ventana nueva. */
  takeWindow(): MotionWindow {
    const result: MotionWindow = {
      calibrated: this.isCalibrated(),
      longitudinal: round2(this.win.longitudinal),
      lateral: round2(this.win.lateral),
      vertical: round2(this.win.vertical),
      yawRate: round2(this.win.yaw),
      forwardLearned: this.forward !== null,
    };
    this.win = { longitudinal: 0, lateral: 0, vertical: 0, yaw: 0 };
    return result;
  }

  private gravityReady() {
    if (!this.gravity || this.gravitySamples < GRAVITY_SETTLE_SAMPLES) return false;
    const g = norm(this.gravity);
    return g > 8 && g < 11.5;
  }

  /** Vertical estable y GPS con velocidad, más giroscopio para medir giros. */
  private isCalibrated() {
    return this.gravityReady() && this.gyroSeen && this.lastGps !== null;
  }

  private resetForward() {
    this.forward = null;
    this.forwardGravity = null;
    this.learnSum = zero();
    this.learnWeight = 0;
    this.learnEvents = 0;
  }
}
