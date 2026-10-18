import { useState } from "react";
import type { SubjectPref } from "../../bridge/types";
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
  const chosenColor = normalizeColorHex(draft.color);
  const badge = draft.emoji.trim() || initialOf(subject);
  const display = draft.label.trim() || subject;

  function submit(): void {
    const next = buildSubjectPref(subject, draft);
    if (!next) return;
    onSave(next);
  }

  return (
    <div className="card card--flat" role="group" aria-label={`Modifier ${subject}`}>
      <div className="row row--between" style={{ alignItems: "flex-start" }}>
        <h3 className="t-title" style={{ margin: 0 }}>
          Modifier la matière
        </h3>
        <button type="button" className="btn btn--ghost btn--small" disabled={saving} onClick={onCancel}>
          Annuler
        </button>
      </div>

      <div
        className="row"
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--surface-variant)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: chosenColor || "var(--brand-pale)",
            color: chosenColor ? "#fff" : "var(--brand-deep)",
            fontWeight: 700,
            textShadow: chosenColor ? "0 1px 2px rgba(0,0,0,0.45)" : undefined,
          }}
        >
          {badge}
        </span>
        <span className="grow" style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
          {display}
        </span>
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
        <div className="row row--wrap" style={{ gap: 8, marginTop: 6 }}>
          {subjectSwatchColors(pref?.color).map((hex) => {
            const selected = hex === chosenColor;
            return (
              <button
                key={hex}
                type="button"
                aria-label={`Couleur ${hex}`}
                aria-pressed={selected}
                onClick={() => setDraft((current) => ({ ...current, color: selected ? "" : hex }))}
                style={{
                  width: 42,
                  height: 42,
                  padding: 0,
                  borderRadius: 999,
                  border: selected ? "3px solid var(--ink)" : "2px solid var(--surface)",
                  background: hex,
                  boxShadow: "var(--shadow-soft)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                }}
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
        <div className="row row--wrap" style={{ gap: 8, marginTop: 6 }}>
          {subjectEmojiChoices(pref?.emoji).map((emoji) => {
            const selected = emoji === draft.emoji;
            return (
              <button
                key={emoji}
                type="button"
                aria-label={`Emoji ${emoji}`}
                aria-pressed={selected}
                onClick={() => setDraft((current) => ({ ...current, emoji: selected ? "" : emoji }))}
                style={{
                  width: 42,
                  height: 42,
                  padding: 0,
                  borderRadius: 999,
                  border: selected ? "2px solid var(--brand)" : "1px solid var(--border)",
                  background: selected ? "var(--brand-pale)" : "var(--surface)",
                  fontSize: 20,
                  lineHeight: 1,
                }}
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
