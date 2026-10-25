import { useEffect, useId, useMemo, useState } from "react";
import { bridge } from "../../bridge/client";
import { BridgeCallError, type LessonSummary, type LessonSubject, type LessonsSnapshot } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import {
  Card,
  EmptyState,
  ErrorBox,
  ListRow,
  Loading,
  Page,
  PageHeading,
  Section,
  SubjectAvatar,
} from "../../ui/components";
import { Dialog } from "../../ui/Dialog";
import { IconBook, IconCamera, IconPlus, IconTrash } from "../../ui/icons";
import "./cahier.css";

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof BridgeCallError) {
    if (error.code === "auth_required") return "Session expirée : rescane le QR de l'établissement.";
    if (error.code === "unavailable") return "Téléphone injoignable : réessaie dans un instant.";
    if (error.message.trim() !== "") return error.message;
  }
  return fallback;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Statut court du manuel : une puce, jamais un paragraphe par matière. */
function manualStatus(subject: LessonSubject): {
  label: string;
  tone: "on" | "off" | "none";
} {
  if (!subject.manualEnabled) return { label: "Cahier seul", tone: "off" };
  if (!subject.manualAvailable) return { label: "Sans manuel", tone: "none" };
  return { label: "Manuel", tone: "on" };
}

type Editor = {
  id: string;
  subject: string;
  title: string;
  text: string;
};

type PhotoSource = "camera" | "gallery";

