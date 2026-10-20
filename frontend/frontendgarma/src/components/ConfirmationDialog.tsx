import { useEffect } from 'react';
import { AlertTriangle, CircleHelp } from 'lucide-react';

export interface ConfirmationState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  isDanger: boolean;
  onConfirm: () => void;
}

interface ConfirmationDialogProps {
  confirmation: ConfirmationState;
  onClose: () => void;
}

export const ConfirmationDialog = ({ confirmation, onClose }: ConfirmationDialogProps) => {
  useEffect(() => {
    if (!confirmation.isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [confirmation.isOpen, onClose]);

  if (!confirmation.isOpen) return null;

  const accent = confirmation.isDanger ? 'var(--danger)' : 'var(--accent)';
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(4, 18, 24, 0.66)',
        backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center',
        alignItems: 'center', zIndex: 100000, padding: '20px'
      }}
    >
      <section
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-message"
        style={{
          backgroundColor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '16px',
          padding: '28px', maxWidth: '440px', width: '100%',
          boxShadow: 'var(--shadow-modal)', display: 'flex',
          flexDirection: 'column', gap: '20px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div aria-hidden="true" style={{
            width: '42px', height: '42px', borderRadius: '12px',
            backgroundColor: confirmation.isDanger ? 'rgba(239, 68, 68, 0.12)' : 'var(--accent-soft)',
            border: `1px solid ${confirmation.isDanger ? 'rgba(239, 68, 68, 0.3)' : 'var(--accent-line)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: accent
          }}>{confirmation.isDanger ? <AlertTriangle size={20} /> : <CircleHelp size={20} />}</div>
          <h3 id="confirmation-title" style={{ margin: 0, color: 'var(--ink)', fontSize: '1.18rem', fontWeight: 750 }}>
            {confirmation.title}
          </h3>
        </div>

        <p id="confirmation-message" style={{ margin: 0, color: 'var(--muted)', fontSize: '0.92rem', lineHeight: '1.6' }}>
          {confirmation.message}
        </p>

        <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
          <button type="button" onClick={onClose} style={{
            backgroundColor: 'var(--surface-soft)', border: '1px solid var(--line)', borderRadius: '9px',
            color: 'var(--ink)', padding: '9px 18px', fontSize: '0.88rem', fontWeight: 600,
            cursor: 'pointer'
          }}>
            {confirmation.cancelText}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              onClose();
              confirmation.onConfirm();
            }}
            style={{
              backgroundColor: accent, border: 'none', borderRadius: '9px', color: '#ffffff',
              padding: '9px 20px', fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer',
              boxShadow: confirmation.isDanger ? '0 8px 20px rgba(201, 76, 76, 0.2)' : '0 8px 20px var(--accent-shadow)'
            }}
          >
            {confirmation.confirmText}
          </button>
        </div>
      </section>
    </div>
  );
};
