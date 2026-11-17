/** Límite que usa el servidor por defecto (Alertas:VelocidadMaximaKmh). */
export const SPEED_LIMIT_KMH = 80;
/** Por debajo de esto la alerta se apaga; evita que parpadee al rondar el límite. */
export const SPEED_ALERT_RESET_KMH = 75;
/** Lecturas seguidas sobre el límite antes de avisar (descarta un salto suelto del GPS). */
export const SPEED_ALERT_CONFIRM_READINGS = 2;
/** Mientras siga excedido, se repite la notificación cada este tiempo. */
export const SPEED_ALERT_REPEAT_MS = 60_000;

export interface SpeedAlertState {
  active: boolean;
  speedKmh: number;
  peakKmh: number;
  overReadings: number;
  lastNotifiedAt: number | null;
}

export const initialSpeedAlert: SpeedAlertState = { active: false, speedKmh: 0, peakKmh: 0, overReadings: 0, lastNotifiedAt: null };

/**
 * Avanza la alerta con una lectura nueva. `notify` indica si hay que vibrar y mostrar
 * la notificación (al empezar el exceso y luego cada minuto mientras continúe).
 */
export const nextSpeedAlert = (
  previous: SpeedAlertState,
  reading: { speedKmh: number; fresh: boolean; enabled: boolean; now: number },
  limitKmh = SPEED_LIMIT_KMH,
): { state: SpeedAlertState; notify: boolean } => {
  const speed = Math.max(0, Math.round(reading.speedKmh));
  if (!reading.enabled || !reading.fresh) return { state: initialSpeedAlert, notify: false };
  if (!previous.active) {
    const overReadings = speed > limitKmh ? previous.overReadings + 1 : 0;
    if (overReadings < SPEED_ALERT_CONFIRM_READINGS) return { state: { ...initialSpeedAlert, speedKmh: speed, overReadings }, notify: false };
    return { state: { active: true, speedKmh: speed, peakKmh: speed, overReadings, lastNotifiedAt: reading.now }, notify: true };
  }
  if (speed < SPEED_ALERT_RESET_KMH) return { state: { ...initialSpeedAlert, speedKmh: speed }, notify: false };
  const repeat = speed > limitKmh && (previous.lastNotifiedAt == null || reading.now - previous.lastNotifiedAt >= SPEED_ALERT_REPEAT_MS);
  return {
    state: { ...previous, speedKmh: speed, peakKmh: Math.max(previous.peakKmh, speed), lastNotifiedAt: repeat ? reading.now : previous.lastNotifiedAt },
    notify: repeat,
  };
};
