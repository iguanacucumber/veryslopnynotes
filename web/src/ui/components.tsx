import type { ReactNode } from "react";
import { subjectColor, tint } from "../lib/format";
import { subjectEmoji } from "../lib/subjectVisual";
import { useApp } from "./AppContext";
import { IconChevronLeft, IconChevronRight, IconWarning } from "./icons";

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`stack ${className}`}>{children}</div>;
}

/** Titre de route dans le corps : même niveau pour Tâches, Vie scolaire, etc. */
export function PageHeading({
  title,
  eyebrow,
  action,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="page-heading__text">
        {eyebrow ? <span className="page-heading__eyebrow">{eyebrow}</span> : null}
        <h2 className="page-heading__title">{title}</h2>
      </div>
      {action ? <div className="page-heading__action">{action}</div> : null}
    </div>
  );
}

/** Semaine précédente / courante / suivante : un seul motif pour Tâches et Cours. */
export function WeekNavigator({
  label,
  detail,
  current,
  onPrevious,
  onNext,
  onToday,
}: {
  label: string;
  detail?: string;
  current: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <Card className="week-nav">
      <div className="week-nav__top">
        <strong className="week-nav__label">{label}</strong>
        {detail ? <span className="week-nav__detail">{detail}</span> : null}
      </div>
      <div className="week-nav__row">
        <button type="button" className="week-nav__arrow" aria-label="Semaine précédente" onClick={onPrevious}>
          <IconChevronLeft />
        </button>
        <button
          type="button"
          className="week-nav__today"
          onClick={onToday}
          disabled={current}
          aria-label="Revenir à la semaine courante"
        >
          Semaine courante
        </button>
        <button type="button" className="week-nav__arrow" aria-label="Semaine suivante" onClick={onNext}>
          <IconChevronRight />
        </button>
      </div>
    </Card>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return (
    <Card className="card--flat">
      <div className="rows">{children}</div>
    </Card>
  );
}

export function ListRow({
  title,
  subtitle,
  onClick,
  leading,
  trailing,
  danger = false,
  ariaLabel,
}: {
  title: string;
  subtitle?: string;
  onClick: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  danger?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={`list-row${danger ? " list-row--danger" : ""}`}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {leading ? <span className="list-row__leading">{leading}</span> : null}
      <span className="grow">
        <span className="list-row__title">{title}</span>
        {subtitle ? <span className="list-row__subtitle">{subtitle}</span> : null}
      </span>
      {trailing === undefined ? <IconChevronRight size={18} /> : trailing}
    </button>
  );
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
        <h2 className="section-title__heading">{title}</h2>
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
          {children ? <div className="error-box__actions">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Pastille de matière : fond teinté + encre dérivée de la même couleur. Une
 * couleur personnalisée (Réglages) passe par le MÊME rendu que le reste de
 * l'app, jamais un aplat avec du texte blanc (#564).
 */
export function SubjectBadge({
  subject,
  color,
  emoji,
  size = 40,
  dark = false,
  className = "",
}: {
  subject: string;
  color?: string;
  emoji?: string;
  size?: number;
  dark?: boolean;
  className?: string;
}) {
  const base = color ?? subjectColor(subject);
  return (
    <span
      className={`subject-avatar ${className}`.trim()}
      aria-hidden="true"
      data-subject-avatar=""
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(10, Math.round(size * 0.32)),
        background: tint(base, dark ? -0.68 : 0.86),
        color: tint(base, dark ? 0.55 : -0.5),
        fontSize: Math.round(size * 0.46),
      }}
    >
      {emoji || subjectEmoji(subject)}
    </span>
  );
}

export function SubjectAvatar({
  subject,
  size = 40,
  dark = false,
  className = "",
}: {
  subject: string;
  size?: number;
  dark?: boolean;
  className?: string;
}) {
  return <SubjectBadge subject={subject} size={size} dark={dark} className={className} />;
}

export function Avatar({ name, size = 40, src }: { name: string; size?: number; src?: string | null }) {
  const { dark } = useApp();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const color = subjectColor(name);
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
        background: src ? "transparent" : tint(color, dark ? -0.68 : 0.86),
        color: src ? undefined : tint(color, dark ? 0.55 : -0.5),
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
