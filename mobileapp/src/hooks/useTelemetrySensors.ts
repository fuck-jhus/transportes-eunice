import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { SensorReading } from '../types/telemetry';

export const useTelemetrySensors = (useRealHardware: boolean) => {
  const [reading, setReading] = useState<SensorReading>({
    speed: 0,
    accelX: 0,
    accelY: 0,
    accelZ: 9.8,
    gyroX: 0,
    gyroY: 0,
    gyroZ: 0,
    lat: 14.8347,
    lng: -91.5181
  });

  const [hasPermissions, setHasPermissions] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const gpsSpeedRef = useRef<number>(0);

  // 1. Iniciar Sensores Inerciales (Acelerómetro y Giroscopio) de inmediato a 100ms
  useEffect(() => {
    if (!useRealHardware) return;

    if (Platform.OS === 'web') {
      const handleMotion = (event: DeviceMotionEvent) => {
        const acc = event.acceleration || event.accelerationIncludingGravity;
        if (acc) {
          setReading((prev) => ({
            ...prev,
            accelX: Number((acc.x || 0).toFixed(2)),
            accelY: Number((acc.y || 0).toFixed(2)),
            accelZ: Number((acc.z || 0).toFixed(2)),
          }));
        }
        const rot = event.rotationRate;
        if (rot) {
          setReading((prev) => ({
            ...prev,
            gyroX: Number((rot.beta || 0).toFixed(2)),
            gyroY: Number((rot.gamma || 0).toFixed(2)),
            gyroZ: Number((rot.alpha || 0).toFixed(2)),
          }));
        }
      };

      window.addEventListener('devicemotion', handleMotion);
      return () => {
        window.removeEventListener('devicemotion', handleMotion);
      };
    } else {
      let accelSub: any = null;
      let gyroSub: any = null;

      try {
        if (typeof Accelerometer.setUpdateInterval === 'function') {
          Accelerometer.setUpdateInterval(100);
        }
        accelSub = Accelerometer.addListener((accelData) => {
          setReading((prev) => ({
            ...prev,
            accelX: Number((accelData.x * 9.81).toFixed(2)),
            accelY: Number((accelData.y * 9.81).toFixed(2)),
            accelZ: Number((accelData.z * 9.81).toFixed(2)),
          }));
        });
      } catch (e) {
        console.warn('Accelerometer listener error:', e);
      }

      try {
        if (typeof Gyroscope.setUpdateInterval === 'function') {
          Gyroscope.setUpdateInterval(100);
        }
        gyroSub = Gyroscope.addListener((gyroData) => {
          setReading((prev) => ({
            ...prev,
            gyroX: Number(gyroData.x.toFixed(2)),
            gyroY: Number(gyroData.y.toFixed(2)),
            gyroZ: Number(gyroData.z.toFixed(2)),
          }));
        });
      } catch (e) {
        console.warn('Gyroscope listener error:', e);
      }

      return () => {
        accelSub && accelSub.remove && accelSub.remove();
        gyroSub && gyroSub.remove && gyroSub.remove();
      };
    }
  }, [useRealHardware]);

  // 2. Iniciar GPS Satelital (Velocidad satelital 100% real en km/h y Coordenadas)
  useEffect(() => {
    if (!useRealHardware) return;

    if (Platform.OS === 'web') {
      let watchId: number | null = null;
      if ('geolocation' in navigator) {
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const speedKmh = pos.coords.speed && pos.coords.speed > 0 ? Math.round(pos.coords.speed * 3.6) : 0;
            gpsSpeedRef.current = speedKmh;
            setReading((prev) => ({
              ...prev,
              lat: Number(pos.coords.latitude.toFixed(6)),
              lng: Number(pos.coords.longitude.toFixed(6)),
              speed: speedKmh,
            }));
          },
          (err) => console.warn('Error GPS Web:', err),
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      }
      return () => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      };
    } else {
      let locationSub: Location.LocationSubscription | null = null;
      let isCancelled = false;

      (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            setHasPermissions(true);

            // Bloqueo instantáneo con última posición conocida
            try {
              const lastKnown = await Location.getLastKnownPositionAsync({});
              if (lastKnown && lastKnown.coords && !isCancelled) {
                const spd = lastKnown.coords.speed && lastKnown.coords.speed > 0 ? Math.round(lastKnown.coords.speed * 3.6) : 0;
                gpsSpeedRef.current = spd;
                setReading((prev) => ({
                  ...prev,
                  lat: Number(lastKnown.coords.latitude.toFixed(6)),
                  lng: Number(lastKnown.coords.longitude.toFixed(6)),
                  speed: spd,
                }));
              }
            } catch (e) {}

            // Bloqueo inmediato de alta precisión
            try {
              const current = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.BestForNavigation,
              });
              if (current && current.coords && !isCancelled) {
                const spd = current.coords.speed && current.coords.speed > 0 ? Math.round(current.coords.speed * 3.6) : 0;
                gpsSpeedRef.current = spd;
                setReading((prev) => ({
                  ...prev,
                  lat: Number(current.coords.latitude.toFixed(6)),
                  lng: Number(current.coords.longitude.toFixed(6)),
                  speed: spd,
                }));
              }
            } catch (e) {}

            // Seguimiento satelital continuo
            locationSub = await Location.watchPositionAsync(
              {
                accuracy: Location.Accuracy.BestForNavigation,
                timeInterval: 1000,
                distanceInterval: 0,
              },
              (loc) => {
                if (loc && loc.coords && !isCancelled) {
                  const speedKmh = loc.coords.speed && loc.coords.speed > 0 ? Math.round(loc.coords.speed * 3.6) : 0;
                  gpsSpeedRef.current = speedKmh;
                  setReading((prev) => ({
                    ...prev,
                    lat: Number(loc.coords.latitude.toFixed(6)),
                    lng: Number(loc.coords.longitude.toFixed(6)),
                    speed: speedKmh,
                  }));
                }
              }
            );
          } else {
            setErrorMsg('Permiso de ubicación denegado por el usuario.');
            setHasPermissions(false);
          }
        } catch (e) {
          console.warn('Fallo al iniciar watchPositionAsync:', e);
        }
      })();

      return () => {
        isCancelled = true;
        locationSub && locationSub.remove && locationSub.remove();
      };
    }
  }, [useRealHardware]);

  // 3. Modo Simulación (Cuando no se usa hardware real)
  useEffect(() => {
    if (useRealHardware) return;

    const interval = setInterval(() => {
      setReading({
        speed: Math.floor(Math.random() * 40) + 40,
        accelX: Number((Math.random() * 2 - 1).toFixed(2)),
        accelY: Number((Math.random() * 2 - 1).toFixed(2)),
        accelZ: Number((9.8 + (Math.random() * 0.4 - 0.2)).toFixed(2)),
        gyroX: Number((Math.random() * 0.4 - 0.2).toFixed(2)),
        gyroY: Number((Math.random() * 0.4 - 0.2).toFixed(2)),
        gyroZ: Number((Math.random() * 0.4 - 0.2).toFixed(2)),
        lat: Number((14.8347 + (Math.random() * 0.0002 - 0.0001)).toFixed(6)),
        lng: Number((-91.5181 + (Math.random() * 0.0002 - 0.0001)).toFixed(6)),
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [useRealHardware]);

  return { reading, setReading, errorMsg, hasPermissions };
};
