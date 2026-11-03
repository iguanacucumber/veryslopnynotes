import { useId, type ReactNode } from "react";
import { Card } from "../../ui/components";
import { IconChevronRight } from "../../ui/icons";

/** Réglages de niche : repliés tant que l'élève n'a pas demandé à les voir. */
export function AdvancedSection({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = useId();
  return (
    <section id="reglages-avance" className="settings-advanced">
      <button
        type="button"
        className="settings-advanced__toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
      >
        <span className="grow">
          <strong className="settings-advanced__label">Avancé</strong>
          <span className="settings-advanced__detail">Serveur de manuels, auto-hébergement</span>
        </span>
        <IconChevronRight
          size={18}
          className={`settings-advanced__chevron${open ? " settings-advanced__chevron--open" : ""}`}
        />
      </button>
      {open ? (
        <div id={panelId} className="settings-advanced__panel">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Le serveur est celui de l'utilisateur : les risques sont dits avant le champ. */
export function SelfHostingNotice() {
  return (
    <Card className="card--flat">
      <strong style={{ display: "block" }}>Scraper auto-hébergé (facultatif)</strong>
      <p className="tiny muted" style={{ margin: "2px 0 0" }}>
        Le serveur tourne chez toi et voit les adresses de manuels demandées. Limite son accès,
        tiens-le à jour et respecte les conditions des sites. Aucune donnée scolaire ne passe par
        lui, et l’application reste utilisable sans serveur.
      </p>
    </Card>
  );
}
