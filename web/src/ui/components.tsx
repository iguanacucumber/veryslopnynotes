import type { ReactNode } from "react";
import { IconWarning } from "./icons";

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`stack ${className}`}>{children}</div>;
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="section-title">
        <h2 className="t-title" style={{ margin: 0 }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({
  children,
  className = "",
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "button";
}) {
  if (as === "button") {
    return (
      <button type="button" className={`card ${className}`} style={{ textAlign: "left", width: "100%" }}>
        {children}
      </button>
    );
  }
  if (as === "article") return <article className={`card ${className}`}>{children}</article>;
  return <div className={`card ${className}`}>{children}</div>;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? (
        <span className="empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <strong className="t-title">{title}</strong>
      {body ? <span className="t-body-m">{body}</span> : null}
      {action}
    </div>
  );
}

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="empty" role="status" aria-live="polite">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function StaleBadge({ label = "hors-ligne" }: { label?: string }) {
  return <span className="stale">{label}</span>;
}

export function ErrorBox({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="card card--danger" role="alert">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <span style={{ color: "var(--danger-ink)" }}>
          <IconWarning />
        </span>
        <div className="grow">
          <strong>Impossible d’afficher cette donnée</strong>
          <p className="t-body-m muted" style={{ margin: "4px 0 0" }}>
            {message}
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Avatar({ name, size = 40, src }: { name: string; size?: number; src?: string | null }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: src ? "transparent" : "var(--brand-pale)",
        color: "var(--brand-deep)",
        fontWeight: 700,
        fontSize: size * 0.34,
        overflow: "hidden",
        flex: "0 0 auto",
      }}
    >
      {src ? <img src={src} alt="" width={size} height={size} style={{ objectFit: "cover" }} /> : initials || "?"}
    </span>
  );
}

export function Divider() {
  return <div className="divider" role="presentation" />;
}
