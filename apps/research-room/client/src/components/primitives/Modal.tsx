import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
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
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => {
        dialog.querySelector<HTMLElement>('.modal__body [autofocus], .modal__body input:not([type="hidden"]), .modal__body select, .modal__body textarea, .modal__body button:not(:disabled)')?.focus();
      });
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={`modal ${className}`.trim()}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => returnFocusRef?.current?.focus()}
    >
      <div className="modal__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        <Button type="button" variant="quiet" onClick={onClose} aria-label={closeLabel}>×</Button>
      </div>
      <div className="modal__body">{children}</div>
    </dialog>
  );
}
