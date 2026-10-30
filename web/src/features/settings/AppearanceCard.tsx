import { schemeLabel } from "../../lib/schemes";
import { useApp } from "../../ui/AppContext";
import { Card, Divider } from "../../ui/components";
import { SchemePicker } from "./SchemePicker";
import { THEME_OPTIONS, themeLabel } from "./model";

/**
 * Carte Apparence : thème et palette vivent dans `AppContext`, donc rien à
 * charger ni à valider ici — la carte ne fait que les afficher.
 */
export function AppearanceCard() {
  const { theme, setTheme, scheme, setScheme } = useApp();
  return (
    <Card className="card--flat">
      <div className="row row--wrap" role="group" aria-label="Thème de l'application">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`chip${theme === option.value ? " chip--active" : ""}`}
            aria-pressed={theme === option.value}
            onClick={() => setTheme(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="tiny muted" style={{ margin: "8px 0 0" }}>
        Thème actuel : {themeLabel(theme)}.
      </p>

      <Divider />

      <p className="tiny muted" style={{ margin: "10px 0 0" }}>
        Palette
      </p>
      <SchemePicker value={scheme} onChange={setScheme} />
      <p className="tiny muted" style={{ margin: "8px 0 0" }}>
        Palette actuelle : {schemeLabel(scheme)} — chaque palette a sa variante claire et sombre.
      </p>
    </Card>
  );
}
