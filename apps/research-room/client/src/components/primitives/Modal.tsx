import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
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
export function Modal({
  open,
  title,
  description,
  closeLabel,
  onClose,
  returnFocusRef,
  className = "",
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      const frame = window.requestAnimationFrame(() => {
        if (dialog.open)
          dialog
            .querySelector<HTMLElement>(
              '.modal__body [autofocus], .modal__body input:not([type="hidden"]), .modal__body select, .modal__body textarea, .modal__body button:not(:disabled)',
            )
            ?.focus();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }
    if (!open && dialog.open) dialog.close();
    return undefined;
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
      onClose={() => {
        if (!dialogRef.current?.open)
          (returnFocusRef?.current ?? opener.current)?.focus();
      }}
    >
      <div className="modal__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        <Button
          type="button"
          variant="quiet"
          onClick={onClose}
          aria-label={closeLabel}
        >
          ×
        </Button>
      </div>
      <div className="modal__body">{children}</div>
    </dialog>
  );
}
