import { useEffect, useState } from 'react';
import { BusFront, Clock3, ShieldCheck } from 'lucide-react';
import { isAxiosError } from 'axios';
import api from '../services/api';

interface PublicBus { placa: string; viajeActivo: boolean; token?: string | null }

// Lo que abre el QR pegado en el bus: lleva directo al viaje en curso de esa unidad.
export const PublicBusPage = ({ code }: { code: string }) => {
  const [bus, setBus] = useState<PublicBus | null>(null);
  const [error, setError] = useState('');
  const [isDark] = useState(() => { try { return localStorage.getItem('eunice-public-theme') !== 'light'; } catch { return true; } });

  useEffect(() => {
    let active = true;
    api.get<PublicBus>(`/public/buses/${encodeURIComponent(code)}`)
      .then((response) => {
        if (!active) return;
        if (response.data.viajeActivo && response.data.token) window.location.replace(`/viaje/${response.data.token}`);
        else setBus(response.data);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        const status = isAxiosError(requestError) ? requestError.response?.status : undefined;
        setError(status === 404 ? 'Este código no corresponde a ninguna unidad de Transportes Eunice.' : 'No pudimos conectar. Revisa tu conexión y vuelve a escanear el código.');
      });
    return () => { active = false; };
  }, [code]);

  if (error) {
    return <main className={`public-trip-page ${isDark ? 'dark-theme' : ''}`}><section className="public-trip-error"><ShieldCheck size={34} /><h1>Código no disponible</h1><p>{error}</p></section></main>;
  }
  if (!bus) {
    return <main className={`public-trip-page ${isDark ? 'dark-theme' : ''}`}><div className="public-trip-loading"><BusFront size={30} /><span>Buscando el viaje de esta unidad</span></div></main>;
  }
  return (
    <main className={`public-trip-page ${isDark ? 'dark-theme' : ''}`}>
      <section className="public-trip-error">
        <Clock3 size={34} />
        <h1>La unidad {bus.placa} no está en ruta</h1>
        <p>Cuando el bus inicie su viaje, vuelve a escanear este código para verlo en el mapa y escribir al centro de control.</p>
      </section>
    </main>
  );
};
