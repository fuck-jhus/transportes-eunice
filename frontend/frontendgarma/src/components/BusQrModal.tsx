import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { BusFront, Download, Printer, RefreshCw, X } from 'lucide-react';
import { isAxiosError } from 'axios';
import api from '../services/api';

interface BusQr { idAutobus: number; placa: string; codigo: string }

// QR fijo para pegar dentro de la unidad: siempre abre el viaje que el bus tenga en curso.
export function BusQrModal({ idAutobus, placa, onClose }: { idAutobus: number; placa: string; onClose: () => void }) {
  const [qr, setQr] = useState<BusQr | null>(null);
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (rotate: boolean) => {
    try {
      setBusy(true);
      setError('');
      const response = rotate
        ? await api.post<BusQr>(`/autobuses/${idAutobus}/qr/rotar`)
        : await api.get<BusQr>(`/autobuses/${idAutobus}/qr`);
      const link = `${window.location.origin}/bus/${response.data.codigo}`;
      setImage(await QRCode.toDataURL(link, { width: 640, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1e2a24', light: '#ffffff' } }));
      setQr(response.data);
    } catch (requestError: unknown) {
      const apiMessage = isAxiosError<{ mensaje?: string }>(requestError) ? requestError.response?.data?.mensaje : undefined;
      setError(apiMessage || 'No se pudo preparar el código QR.');
    } finally {
      setBusy(false);
    }
  }, [idAutobus]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rotate = () => {
    if (!window.confirm('El QR que ya está pegado en el bus dejará de funcionar y tendrás que imprimir el nuevo. ¿Continuar?')) return;
    void load(true);
  };

  return (
    <div className="qr-backdrop" role="dialog" aria-modal="true" aria-labelledby="bus-qr-title" onClick={onClose}>
      <div className="qr-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="qr-dialog-head">
          <div>
            <span className="auth-kicker">Código para pasajeros</span>
            <h2 id="bus-qr-title">QR de la unidad {placa}</h2>
            <p>Pégalo dentro del bus. Al escanearlo, el pasajero ve el viaje en curso de esta unidad y puede escribir al centro de control.</p>
          </div>
          <button type="button" className="icon-pill" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>

        {error && <div className="auth-alert" role="alert">{error}</div>}

        <div className="qr-sticker" id="qr-sticker">
          <div className="qr-sticker-brand"><span><BusFront size={18} /></span><strong>Transportes Eunice</strong></div>
          <h3>Sigue este bus en vivo</h3>
          <div className="qr-sticker-code">{image ? <img src={image} alt={`Código QR de la unidad ${placa}`} /> : <span className="qr-sticker-wait">Preparando…</span>}</div>
          <p>Escanea con la cámara de tu celular</p>
          <span className="qr-sticker-plate">Unidad {qr?.placa ?? placa}</span>
        </div>

        <footer className="qr-dialog-actions">
          <button type="button" className="pill-button" onClick={() => window.print()} disabled={!image}><Printer size={16} aria-hidden="true" /> Imprimir</button>
          <a className={`pill-button is-ghost${image ? '' : ' is-disabled'}`} href={image || undefined} download={`QR-${placa}.png`} aria-disabled={!image}><Download size={16} aria-hidden="true" /> Descargar imagen</a>
          <button type="button" className="pill-button is-ghost qr-rotate" onClick={rotate} disabled={busy}><RefreshCw size={16} aria-hidden="true" /> Cambiar código</button>
        </footer>
      </div>
    </div>
  );
}
