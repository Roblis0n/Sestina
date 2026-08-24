import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "./Button.js";

interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly className?: string;
  readonly children: ReactNode;
}
export function Modal({ open, title, description, closeLabel, onClose, returnFocusRef, className = "", children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={`modal ${className}`.trim()}
      aria-labelledby={`${title.replace(/\s+/gu, "-").toLowerCase()}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => returnFocusRef?.current?.focus()}
    >
      <div className="modal__header">
        <div>
          <h2 id={`${title.replace(/\s+/gu, "-").toLowerCase()}-title`}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        <Button type="button" variant="quiet" onClick={onClose} aria-label={closeLabel}>×</Button>
      </div>
      <div className="modal__body">{children}</div>
    </dialog>
  );
}
