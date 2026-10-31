import { paletteOf, SCHEMES } from "../../lib/schemes";
import { useApp } from "../../ui/AppContext";
import { IconCheck } from "../../ui/icons";

/** L'aperçu vient de la même table que les variables CSS : il montre ce que l'écran affichera. */
export function SchemePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { dark } = useApp();
  return (
    <div className="scheme-grid" role="radiogroup" aria-label="Palette de couleurs">
      {SCHEMES.map((scheme) => {
        const palette = paletteOf(scheme.id, dark);
        const active = scheme.id === value;
        return (
          <button
            key={scheme.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`scheme-card${active ? " scheme-card--active" : ""}`}
            onClick={() => onChange(scheme.id)}
          >
            <span
              className="scheme-card__preview"
              aria-hidden="true"
              style={{
                background: palette.page,
                border: `1px solid ${palette.surfaceContainer}`,
              }}
            >
              <span
                className="scheme-card__sheet"
                style={{
                  background: palette.surface,
                  border: `1px solid ${palette.surfaceContainer}`,
                }}
              >
                <span className="scheme-card__dot" style={{ background: palette.brand }} />
                <span className="scheme-card__rows">
                  <span className="scheme-card__row" style={{ background: palette.ink }} />
                  <span className="scheme-card__row scheme-card__row--thin" style={{ background: palette.ink }} />
                </span>
              </span>
            </span>
            <span className="scheme-card__text">
              <span className="scheme-card__label">{scheme.label}</span>
              {active ? (
                <span className="scheme-card__check" aria-hidden="true">
                  <IconCheck size={14} />
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
