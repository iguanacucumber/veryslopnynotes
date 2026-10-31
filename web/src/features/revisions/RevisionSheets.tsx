import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../../bridge/client";
import { useApp } from "../../ui/AppContext";
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  Page,
  PageHeading,
  Section,
  SubjectMark,
} from "../../ui/components";
import { IconBook, IconDownload } from "../../ui/icons";
import { useViewNavigate } from "../../ui/viewTransition";
import { MarkdownBody } from "./MarkdownBody";
import {
  revisionDateLabel,
  bodyCarriesSources,
  bodyWithoutSources,
  parseRevisionSheet,
  parseRevisionSheets,
  type RevisionSheet,
} from "./sheets";

type Selected = {
  id: string;
  sheet: RevisionSheet | null;
  loading: boolean;
  error: string | null;
};

export function RevisionSheetsScreen() {
  const { notify, refreshTick } = useApp();
  const navigate = useViewNavigate();
  const [sheets, setSheets] = useState<RevisionSheet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const openSeq = useRef(0);
  const exportSeq = useRef(0);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const restoreId = useRef<string | null>(null);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError(null);
    try {
      const result = await bridge.revisions();
      if (seq !== loadSeq.current) return;
      setSheets(parseRevisionSheets(result.sheets));
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : "Fiches illisibles.");
    } finally {
      // Périmé silencieux via la séquence : rien à nettoyer.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  // Le déclencheur devient « Fermer » à l'ouverture et garde le focus :
  // le retour se fait au même endroit.
  useEffect(() => {
    if (selected) triggers.current.get(selected.id)?.focus();
  }, [selected?.id]);

  useEffect(() => {
    if (selected === null && restoreId.current) {
      const id = restoreId.current;
      restoreId.current = null;
      triggers.current.get(id)?.focus();
    }
  }, [selected]);

  async function open(id: string) {
    const seq = ++openSeq.current;
    setSelected({ id, sheet: null, loading: true, error: null });
    try {
      const result = await bridge.revision(id);
      if (seq !== openSeq.current) return;
      const sheet = parseRevisionSheet(result.sheet);
      if (!sheet) {
        setSelected({ id, sheet: null, loading: false, error: "Fiche introuvable." });
        return;
      }
      setSelected({ id, sheet, loading: false, error: null });
    } catch (e) {
      if (seq !== openSeq.current) return;
      setSelected({
        id,
        sheet: null,
        loading: false,
        error: e instanceof Error ? e.message : "Impossible d'ouvrir cette fiche.",
      });
    }
  }

  function close() {
    openSeq.current += 1;
    restoreId.current = selected?.id ?? null;
    setSelected(null);
  }

  async function exportSheet(id: string) {
    const seq = ++exportSeq.current;
    setExporting(id);
    try {
      const result = await bridge.exportRevision(id);
      if (seq !== exportSeq.current) return;
      if (!result.ok) throw new Error(result.message || "Export PDF impossible.");
      notify("L’export PDF s’ouvre dans une autre application.");
    } catch (e) {
      if (seq !== exportSeq.current) return;
      notify(e instanceof Error ? e.message : "Export PDF impossible.", "error");
    } finally {
      if (seq === exportSeq.current) setExporting(null);
    }
  }

  if (sheets === null && error === null) {
    return (
      <Page>
        <Loading label="Chargement des fiches…" />
      </Page>
    );
  }

  if (error && sheets === null) {
    return (
      <Page>
        <ErrorBox message={error}>
          <button type="button" className="btn btn--small" onClick={() => void load()}>
            Réessayer
          </button>
        </ErrorBox>
      </Page>
    );
  }

  const list = sheets ?? [];
  const hasSheets = list.length > 0;

  return (
    <Page>
      <PageHeading
        eyebrow="Assistant"
        title="Fiches de révision"
        action={
          hasSheets ? (
            <span className="chip">
              {list.length} fiche{list.length > 1 ? "s" : ""}
            </span>
          ) : null
        }
      />

      {error ? <ErrorBox message={error} /> : null}

      {sheets !== null && list.length === 0 ? (
        <EmptyState
          icon={<IconBook size={30} />}
          title="Aucune fiche de révision"
          body="Ouvre un devoir dans Tâches et touche « Fiche de révision » : elle apparaîtra ici."
          action={
            <div className="row" style={{ gap: 8, justifyContent: "center" }}>
              <button type="button" className="btn btn--small" onClick={() => navigate("/tasks")}>
                Voir les devoirs
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => void load()}>
                Actualiser
              </button>
            </div>
          }
        />
      ) : null}

      {hasSheets ? (
        <Section
          title="Toutes les fiches"
          action={
            <button type="button" className="btn btn--small" onClick={() => navigate("/tasks")}>
              Créer une fiche
            </button>
          }
        >
          <div className="list">
            {list.map((sheet) => {
              const opened = selected?.id === sheet.id;
              const bodyId = `sheet-body-${sheet.id}`;
              return (
                <Card key={sheet.id} as="article" className="revision-card">
                  <div className="revision-card__head">
                    <div className="grow">
                      <div className="revision-card__title-row">
                        <SubjectMark subject={sheet.subject} size={12} />
                        <h3 className="revision-card__title">{sheet.title}</h3>
                      </div>
                      <span className="tiny muted">{sheetMeta(sheet)}</span>
                    </div>
                  </div>

                  {!opened ? <p className="revision-card__preview">{previewOf(sheet.body)}</p> : null}

                  <div className="revision-card__actions">
                    <button
                      ref={(element) => {
                        if (element) triggers.current.set(sheet.id, element);
                        else triggers.current.delete(sheet.id);
                      }}
                      type="button"
                      className="btn btn--small revision-card__open"
                      aria-expanded={opened}
                      aria-controls={bodyId}
                      aria-label={`${opened ? "Fermer" : "Ouvrir"} la fiche ${sheet.title}`}
                      onClick={() => (opened ? close() : void open(sheet.id))}
                    >
                      {opened ? "Fermer" : "Ouvrir"}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small revision-card__pdf"
                      disabled={exporting !== null}
                      aria-busy={exporting === sheet.id}
                      aria-label={`Exporter en PDF la fiche ${sheet.title}`}
                      onClick={() => void exportSheet(sheet.id)}
                    >
                      <IconDownload size={16} />
                      {exporting === sheet.id ? "Export…" : "PDF"}
                    </button>
                  </div>

                  {opened ? (
                    <div id={bodyId} role="region" aria-label={`Fiche ${sheet.title}`}>
                      {selected.loading ? <Loading label="Ouverture de la fiche…" /> : null}
                      {selected.error ? (
                        <ErrorBox message={selected.error}>
                          <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => void open(sheet.id)}
                          >
                            Réessayer
                          </button>
                        </ErrorBox>
                      ) : null}
                      {selected.sheet ? <SheetBody sheet={selected.sheet} /> : null}
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </Section>
      ) : null}
    </Page>
  );
}

function sheetMeta(sheet: RevisionSheet): string {
  return [sheet.subject, revisionDateLabel(sheet), sourceLabel(sheet.sources.length)]
    .filter(Boolean)
    .join(" · ");
}

function sourceLabel(count: number): string {
  if (count === 0) return "";
  return `${count} source${count > 1 ? "s" : ""}`;
}

/** Aperçu texte : deux lignes au plus, jamais de balisage ni la bibliographie. */
function previewOf(body: string): string {
  const flat = bodyWithoutSources(body).replace(/\s+/g, " ").trim();
  return flat.length > 180 ? `${flat.slice(0, 179).trimEnd()}…` : flat;
}

/**
 * Corps d'une fiche ouverte. Le corps assemblé porte DÉJÀ le bloc canonique
 * « Sources : » : la liste n'est rendue séparément que si le corps n'en a pas
 * (une fiche du pont antérieure), jamais deux fois.
 */
export function SheetBody({ sheet }: { sheet: RevisionSheet }) {
  return (
    <div className="revision-card__body-wrap">
      <MarkdownBody text={sheet.body} />
      {sheet.sources.length > 0 && !bodyCarriesSources(sheet.body) ? (
        <div>
          <strong className="t-caption">Sources</strong>
          <ul className="revision-card__sources">
            {sheet.sources.map((source, index) => (
              <li key={`${index}-${source}`} className="chip revision-card__source">
                {source}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
