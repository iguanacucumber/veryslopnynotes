import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../../bridge/client";
import { useApp } from "../../ui/AppContext";
import { Card, EmptyState, ErrorBox, Loading, Page, Section, SubjectAvatar } from "../../ui/components";
import { IconBook, IconDownload } from "../../ui/icons";
import { revisionDateLabel, parseRevisionSheet, parseRevisionSheets, type RevisionSheet } from "./sheets";

type Selected = {
  id: string;
  sheet: RevisionSheet | null;
  loading: boolean;
  error: string | null;
};

export function RevisionSheetsScreen() {
  const { notify, refreshTick, dark } = useApp();
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
      // Rien à nettoyer : la séquence rend le résultat périmé silencieux.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  // Le déclencheur devient « Fermer » à l'ouverture : il porte le focus, et le
  // retour se fait au même endroit à la fermeture (#564, un seul « Fermer »).
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

  return (
    <Page>
      {error ? <ErrorBox message={error} /> : null}

      {sheets && sheets.length === 0 ? (
        <EmptyState
          icon={<IconBook size={30} />}
          title="Aucune fiche de révision"
          body="Une fiche est générée automatiquement à l’annonce d’un DS détecté avec certitude."
          action={
            <button type="button" className="btn btn--small" onClick={() => void load()}>
              Actualiser
            </button>
          }
        />
      ) : null}

      {sheets && sheets.length > 0 ? (
        <Section title="Fiches disponibles" action={<span className="chip">{sheets.length}</span>}>
          <div className="list">
            {sheets.map((sheet) => {
              const opened = selected?.id === sheet.id;
              const bodyId = `sheet-body-${sheet.id}`;
              return (
                <Card key={sheet.id} as="article" className="revision-card">
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="revision-card__head">
                      <SubjectAvatar subject={sheet.subject} size={38} dark={dark} />
                      <div className="grow">
                        <h3 className="t-title" style={{ display: "block", margin: 0 }}>
                          {sheet.title}
                        </h3>
                        <span className="t-caption muted">{sheetMeta(sheet)}</span>
                      </div>
                    </div>
                    <div className="row row--wrap" style={{ gap: 6 }}>
                      <button
                        ref={(element) => {
                          if (element) triggers.current.set(sheet.id, element);
                          else triggers.current.delete(sheet.id);
                        }}
                        type="button"
                        className="btn btn--ghost btn--small"
                        aria-expanded={opened}
                        aria-controls={bodyId}
                        aria-label={`${opened ? "Fermer" : "Ouvrir"} la fiche ${sheet.title}`}
                        onClick={() => (opened ? close() : void open(sheet.id))}
                      >
                        {opened ? "Fermer" : "Ouvrir"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--small"
                        disabled={exporting !== null}
                        aria-label={`Exporter en PDF la fiche ${sheet.title}`}
                        onClick={() => void exportSheet(sheet.id)}
                      >
                        <IconDownload size={16} />
                        {exporting === sheet.id ? "Export…" : "Exporter en PDF"}
                      </button>
                    </div>

                    {opened ? (
                      <div id={bodyId} role="region" aria-label={`Fiche ${sheet.title}`}>
                        {selected.loading ? <Loading label="Ouverture de la fiche…" /> : null}
                        {selected.error ? <ErrorBox message={selected.error} /> : null}
                        {selected.sheet ? <SheetBody sheet={selected.sheet} /> : null}
                      </div>
                    ) : null}
                  </div>
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
  return [sheet.subject, revisionDateLabel(sheet)].filter(Boolean).join(" · ");
}

function SheetBody({ sheet }: { sheet: RevisionSheet }) {
  return (
    <div className="stack" style={{ gap: 10, marginTop: 10 }}>
      {sheetMeta(sheet) ? <span className="t-caption muted">{sheetMeta(sheet)}</span> : null}
      <p
        className="t-body-m"
        style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      >
        {sheet.body}
      </p>
      {sheet.sources.length > 0 ? (
        <div>
          <strong className="t-caption">Sources</strong>
          <ul className="t-caption muted" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {sheet.sources.map((source, index) => (
              <li key={`${index}-${source}`}>{source}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