/** Cahier de cours local (#586) : la mémoire de l'assistant par matière. */
export function CahierScreen() {
  const { notify, refreshTick, dark } = useApp();
  const [snapshot, setSnapshot] = useState<LessonsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LessonSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [manualBusy, setManualBusy] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  const [photoTarget, setPhotoTarget] = useState<string | null>(null);
  const listId = useId();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void bridge
      .lessons()
      .then((result) => {
        if (!alive) return;
        setSnapshot(result);
      })
      .catch((e: unknown) => {
        if (alive) setError(messageOf(e, "Cahier indisponible : réessaie dans un instant."));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reload, refreshTick]);

  const subjects = useMemo(
    () => (snapshot?.subjects ?? []).slice().sort((a, b) => a.subject.localeCompare(b.subject, "fr")),
    [snapshot],
  );
  // Les matières sans cours ne prennent pas une carte : une ligne compacte suffit.
  const withNotes = useMemo(() => subjects.filter((item) => item.notes.length > 0), [subjects]);
  const withoutNotes = useMemo(() => subjects.filter((item) => item.notes.length === 0), [subjects]);

  function afterWrite(message: string) {
    notify(message);
    setReload((value) => value + 1);
  }

  async function openNote(id: string) {
    setEditorError("");
    setEditorLoading(true);
    try {
      const result = await bridge.lesson(id);
      if (!result.ok || !result.note) {
        notify(result.message || "Cours introuvable.", "error");
        return;
      }
      setEditor({
        id: result.note.id,
        subject: result.note.subject,
        title: result.note.title,
        text: result.note.text,
      });
    } catch (e) {
      notify(messageOf(e, "Cours indisponible."), "error");
    } finally {
      setEditorLoading(false);
    }
  }

  function newNote(subject = "") {
    setEditorError("");
    setEditor({ id: "", subject, title: "", text: "" });
  }

  async function saveNote() {
    if (!editor || saving) return;
    const subject = editor.subject.trim();
    const title = editor.title.trim();
    const text = editor.text.trim();
    if (subject === "") {
      setEditorError("Choisis une matière.");
      return;
    }
    if (title === "") {
      setEditorError("Donne un titre au cours.");
      return;
    }
    if (text === "") {
      setEditorError("Le cours est vide.");
      return;
    }
    setSaving(true);
    setEditorError("");
    try {
      const result = await bridge.saveLesson({
        ...(editor.id === "" ? {} : { id: editor.id }),
        subject,
        title,
        text,
      });
      if (!result.ok) {
        setEditorError(result.message || "Cours non enregistré.");
        return;
      }
      setEditor(null);
      afterWrite("Cours enregistré.");
    } catch (e) {
      setEditorError(messageOf(e, "Cours non enregistré : réessaie dans un instant."));
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const result = await bridge.deleteLesson(deleteTarget.id);
      if (!result.ok) {
        notify(result.message || "Cours non supprimé.", "error");
        return;
      }
      setDeleteTarget(null);
      setEditor(null);
      afterWrite("Cours supprimé.");
    } catch (e) {
      notify(messageOf(e, "Cours non supprimé."), "error");
    } finally {
      setDeleting(false);
    }
  }

  async function toggleManual(subject: string, enabled: boolean) {
    if (manualBusy) return;
    setManualBusy(subject);
    try {
      const result = await bridge.setLessonManual(subject, enabled);
      if (!result.ok) {
        notify(result.message || "Réglage du manuel non enregistré.", "error");
        return;
      }
      setSnapshot((current) =>
        current === null
          ? current
          : {
              ...current,
              subjects: current.subjects.map((item) =>
                item.subject === subject ? { ...item, manualEnabled: enabled } : item,
              ),
            },
      );
      notify(enabled ? "Manuel activé pour cette matière." : "Manuel désactivé pour cette matière.");
    } catch (e) {
      notify(messageOf(e, "Réglage du manuel non enregistré."), "error");
    } finally {
      setManualBusy(null);
    }
  }

  /**
   * Photo de cours -> brouillon. La photo ne passe jamais par la WebView :
   * le natif l'envoie au fournisseur puis la supprime. L'élève relit le texte
   * avant l'enregistrement.
   */
  async function addPhoto(subject: string, source: PhotoSource) {
    if (photoBusy !== null) return;
    setPhotoBusy(subject);
    try {
      const result = await bridge.addLessonPhoto(subject, source);
      if (result.cancelled) return;
      if (!result.ok) {
        notify(result.message || "Photo non transcrite.", "error");
        return;
      }
      setEditor({
        id: "",
        subject,
        title: result.title || "Cours photographié",
        text: result.text || "",
      });
      notify("Photo transcrite : relis le texte avant d’enregistrer.");
    } catch (e) {
      notify(messageOf(e, "Photo non transcrite : réessaie dans un instant."), "error");
    } finally {
      setPhotoBusy(null);
    }
  }

  function choosePhoto(source: PhotoSource) {
    const subject = photoTarget;
    if (!subject) return;
    setPhotoTarget(null);
    void addPhoto(subject, source);
  }

  if (loading && snapshot === null && error === "") {
    return (
      <Page>
        <Loading label="Chargement du cahier…" />
      </Page>
    );
  }

  if (error && snapshot === null) {
    return (
      <Page>
        <ErrorBox message={error}>
          <button type="button" className="btn btn--small" onClick={() => setReload((value) => value + 1)}>
            Réessayer
          </button>
        </ErrorBox>
      </Page>
    );
  }

  const maxText = snapshot?.maxTextChars ?? 4000;
  const maxNotes = snapshot?.maxNotesPerSubject ?? 8;
  const maxTitle = snapshot?.maxTitleChars ?? 120;

  return (
    <Page>
      <PageHeading
        eyebrow="Mémoire de l'assistant"
        title="Cahier de cours"
        action={
          <button type="button" className="btn btn--small" onClick={() => newNote()}>
            <IconPlus size={16} />
            Ajouter
          </button>
        }
      />

      <Card className="card--flat cahier-privacy">
        <p className="t-body-m" style={{ margin: 0 }}>
          Garde ici les cours de tes matières. L’assistant les utilise comme sources pour l’aide
          devoirs et les fiches de révision, même quand tu n’as pas de manuel.
        </p>
        <p className="tiny muted cahier-privacy__note">
          Ces cours restent sur ton téléphone et sont supprimés à la déconnexion. Ils partent
          directement au fournisseur d’IA, avec ta clé, uniquement quand tu demandes de l’aide ;
          une photo est transcrite puis elle est supprimée, et le texte revient ici pour relecture.
        </p>
      </Card>

      {error ? <ErrorBox message={error} /> : null}

      {subjects.length === 0 ? (
        <EmptyState
          icon={<IconBook size={30} />}
          title="Aucun cours enregistré"
          body="Ajoute un cours pour que l’assistant suive la méthode de ton prof."
          action={
            <button type="button" className="btn btn--small" onClick={() => newNote()}>
              Ajouter un cours
            </button>
          }
        />
      ) : null}

      {withNotes.map((subject) => {
        const status = manualStatus(subject);
        return (
          <Card key={subject.subject} as="article" className="cahier-subject">
            <div className="cahier-subject__head">
              <SubjectAvatar subject={subject.subject} size={38} dark={dark} />
              <div className="grow">
                <h2 className="cahier-subject__title">{subject.subject}</h2>
                <span className="cahier-subject__meta">
                  <span className="t-caption muted">{subject.notes.length} cours</span>
                  <span className={`cahier-status cahier-status--${status.tone}`}>{status.label}</span>
                </span>
              </div>
            </div>

            <div className="cahier-manual">
              <label className="cahier-manual__label">
                <input
                  type="checkbox"
                  checked={subject.manualEnabled}
                  disabled={manualBusy === subject.subject}
                  onChange={(event) => void toggleManual(subject.subject, event.target.checked)}
                />
                <span className="tiny">Utiliser le manuel</span>
              </label>
            </div>

            <div className="rows cahier-subject__notes">
              {subject.notes.map((note) => (
                <ListRow
                  key={note.id}
                  title={note.title}
                  subtitle={`${dayLabel(note.createdAt)} · ${note.chars} caractères`}
                  onClick={() => void openNote(note.id)}
                />
              ))}
            </div>

            <div className="cahier-subject__actions">
              <button type="button" className="btn btn--small" onClick={() => newNote(subject.subject)}>
                Ajouter un cours
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={photoBusy !== null}
                aria-label={`Ajouter une photo de cours pour ${subject.subject}`}
                onClick={() => setPhotoTarget(subject.subject)}
              >
                <IconCamera size={16} />
                {photoBusy === subject.subject ? "Transcription…" : "Photo"}
              </button>
            </div>
          </Card>
        );
      })}

      {withoutNotes.length > 0 ? (
        <Section
          title="Sans cours"
          action={<span className="tiny muted">{withoutNotes.length}</span>}
        >
          <Card className="card--flat">
            <div className="cahier-empty-list">
              {withoutNotes.map((subject) => (
                <div key={subject.subject} className="cahier-empty-row">
                  <SubjectAvatar subject={subject.subject} size={28} dark={dark} />
                  <span className="grow cahier-empty-row__name">{subject.subject}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={photoBusy !== null}
                    aria-label={`Ajouter une photo de cours pour ${subject.subject}`}
                    onClick={() => setPhotoTarget(subject.subject)}
                  >
                    <IconCamera size={18} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => newNote(subject.subject)}
                  >
                    Ajouter
                  </button>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      ) : null}

      <p className="tiny muted" style={{ textAlign: "center" }}>
        {maxNotes} cours maximum par matière · {maxText} caractères par cours
      </p>

      <Dialog
        open={photoTarget !== null}
        title="Ajouter une photo"
        description={
          photoTarget
            ? `${photoTarget} — choisis la source. Le texte revient ici pour relecture.`
            : undefined
        }
        busy={photoBusy !== null}
        onClose={() => {
          if (photoBusy === null) setPhotoTarget(null);
        }}
        actions={
          <>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={photoBusy !== null}
              onClick={() => setPhotoTarget(null)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={photoBusy !== null}
              onClick={() => choosePhoto("gallery")}
            >
              Choisir une image
            </button>
            <button
              type="button"
              className="btn btn--small"
              disabled={photoBusy !== null}
              onClick={() => choosePhoto("camera")}
            >
              Prendre une photo
            </button>
          </>
        }
      />

      <Dialog
        open={editor !== null}
        title={editor?.id ? "Modifier le cours" : "Ajouter un cours"}
        description="Le texte est envoyé au fournisseur comme une donnée, jamais comme une instruction."
        busy={saving}
        onClose={() => {
          if (!saving) setEditor(null);
        }}
        actions={
          <>
            {editor?.id ? (
              <button
                type="button"
                className="btn btn--danger btn--small"
                disabled={saving}
                onClick={() => {
                  const summary = subjects
                    .flatMap((subject) => subject.notes)
                    .find((note) => note.id === editor.id);
                  if (summary) setDeleteTarget(summary);
                }}
              >
                <IconTrash size={16} />
                Supprimer
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost btn--small" disabled={saving} onClick={() => setEditor(null)}>
              Annuler
            </button>
            <button type="button" className="btn btn--small" disabled={saving || editorLoading} onClick={() => void saveNote()}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </>
        }
      >
        {editorLoading ? <Loading label="Chargement du cours…" /> : null}
        {editor ? (
          <>
            <label className="tiny muted" htmlFor={`${listId}-subject`} style={{ display: "block", marginBottom: 6 }}>
              Matière
            </label>
            <input
              id={`${listId}-subject`}
              className="field"
              list={`${listId}-subjects`}
              value={editor.subject}
              maxLength={64}
              disabled={saving}
              data-autofocus
              onChange={(event) => setEditor({ ...editor, subject: event.target.value })}
            />
            <datalist id={`${listId}-subjects`}>
              {subjects.map((subject) => (
                <option key={subject.subject} value={subject.subject} />
              ))}
            </datalist>

            <label className="tiny muted" htmlFor={`${listId}-title`} style={{ display: "block", margin: "10px 0 6px" }}>
              Titre
            </label>
            <input
              id={`${listId}-title`}
              className="field"
              value={editor.title}
              maxLength={maxTitle}
              disabled={saving}
              placeholder="Chapitre 4 — dérivées"
              onChange={(event) => setEditor({ ...editor, title: event.target.value })}
            />

            <label className="tiny muted" htmlFor={`${listId}-text`} style={{ display: "block", margin: "10px 0 6px" }}>
              Cours
            </label>
            <textarea
              id={`${listId}-text`}
              className="field field--area"
              value={editor.text}
              maxLength={maxText}
              rows={10}
              disabled={saving}
              placeholder="Colle ou écris ici le cours de la matière."
              onChange={(event) => setEditor({ ...editor, text: event.target.value })}
            />
            <p className="tiny muted" style={{ margin: "4px 0 0", textAlign: "right" }}>
              {editor.text.length} / {maxText}
            </p>
            {editorError ? (
              <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
                {editorError}
              </p>
            ) : null}
          </>
        ) : null}
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        role="alertdialog"
        title="Supprimer ce cours ?"
        description="Le cours sera retiré du cahier et ne sera plus utilisé par l’assistant."
        busy={deleting}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        actions={
          <>
            <button type="button" className="btn btn--ghost btn--small" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Annuler
            </button>
            <button type="button" className="btn btn--danger btn--small" disabled={deleting} onClick={() => void deleteNote()}>
              {deleting ? "Suppression…" : "Supprimer"}
            </button>
          </>
        }
      >
        <p className="t-body-m" style={{ margin: 0 }}>
          {deleteTarget?.title ?? ""}
        </p>
      </Dialog>
    </Page>
  );
}
