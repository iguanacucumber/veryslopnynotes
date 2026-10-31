import { useEffect, useState } from "react";
import { bridge } from "../../bridge/client";
import type { SubjectPref } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { Card, Divider, ListRow, SubjectBadge } from "../../ui/components";
import { SubjectEditor } from "./SubjectEditor";
import { actionMessage } from "./action";
import { sanitizeSubjectPrefs, subjectNameError, subjectSaveRefusal } from "./model";

function subjectInitial(subject: string): string {
  return subject.trim().charAt(0).toUpperCase() || "?";
}

/** Seule cette carte lit et réécrit les préférences : elle porte chargement et reprise. */
export function SubjectPrefsCard({
  loading,
  reload,
  onRetry,
}: {
  loading: boolean;
  /** Compteur du conteneur : chaque incrément relit tout. */
  reload: number;
  onRetry: () => void;
}) {
  const { refreshTick, notify, dark } = useApp();
  const [prefs, setPrefs] = useState<SubjectPref[]>([]);
  const [prefsError, setPrefsError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editorError, setEditorError] = useState("");
  const [savingSubject, setSavingSubject] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  useEffect(() => {
    let alive = true;
    setPrefsError("");
    void (async () => {
      try {
        const result = await bridge.subjectPrefs();
        if (!alive) return;
        setPrefs(sanitizeSubjectPrefs(result?.prefs));
      } catch (error) {
        if (!alive) return;
        setPrefsError(actionMessage(error, "Préférences de matières indisponibles."));
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshTick, reload]);

  async function saveSubject(next: SubjectPref): Promise<void> {
    setEditorError("");
    setSavingSubject(true);
    try {
      const response = await bridge.saveSubject(next);
      // Le natif peut refuser la matière : rien n'est écrit, ne jamais annoncer l'enregistrement.
      const refusal = subjectSaveRefusal(response);
      if (refusal) {
        setEditorError(refusal);
        return;
      }
      const updated = Array.isArray(response.prefs)
        ? sanitizeSubjectPrefs(response.prefs)
        : [...prefs.filter((pref) => pref.subject !== next.subject), next];
      setPrefs(updated);
      setEditing(null);
      notify("Matière enregistrée.");
    } catch (error) {
      setEditorError(actionMessage(error, "Matière non enregistrée : réessaie dans un instant."));
    } finally {
      setSavingSubject(false);
    }
  }

  async function addSubject(): Promise<void> {
    const subject = newSubject.trim();
    if (subject === "") return;
    const nameError = subjectNameError(subject);
    if (nameError) {
      setAddError(nameError);
      return;
    }
    setAddError("");
    setAdding(true);
    try {
      const response = await bridge.saveSubject({ subject, color: null, emoji: null, label: null });
      const refusal = subjectSaveRefusal(response);
      if (refusal) {
        setAddError(refusal);
        return;
      }
      const updated = Array.isArray(response.prefs)
        ? sanitizeSubjectPrefs(response.prefs)
        : [...prefs.filter((pref) => pref.subject !== subject), { subject, color: null, emoji: null, label: null }];
      setPrefs(updated);
      setNewSubject("");
      setEditing(subject);
    } catch (error) {
      setAddError(actionMessage(error, "Matière non ajoutée : réessaie dans un instant."));
    } finally {
      setAdding(false);
    }
  }

  const nameError = subjectNameError(newSubject);

  return (
    <Card className="card--flat">
      {prefsError ? (
        <div role="alert" style={{ marginBottom: 10 }}>
          <p className="t-body-m" style={{ color: "var(--danger-ink)", margin: 0 }}>
            {prefsError}
          </p>
          <button
            type="button"
            className="btn btn--small"
            style={{ marginTop: 8 }}
            onClick={onRetry}
          >
            Réessayer
          </button>
        </div>
      ) : null}

      {prefs.length === 0 && !prefsError ? (
        <p className="t-body-m muted" style={{ margin: 0 }}>
          Aucune matière personnalisée. Le nom d'origine est affiché partout, avec une couleur dérivée de son nom.
        </p>
      ) : null}

      <div className="list">
        {prefs.map((pref) => {
          const display = pref.label ?? pref.subject;
          return (
            <div key={pref.subject}>
              <ListRow
                title={display}
                subtitle={pref.label ? pref.subject : undefined}
                leading={
                  <SubjectBadge
                    subject={pref.subject}
                    color={pref.color ?? undefined}
                    emoji={pref.emoji ?? subjectInitial(pref.subject)}
                    size={38}
                    dark={dark}
                  />
                }
                onClick={() => {
                  setEditorError("");
                  setEditing(pref.subject);
                }}
              />
              {editing === pref.subject ? (
                <div style={{ marginTop: 8 }}>
                  <SubjectEditor
                    key={pref.subject}
                    subject={pref.subject}
                    pref={pref}
                    saving={savingSubject}
                    error={editorError}
                    onSave={(next) => void saveSubject(next)}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              ) : null}
              <Divider />
            </div>
          );
        })}
      </div>

      <label className="tiny muted" htmlFor="new-subject" style={{ display: "block", marginTop: 8 }}>
        Matière à personnaliser
      </label>
      <input
        id="new-subject"
        className="field"
        value={newSubject}
        maxLength={64}
        disabled={loading}
        aria-invalid={nameError !== null || addError !== ""}
        placeholder="Nom tel qu'il apparaît dans l'emploi du temps"
        onChange={(event) => {
          setNewSubject(event.target.value);
          if (addError) setAddError("");
        }}
      />
      <p className="tiny muted" style={{ margin: "6px 0 0" }}>
        {nameError ?? addError ?? "Le nom vient de l'établissement : vérifie son orthographe."}
      </p>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        <button
          type="button"
          className="btn btn--small"
          disabled={loading || adding || newSubject.trim() === "" || nameError !== null}
          onClick={() => void addSubject()}
        >
          {adding ? "Ajout…" : "Ajouter la matière"}
        </button>
      </div>
    </Card>
  );
}
