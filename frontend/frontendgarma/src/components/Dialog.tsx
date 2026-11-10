import { useEffect, useId } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  title: ReactNode;
  kicker?: string;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  role?: 'dialog' | 'alertdialog';
  onClose: () => void;
  /** Evita cerrar con Escape o clic fuera mientras se guarda. */
  busy?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}

/** Diálogo único del panel: encabezado con icono, cuerpo y pie de acciones. */
export const Dialog = ({
  title, kicker, description, icon, tone = 'default', size = 'md', role = 'dialog',
  onClose, busy = false, children, footer,
}: DialogProps) => {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div
      className="dlg-backdrop modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className={`dlg dlg-${size}${tone === 'danger' ? ' is-danger' : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="dlg-head">
          {icon && <span className="dlg-icon" aria-hidden="true">{icon}</span>}
          <div className="dlg-heading">
            {kicker && <span className="dlg-kicker">{kicker}</span>}
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button type="button" className="dlg-close" onClick={onClose} disabled={busy} aria-label="Cerrar">
            <X size={18} />
          </button>
        </header>
        {children && <div className="dlg-body">{children}</div>}
        {footer && <footer className="dlg-foot">{footer}</footer>}
      </section>
    </div>
  );
};

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  wide?: boolean;
}

export const Field = ({ label, hint, htmlFor, children, wide }: FieldProps) => (
  <div className={`dlg-field${wide ? ' is-wide' : ''}`}>
    <label htmlFor={htmlFor}>{label}</label>
    {children}
    {hint && <small>{hint}</small>}
  </div>
);
