import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { bridge } from "../../bridge/client";
import { BridgeCallError } from "../../bridge/types";
import { useApp } from "../../ui/AppContext";
import { Card, Page } from "../../ui/components";
import { IconCamera, IconChevronLeft, IconLock } from "../../ui/icons";
import {
  PIN_MAX_CHARS,
  normalizePin,
  pairErrorMessage,
  pinError,
  qrHost,
  scanErrorMessage,
  validateScannedQr,
  type SchoolQr,
} from "./model";

function actionMessage(error: unknown, fallback: string): string {
  if (error instanceof BridgeCallError) {
    if (error.code === "unavailable") return "Le téléphone n'a pas répondu : réessaie dans un instant.";
    if (error.code === "auth_required") return pairErrorMessage("auth_required");
  }
  return fallback;
}

function StepChip({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      className={`chip${done ? " chip--active" : ""}`}
      aria-label={`${label}${done ? " : fait" : " : à faire"}`}
    >
      {label}
    </span>
  );
}

export default function PairingScreen() {
  const navigate = useNavigate();
  const { refresh, notify } = useApp();
  const [qr, setQr] = useState<SchoolQr | null>(null);
  const [pin, setPin] = useState("");
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scanError, setScanError] = useState("");
  const [pairError, setPairError] = useState("");

  useEffect(() => {
    return () => {
      // Quitter l'écran pendant un scan ne doit pas laisser la caméra ouverte.
      void bridge.cancelPairing().catch(() => undefined);
    };
  }, []);

  const host = qr ? qrHost(qr.url) : "";
  const ready = qr !== null && normalizePin(pin) !== "";

  async function scan(): Promise<void> {
    setScanError("");
    setPairError("");
    setScanning(true);
    try {
      const result = await bridge.scanQr();
      if (result.cancelled) {
        setScanError(scanErrorMessage(true));
        return;
      }
      const scanned = validateScannedQr(result.qr);
      if (!scanned) {
        setScanError(scanErrorMessage(false));
        return;
      }
      // Un nouveau QR = un nouveau PIN : l'ancien ne s'applique plus.
      setQr(scanned);
      setPin("");
    } catch (error) {
      setScanError(actionMessage(error, "Scan indisponible : réessaie dans un instant."));
    } finally {
      setScanning(false);
    }
  }

  async function cancelScan(): Promise<void> {
    try {
      await bridge.cancelPairing();
    } catch {
      // Le scan se terminera de lui-même ; rien à afficher de plus.
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!qr) {
      setPairError("Scanne d'abord le QR affiché par ton application.");
      return;
    }
    const invalidPin = pinError(pin);
    if (invalidPin) {
      setPairError(invalidPin);
      return;
    }
    setPairError("");
    setSubmitting(true);
    try {
      const result = await bridge.pair({ qr, pin: normalizePin(pin) });
      if (result.ok) {
        setQr(null);
        setPin("");
        notify("Appareil appairé.");
        refresh();
        navigate("/", { replace: true });
        return;
      }
      setPairError(pairErrorMessage(result.code));
    } catch (error) {
      setPairError(
        error instanceof BridgeCallError
          ? pairErrorMessage(error.code)
          : "Appairage impossible : rescane le QR puis réessaie.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="shell">
      <main className="main" style={{ paddingBottom: 32 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              if (window.history.length > 1) navigate(-1);
              else navigate("/", { replace: true });
            }}
          >
            <IconChevronLeft size={18} />
            Retour
          </button>
        </div>

        <Page>
          <Card className="card--brand">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <h1 className="t-headline" style={{ margin: 0 }}>
                  Connecte ton établissement
                </h1>
                <p className="t-body-m" style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.9)" }}>
                  Scanne le QR de l'application de ton établissement, puis saisis son PIN. Ta session reste sur ce
                  téléphone.
                </p>
              </div>
              <span
                aria-hidden="true"
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.16)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 auto",
                }}
              >
                <IconLock size={26} />
              </span>
            </div>
          </Card>

          <div className="row row--wrap">
            <StepChip label="1 · Scanner" done={qr !== null} />
            <StepChip label="2 · PIN" done={qr !== null && normalizePin(pin) !== ""} />
          </div>

          <Card className="card--flat">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <span style={{ color: "var(--muted)" }}>
                <IconCamera size={22} />
              </span>
              <div className="grow">
                <strong style={{ display: "block" }}>{qr ? "QR lu" : "Aucun QR lu"}</strong>
                <p className="tiny muted" role="status" aria-live="polite" style={{ margin: "2px 0 0" }}>
                  {qr
                    ? `Établissement : ${host}. Saisis maintenant le PIN défini dans ton compte.`
                    : "Le scan ouvre la caméra et lit uniquement un QR de connexion."}
                </p>
              </div>
            </div>
            <div className="row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
              {scanning ? (
                <button type="button" className="btn btn--ghost btn--small" onClick={() => void cancelScan()}>
                  Annuler le scan
                </button>
              ) : null}
              <button type="button" className="btn btn--small" disabled={scanning || submitting} onClick={() => void scan()}>
                {scanning ? "Scan en cours…" : qr ? "Rescanner le QR" : "Scanner le QR"}
              </button>
            </div>
          </Card>

          <form className="stack" onSubmit={(event) => void submit(event)}>
            <div>
              <label className="tiny muted" htmlFor="pairing-pin" style={{ display: "block", marginBottom: 4 }}>
                Code PIN du QR
              </label>
              <input
                id="pairing-pin"
                className="field"
                type="password"
                value={pin}
                maxLength={PIN_MAX_CHARS}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="numeric"
                aria-describedby="pin-help"
                placeholder="PIN défini dans ton compte"
                onChange={(event) => {
                  setPin(event.target.value.slice(0, PIN_MAX_CHARS));
                  if (pairError) setPairError("");
                }}
              />
              <p id="pin-help" className="tiny muted" style={{ margin: "6px 0 0" }}>
                Celui défini dans ton compte établissement : il déchiffre le QR. Il n'est jamais enregistré.
              </p>
            </div>

            {scanError ? (
              <div className="card card--flat" role="alert" style={{ borderColor: "var(--danger)" }}>
                <p className="t-body-m" style={{ margin: 0, color: "var(--danger-ink)" }}>
                  {scanError}
                </p>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  style={{ marginTop: 8 }}
                  disabled={scanning}
                  onClick={() => void scan()}
                >
                  Rescanner le QR
                </button>
              </div>
            ) : null}

            {pairError ? (
              <div className="card card--flat" role="alert" style={{ borderColor: "var(--danger)" }}>
                <p className="t-body-m" style={{ margin: 0, color: "var(--danger-ink)" }}>
                  {pairError}
                </p>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  style={{ marginTop: 8 }}
                  disabled={scanning || submitting}
                  onClick={() => void scan()}
                >
                  Rescanner le QR
                </button>
              </div>
            ) : null}

            {!ready ? (
              <p className="t-body-m muted" style={{ margin: 0 }}>
                {qr === null && normalizePin(pin) !== ""
                  ? "QR manquant : scanne le code affiché par ton application."
                  : qr !== null
                    ? "Le PIN du QR est obligatoire : il déchiffre le contenu scanné."
                    : "Il faut le QR affiché par ton application + son PIN."}
              </p>
            ) : null}

            <button type="submit" className="btn" disabled={!ready || submitting || scanning}>
              {submitting ? "Connexion…" : "Terminer"}
            </button>
          </form>
        </Page>
      </main>
    </div>
  );
}
