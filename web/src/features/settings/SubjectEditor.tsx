import { useState } from "react";
import type { SubjectPref } from "../../bridge/types";
import { readableInk } from "../../lib/format";
import { useApp } from "../../ui/AppContext";
import { SubjectBadge } from "../../ui/components";
import { IconCheck } from "../../ui/icons";
import {
  buildSubjectPref,
  normalizeColorHex,
  subjectEmojiChoices,
  subjectSwatchColors,
  type SubjectDraft,
} from "./model";

function initialOf(subject: string): string {
  return subject.trim().charAt(0).toUpperCase() || "?";
}

export function SubjectEditor({
  subject,
  pref,
  saving,
  error,
  onSave,
  onCancel,
}: {
  subject: string;
  pref: SubjectPref | null;
  saving: boolean;
  error: string;
  onSave: (pref: SubjectPref) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SubjectDraft>({
    color: pref?.color ?? "",
    emoji: pref?.emoji ?? "",
    label: pref?.label ?? "",
  });
  const { dark } = useApp();
  const chosenColor = normalizeColorHex(draft.color);
  const badge = draft.emoji.trim() || initialOf(subject);
  const display = draft.label.trim() || subject;

  function submit(): void {
    const next = buildSubjectPref(subject, draft);
    if (!next) return;
    onSave(next);
  }

  return (
    <div className="card card--flat subject-editor" role="group" aria-label={`Modifier ${subject}`}>
      <div className="row row--between" style={{ alignItems: "flex-start" }}>
        <h3 className="t-title" style={{ margin: 0 }}>
          Modifier la matière
        </h3>
        <button type="button" className="btn btn--ghost btn--small" disabled={saving} onClick={onCancel}>
          Annuler
        </button>
      </div>

      <div className="row subject-editor__preview">
        <SubjectBadge
          subject={subject}
          color={chosenColor || undefined}
          emoji={badge}
          size={38}
          dark={dark}
        />
        <span className="grow subject-editor__preview-name">{display}</span>
      </div>

      <label className="tiny muted" htmlFor="subject-label" style={{ display: "block", marginTop: 14 }}>
        Nom affiché (facultatif)
      </label>
      <input
        id="subject-label"
        className="field"
        value={draft.label}
        maxLength={64}
        placeholder={subject}
        onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
      />

      <fieldset style={{ border: 0, padding: 0, margin: "14px 0 0" }}>
        <legend className="tiny muted" style={{ padding: 0 }}>
          Couleur
        </legend>
        <div className="row row--wrap subject-editor__swatches">
          {subjectSwatchColors(pref?.color).map((hex) => {
            const selected = hex === chosenColor;
            return (
              <button
                key={hex}
                type="button"
                className="subject-swatch"
                aria-label={`Couleur ${hex}`}
                aria-pressed={selected}
                onClick={() => setDraft((current) => ({ ...current, color: selected ? "" : hex }))}
                style={{ background: hex, color: readableInk(hex) }}
              >
                {selected ? <IconCheck size={18} /> : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: "14px 0 0" }}>
        <legend className="tiny muted" style={{ padding: 0 }}>
          Emoji
        </legend>
        <div className="row row--wrap subject-editor__swatches">
          {subjectEmojiChoices(pref?.emoji).map((emoji) => {
            const selected = emoji === draft.emoji;
            return (
              <button
                key={emoji}
                type="button"
                className="subject-emoji"
                aria-label={`Emoji ${emoji}`}
                aria-pressed={selected}
                onClick={() => setDraft((current) => ({ ...current, emoji: selected ? "" : emoji }))}
              >
                {emoji}
              </button>
            );
          })}
        </div>
      </fieldset>

      {error ? (
        <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          disabled={saving}
          onClick={() => setDraft({ color: "", emoji: "", label: "" })}
        >
          Réinitialiser
        </button>
        <button type="button" className="btn btn--small" disabled={saving} onClick={submit}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
