import { useApp } from "../../ui/AppContext";
import { Card, Divider } from "../../ui/components";
import { IconBook, IconChevronRight, IconSparkles } from "../../ui/icons";
import { useViewNavigate } from "../../ui/viewTransition";
import { AiCostReminder } from "../assistant/notices";
import { assistantStatus } from "./model";

export function AssistantOverviewCard({
  configured,
  loading,
}: {
  /** `null` = état non lu (échec du pont), jamais « pas de clé ». */
  configured: boolean | null;
  loading: boolean;
}) {
  const { storageUnavailable } = useApp();
  const navigate = useViewNavigate();
  const status = assistantStatus(configured, storageUnavailable, loading);
  return (
    <Card className="card--flat assistant-overview ai">
      <div className="assistant-overview__head">
        <span className="ai-mark ai-mark--lg" aria-hidden="true">
          <IconSparkles size={22} />
        </span>
        <div className="grow">
          <strong className="assistant-overview__status">{status.title}</strong>
          <p className="assistant-overview__body">{status.body}</p>
          <p className="assistant-overview__body">
            <AiCostReminder />
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
