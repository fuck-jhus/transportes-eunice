import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastNotification {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastViewportProps {
  notifications: ToastNotification[];
  onDismiss: (id: number) => void;
}

const ToastItem = ({ toast, onDismiss }: { toast: ToastNotification; onDismiss: (id: number) => void }) => {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 4400);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.id]);

  const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'info' ? Info : AlertCircle;

  return (
    <article className={`app-toast app-toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <span className="app-toast-icon" aria-hidden="true"><Icon size={18} /></span>
      <p>{toast.message}</p>
      <button type="button" aria-label="Cerrar notificación" onClick={() => onDismiss(toast.id)}>
        <X size={16} />
      </button>
    </article>
  );
};

export const ToastViewport = ({ notifications, onDismiss }: ToastViewportProps) => (
  <div className="toast-viewport" aria-live="polite" aria-atomic="false">
    {notifications.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />)}
  </div>
);
