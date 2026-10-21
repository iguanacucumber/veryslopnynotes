import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { IconClose } from "./icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialogue modal partagé (#564) : même overlay, mêmes gestes, même focus que
 * la suppression d'une discussion ou la déconnexion. Le panneau vit dans le
 * document (pas de portail) : l'overlay est `position: fixed`, aucun ancêtre
 * de l'app ne crée de containing block.
 */
export function Dialog({
  open,
  title,
  description,
  icon,
  children,
  actions,
  busy = false,
  role = "dialog",
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  busy?: boolean;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
    target?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null,
    );
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? bodyId : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="dialog__head">
          {icon ? (
            <span className="dialog__icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fermer"
            disabled={busy}
            onClick={onClose}
          >
            <IconClose size={18} />
          </button>
        </div>
        {description ? (
          <p className="dialog__body" id={bodyId}>
            {description}
          </p>
        ) : null}
        {children}
        <div className="dialog__actions">{actions}</div>
      </div>
    </div>
  );
}
