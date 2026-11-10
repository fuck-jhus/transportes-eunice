import { AlertTriangle, CircleHelp } from 'lucide-react';
import { Dialog } from './Dialog';

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
  if (!confirmation.isOpen) return null;

  return (
    <Dialog
      role="alertdialog"
      size="sm"
      tone={confirmation.isDanger ? 'danger' : 'default'}
      icon={confirmation.isDanger ? <AlertTriangle size={20} /> : <CircleHelp size={20} />}
      title={confirmation.title}
      description={confirmation.message}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="pill-button is-ghost" onClick={onClose}>
            {confirmation.cancelText}
          </button>
          <button
            type="button"
            autoFocus
            className={`pill-button${confirmation.isDanger ? ' is-danger' : ''}`}
            onClick={() => {
              onClose();
              confirmation.onConfirm();
            }}
          >
            {confirmation.confirmText}
          </button>
        </>
      )}
    />
  );
};
