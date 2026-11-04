import type { Ref } from "react";
import {
  PAIRING_AUTHORIZATION_ATTESTATION,
  PAIRING_AUTHORIZATION_DETAIL,
} from "./model";

interface Props {
  checked: boolean;
  error: string;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (checked: boolean) => void;
}

export function PairingAuthorization({ checked, error, disabled = false, inputRef, onChange }: Props) {
  const helpId = "pairing-attestation-help";
  const errorId = "pairing-attestation-error";
  return (
    <div className="card card--flat">
      <p id={helpId} className="tiny muted" style={{ margin: "0 0 8px" }}>
        {PAIRING_AUTHORIZATION_DETAIL}
      </p>
      <label
        className="t-body-m"
        htmlFor="pairing-attestation"
        style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}
      >
        <input
          ref={inputRef}
          id="pairing-attestation"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-required="true"
          aria-invalid={error !== ""}
          aria-describedby={error !== "" ? `${helpId} ${errorId}` : helpId}
          style={{ flex: "none", width: 18, height: 18, margin: 0, accentColor: "var(--brand-solid)" }}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{PAIRING_AUTHORIZATION_ATTESTATION}</span>
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
