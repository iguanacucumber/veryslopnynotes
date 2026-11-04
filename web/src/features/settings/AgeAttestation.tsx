import { AI_AGE_ATTESTATION, AI_AGE_ATTESTATION_DETAIL } from "../assistant/consent";

interface Props {
  checked: boolean;
  error: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** Attestation explicite, recueillie AVANT l'accord et la clé (PRV-05). */
export function AgeAttestation({ checked, error, disabled = false, onChange }: Props) {
  const helpId = "ai-age-attestation-help";
  const errorId = "ai-age-attestation-error";
  return (
    <div style={{ marginTop: 10 }}>
      <p id={helpId} className="tiny muted" style={{ margin: "0 0 8px" }}>
        {AI_AGE_ATTESTATION_DETAIL}
      </p>
      <label
        className="t-body-m"
        htmlFor="ai-age-attestation"
        style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}
      >
        <input
          id="ai-age-attestation"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-required="true"
          aria-invalid={error !== ""}
          aria-describedby={error !== "" ? `${helpId} ${errorId}` : helpId}
          style={{ flex: "none", width: 18, height: 18, margin: 0, accentColor: "var(--brand-solid)" }}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{AI_AGE_ATTESTATION}</span>
      </label>
      {error ? (
        <p
          id={errorId}
          className="tiny"
          role="alert"
          style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
