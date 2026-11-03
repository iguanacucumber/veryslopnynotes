import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { registerDialog } from "./dialogStack";
import { IconClose } from "./icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Le dialogue vit hors de `#root` : rendre la racine inerte ne le coupe donc
// pas. Le compteur garde l'inertie tant qu'un dialogue empilé reste ouvert.
let openDialogs = 0;
let rootState: { inert: boolean; hidden: string | null } | null = null;

function inertApp(): void {
  openDialogs += 1;
  if (openDialogs > 1) return;
  const root = document.getElementById("root");
  if (!root) return;
  rootState = { inert: root.inert, hidden: root.getAttribute("aria-hidden") };
  root.inert = true;
  root.setAttribute("aria-hidden", "true");
}

function freeApp(): void {
  openDialogs = Math.max(0, openDialogs - 1);
  if (openDialogs > 0) return;
  const root = document.getElementById("root");
  if (root && rootState) {
    root.inert = rootState.inert;
    if (rootState.hidden === null) root.removeAttribute("aria-hidden");
    else root.setAttribute("aria-hidden", rootState.hidden);
  }
  rootState = null;
}

/** Dialogue modal partagé : portail vers `document.body`, app inerte derrière. */
export function Dialog({
  open,
  title,
  description,
  icon,
  children,
  actions,
  busy = false,
  role = "dialog",
  className,
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
  className?: string;
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

  // Le retour matériel ferme le dialogue du dessus, jamais deux à la fois.
  // Un dialogue occupé (enregistrement en cours) reste ouvert, comme Échap.
  useEffect(() => {
    if (!open) return;
    return registerDialog(() => {
      if (!busyRef.current) closeRef.current();
    });
  }, [open]);

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
    inertApp();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      freeApp();
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

  return createPortal(
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={className ? `dialog ${className}` : "dialog"}
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
        {actions ? <div className="dialog__actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
