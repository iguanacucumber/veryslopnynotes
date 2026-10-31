import { useApp } from "../../ui/AppContext";
import { Card, Divider } from "../../ui/components";
import { IconBook, IconChevronRight, IconSparkles } from "../../ui/icons";
import { useViewNavigate } from "../../ui/viewTransition";

export function AssistantOverviewCard({ configured }: { configured: boolean }) {
  const { storageUnavailable } = useApp();
  const navigate = useViewNavigate();
  return (
    <Card className="card--flat assistant-overview ai">
      <div className="assistant-overview__head">
        <span className="ai-mark ai-mark--lg" aria-hidden="true">
          <IconSparkles size={22} />
        </span>
        <div className="grow">
          <strong className="assistant-overview__status">
            {configured ? "Assistant actif" : "Aucune clé"}
          </strong>
          <p className="assistant-overview__body">
            {configured
              ? storageUnavailable
                ? "Clé en mémoire seulement : elle sera oubliée à la fermeture de l'app."
                : "Clé enregistrée (chiffrée) : l’aide devoirs et les fiches de révision sont disponibles."
              : "Sans clé OpenRouter, l’assistant ne peut ni aider sur un devoir ni générer une fiche."}
          </p>
        </div>
      </div>

      <Divider />

      <p className="assistant-overview__label">Sources de l’assistant</p>
      <div className="assistant-overview__links">
        <button
          type="button"
          className="assistant-link"
          onClick={() => navigate("/course-notes")}
        >
          <span className="assistant-link__icon" aria-hidden="true">
            <IconBook size={17} />
          </span>
          <span className="grow">
            <strong>Cahier de cours</strong>
            <span className="tiny muted">La mémoire de tes matières</span>
          </span>
          <IconChevronRight size={16} />
        </button>
        <button
          type="button"
          className="assistant-link"
          onClick={() => navigate("/revision-sheets")}
        >
          <span className="assistant-link__icon" aria-hidden="true">
            <IconSparkles size={17} />
          </span>
          <span className="grow">
            <strong>Fiches de révision</strong>
            <span className="tiny muted">Générées depuis un devoir</span>
          </span>
          <IconChevronRight size={16} />
        </button>
      </div>
    </Card>
  );
}
