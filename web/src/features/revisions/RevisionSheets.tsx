import { useCallback, useEffect, useState } from "react";
import { bridge } from "../../bridge/client";
import { useApp } from "../../ui/AppContext";
import { Card, EmptyState, ErrorBox, Loading, Page, Section } from "../../ui/components";
import { IconBook, IconClose, IconDownload } from "../../ui/icons";
import { revisionDateLabel, parseRevisionSheet, parseRevisionSheets, type RevisionSheet } from "./sheets";

type Selected = {
  sheet: RevisionSheet | null;
  loading: boolean;
  error: string | null;
};

export function RevisionSheetsScreen() {
  const { notify, refreshTick } = useApp();
  const [sheets, setSheets] = useState<RevisionSheet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await bridge.revisions();
      setSheets(parseRevisionSheets(result.sheets));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fiches illisibles.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  async function open(id: string) {
    setSelected({ sheet: null, loading: true, error: null });
    try {
      const result = await bridge.revision(id);
      const sheet = parseRevisionSheet(result.sheet);
      if (!sheet) {
        setSelected({ sheet: null, loading: false, error: "Fiche introuvable." });
        return;
      }
      setSelected({ sheet, loading: false, error: null });
    } catch (e) {
      setSelected({
        sheet: null,
        loading: false,
        error: e instanceof Error ? e.message : "Impossible d'ouvrir cette fiche.",
      });
    }
  }

  async function exportSheet(id: string) {
    setExporting(id);
    try {
      const result = await bridge.exportRevision(id);
      if (!result.ok) throw new Error(result.message || "Export PDF impossible.");
      notify("L’export PDF s’ouvre dans une autre application.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Export PDF impossible.", "error");
    } finally {
      setExporting(null);
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
          <button type="button" className="btn btn--ghost btn--small" onClick={() => void load()}>
            Réessayer
          </button>
        </ErrorBox>
      </Page>
    );
  }

  return (
    <Page>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => void load()}>
          Actualiser
        </button>
      </div>

      {error ? <ErrorBox message={error} /> : null}

      {selected ? (
        <Card as="article">
          <div className="row row--between" style={{ alignItems: "flex-start" }}>
            <strong className="t-title">
              {selected.loading ? "Ouverture…" : selected.sheet?.title || "Fiche de révision"}
            </strong>
            <button
              type="button"
              className="icon-btn"
              aria-label="Fermer la fiche"
              onClick={() => setSelected(null)}
            >
              <IconClose />
            </button>
          </div>
          {selected.loading ? <Loading label="Ouverture de la fiche…" /> : null}
          {selected.error ? <ErrorBox message={selected.error} /> : null}
          {selected.sheet ? <SheetBody sheet={selected.sheet} /> : null}
        </Card>
      ) : null}

      {sheets && sheets.length === 0 ? (
        <EmptyState
          icon={<IconBook size={32} />}
          title="Aucune fiche de révision"
          body="Une fiche est générée automatiquement à l’annonce d’un DS détecté avec certitude."
          action={
            <button type="button" className="btn btn--ghost btn--small" onClick={() => void load()}>
              Actualiser
            </button>
          }
        />
      ) : null}

      {sheets && sheets.length > 0 ? (
        <Section title="Fiches disponibles" action={<span className="chip">{sheets.length}</span>}>
          <div className="list">
            {sheets.map((sheet) => (
              <Card key={sheet.id} as="article">
                <div className="stack" style={{ gap: 8 }}>
                  <div>
                    <strong className="t-title" style={{ display: "block" }}>
                      {sheet.title}
                    </strong>
                    <span className="t-caption muted">{sheetMeta(sheet)}</span>
                  </div>
                  <div className="row row--wrap" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      aria-label={`Ouvrir la fiche ${sheet.title}`}
                      onClick={() => void open(sheet.id)}
                    >
                      Ouvrir
                    </button>
                    <button
                      type="button"
                      className="btn btn--small"
                      disabled={exporting === sheet.id}
                      aria-label={`Exporter en PDF la fiche ${sheet.title}`}
                      onClick={() => void exportSheet(sheet.id)}
                    >
                      <IconDownload size={16} />
                      {exporting === sheet.id ? "Export…" : "Exporter en PDF"}
                    </button>
                  </div>
                </div>
              </Card>
            ))}
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
