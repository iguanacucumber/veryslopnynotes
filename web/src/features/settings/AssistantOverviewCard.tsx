import { useApp } from "../../ui/AppContext";
import { Card, Divider } from "../../ui/components";
import { IconBook, IconSparkles } from "../../ui/icons";
import { useViewNavigate } from "../../ui/viewTransition";

export function AssistantOverviewCard({ configured }: { configured: boolean }) {
  const { storageUnavailable } = useApp();
  const navigate = useViewNavigate();
  return (
    <Card className="card--flat">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <span className="settings-assistant__icon" aria-hidden="true">
          <IconSparkles size={20} />
        </span>
        <div className="grow">
          <strong style={{ display: "block" }}>{configured ? "Assistant actif" : "Aucune clé"}</strong>
          <p className="tiny muted" style={{ margin: "2px 0 0" }}>
            {configured
              ? storageUnavailable
                ? "Clé en mémoire seulement : elle sera oubliée à la fermeture de l'app."
                : "Clé enregistrée (chiffrée) : l’aide devoirs et les fiches de révision sont disponibles."
              : "Sans clé OpenRouter, l’assistant ne peut ni aider sur un devoir ni générer une fiche."}
          </p>
        </div>
      </div>

      <Divider />

      <p className="tiny muted" style={{ margin: "10px 0 6px" }}>
        Sources de l’assistant
      </p>
      <div className="row row--wrap">
        <button type="button" className="btn btn--ghost btn--small" onClick={() => navigate("/course-notes")}>
          <IconBook size={16} />
          Cahier de cours
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => navigate("/revision-sheets")}>
          <IconSparkles size={16} />
          Fiches de révision
        </button>
      </div>
    </Card>
  );
}
