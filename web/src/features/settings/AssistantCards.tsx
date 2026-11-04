import { useEffect, useState } from "react";
import { bridge } from "../../bridge/client";
import type { AiConsentDecision, SettingsSnapshot } from "../../bridge/types";
import { STORAGE_UNAVAILABLE_MESSAGE } from "../../lib/session";
import { useApp } from "../../ui/AppContext";
import { Card } from "../../ui/components";
import { Dialog } from "../../ui/Dialog";
import {
  AI_AGE_ATTESTATION_REQUIRED,
  AI_CONSENT_COST_NOTE,
  AI_CONSENT_ITEMS,
  AI_CONSENT_REQUIRED_MESSAGE,
  AI_CONSENT_RETENTION_NOTE,
  AI_CONSENT_VERSION,
  AI_KEY_LIFETIME_NOTE,
  aiConsentGranted,
  aiConsentNeedsReconsent,
} from "../assistant/consent";
import { AI_MODEL_NOTE } from "../assistant/notices";
import { AgeAttestation } from "./AgeAttestation";
import { AssistantOverviewCard } from "./AssistantOverviewCard";
import { actionMessage } from "./action";
import { MAX_API_KEY_CHARS, llmSaveError } from "./model";

type ConsentAction = "granted" | "refused" | "withdrawn";

function consentHeading(
  decision: AiConsentDecision | null,
  loading: boolean,
  version: number,
  ageAttested: boolean,
): string {
  if (decision === null) return loading ? "Lecture du consentement IA…" : "Consentement IA non lu";
  if (decision === "refused") return "Assistant IA désactivé";
  if (decision === "withdrawn") return "Consentement retiré";
  if (decision === "granted" && version === AI_CONSENT_VERSION && !ageAttested) {
    return "Attestation d’âge à confirmer";
  }
  if (aiConsentNeedsReconsent(decision, version, ageAttested)) return "Consentement IA à renouveler";
  return "Avant d’activer l’assistant IA";
}

function consentBody(
  decision: AiConsentDecision | null,
  loading: boolean,
  version: number,
  ageAttested: boolean,
): string {
  if (decision === null) {
    return loading
      ? "L’état du consentement IA est en cours de lecture."
      : "Les réglages n’ont pas pu être lus. L’assistant reste désactivé ; tu peux donner ton accord ci-dessous.";
  }
  if (decision === "refused" || decision === "withdrawn") {
    return "Ton choix est enregistré sur cet appareil : aucun appel IA n’est possible tant que tu n’acceptes pas. Tu peux revenir sur ce choix à tout moment.";
  }
  if (decision === "granted" && version === AI_CONSENT_VERSION && !ageAttested) {
    return "Ton accord ne comporte pas encore l’attestation d’âge ou d’autorisation parentale. L’assistant reste désactivé tant que tu ne la confirmes pas et n’acceptes pas à nouveau.";
  }
  if (aiConsentNeedsReconsent(decision, version, ageAttested)) {
    return "Le texte, le périmètre ou l’attestation de l’accord ont changé depuis ta dernière acceptation. Ton ancien accord n’est pas réutilisé : l’assistant reste désactivé tant que tu n’as pas relu l’aperçu, confirmé l’attestation et accepté à nouveau.";
  }
  return "L’assistant est facultatif et reste désactivé tant que tu n’as pas confirmé l’attestation et accepté. Voici exactement ce qui quitte l’appareil quand tu l’utilises.";
}

export function AssistantCards({ snapshot, loading }: { snapshot: SettingsSnapshot | null; loading: boolean }) {
  const { notify, storageUnavailable } = useApp();
  // `null` = instantané non lu : on ne prétend ni clé absente ni clé active.
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [consent, setConsent] = useState<AiConsentDecision | null>(null);
  const [consentVersion, setConsentVersion] = useState(0);
  const [ageAttested, setAgeAttested] = useState(false);
  const [attestationChecked, setAttestationChecked] = useState(false);
  const [attestationError, setAttestationError] = useState("");
  const [consentError, setConsentError] = useState("");
  const [decidingConsent, setDecidingConsent] = useState<ConsentAction | "">("");
  const [withdrawAsk, setWithdrawAsk] = useState(false);
  const [llmKey, setLlmKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [llmError, setLlmError] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [forgetAsk, setForgetAsk] = useState(false);
  const [forgettingKey, setForgettingKey] = useState(false);

  useEffect(() => {
    if (!snapshot) return;
    setLlmConfigured(snapshot.llmConfigured === true);
    setConsent(snapshot.aiConsent ?? "none");
    setConsentVersion(snapshot.aiConsentVersion ?? 0);
    setAgeAttested(snapshot.aiAgeAttested === true);
  }, [snapshot]);

  const consentGranted =
    consent !== null && aiConsentGranted(consent, consentVersion, ageAttested);

  async function decideConsent(decision: ConsentAction): Promise<void> {
    if (decision === "granted" && !attestationChecked) {
      setAttestationError(AI_AGE_ATTESTATION_REQUIRED);
      return;
    }
    setConsentError("");
    setAttestationError("");
    setDecidingConsent(decision);
    try {
      const response = await bridge.setAiConsent(
        decision,
        decision === "granted" && attestationChecked,
      );
      if (response.decision) {
        setConsent(response.decision);
        setConsentVersion(response.version ?? 0);
        setAgeAttested(response.ageAttested === true);
      }
      if (!response.ok) {
        setConsentError(
          response.message || actionMessage(null, "Consentement non enregistré : réessaie dans un instant."),
        );
        return;
      }
      if (decision === "withdrawn") {
        setLlmConfigured(false);
        setLlmKey("");
        setKeyVisible(false);
        setWithdrawAsk(false);
        setAgeAttested(false);
        setAttestationChecked(false);
        notify("Consentement et attestation retirés : clé et fil du professeur effacés.");
      } else if (decision === "granted") {
        setAgeAttested(true);
        setAttestationChecked(true);
        notify("Consentement et attestation IA enregistrés.");
      } else {
        setAgeAttested(false);
        setAttestationChecked(false);
        notify("Assistant IA désactivé.");
      }
    } catch (error) {
      setConsentError(actionMessage(error, "Consentement non modifié : réessaie dans un instant."));
    } finally {
      setDecidingConsent("");
    }
  }

  async function saveKey(): Promise<void> {
    if (!consentGranted) {
      setLlmError(AI_CONSENT_REQUIRED_MESSAGE);
      return;
    }
    const key = llmKey.trim();
    if (key === "") {
      setLlmError("Colle une clé avant d'enregistrer.");
      return;
    }
    setLlmError("");
    setSavingKey(true);
    try {
      const response = await bridge.saveLlmKey(key);
      const refusal = llmSaveError(response);
      if (refusal !== "") {
        setLlmError(refusal);
        return;
      }
      setLlmConfigured(true);
      setLlmKey("");
      setKeyVisible(false);
      notify("Clé de l'assistant enregistrée.");
    } catch (error) {
      // Jamais le message natif ici : il pourrait recopier la saisie.
      setLlmError(actionMessage(error, "Clé non enregistrée : réessaie dans un instant."));
    } finally {
      setSavingKey(false);
    }
  }

  async function forgetKey(): Promise<void> {
    // La suppression ne part que du dialogue de confirmation.
    setLlmError("");
    setForgettingKey(true);
    try {
      await bridge.forgetLlmKey();
      setLlmConfigured(false);
      notify("Clé de l'assistant oubliée.");
    } catch (error) {
      setLlmError(actionMessage(error, "Clé non supprimée : réessaie dans un instant."));
    } finally {
      setForgettingKey(false);
      setForgetAsk(false);
    }
  }

  return (
    <>
      <AssistantOverviewCard
        configured={consentGranted ? llmConfigured : false}
        loading={loading}
        consent={consent}
        consentVersion={consentVersion}
        ageAttested={ageAttested}
      />

      {!consentGranted ? (
        <Card className="card--flat assistant-key ai">
          <strong className="assistant-key__title">
            {consentHeading(consent, loading, consentVersion, ageAttested)}
          </strong>
          <p className="assistant-key__body">
            {consentBody(consent, loading, consentVersion, ageAttested)}
          </p>
          <ul className="assistant-consent__list">
            {AI_CONSENT_ITEMS.map((item) => (
              <li key={item.key}>
                <strong>{item.label}</strong> — {item.detail}
              </li>
            ))}
          </ul>
          <p className="tiny muted">{AI_CONSENT_RETENTION_NOTE}</p>
          <p className="tiny muted">{AI_KEY_LIFETIME_NOTE}</p>
          <p className="tiny muted">{AI_CONSENT_COST_NOTE}</p>
          <AgeAttestation
            checked={attestationChecked}
            error={attestationError}
            disabled={loading || decidingConsent !== ""}
            onChange={(checked) => {
              setAttestationChecked(checked);
              if (attestationError) setAttestationError("");
            }}
          />
          {consentError ? (
            <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
              {consentError}
            </p>
          ) : null}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={loading || decidingConsent !== ""}
              onClick={() => void decideConsent("refused")}
            >
              {decidingConsent === "refused" ? "Enregistrement…" : "Je refuse : garder l’IA désactivée"}
            </button>
            <button
              type="button"
              className="btn btn--small"
              disabled={loading || decidingConsent !== "" || !attestationChecked}
              onClick={() => void decideConsent("granted")}
            >
              {decidingConsent === "granted" ? "Enregistrement…" : "J’accepte et j’active l’assistant"}
            </button>
          </div>
        </Card>
      ) : null}

      {consentGranted ? (
        <Card className="card--flat assistant-key ai">
          <strong className="assistant-key__title">Connexion OpenRouter</strong>
          <p className="assistant-key__body">
            L’assistant utilise ton compte OpenRouter. La clé est enregistrée chiffrée sur cet appareil ;
            elle part directement au fournisseur avec chaque demande.
          </p>
          <p className="tiny muted">{AI_KEY_LIFETIME_NOTE}</p>
          <p className="tiny muted">
            Ton attestation d’âge ou d’autorisation parentale est enregistrée avec ce consentement.
          </p>
          <p className="tiny muted">{AI_MODEL_NOTE}</p>
          <label className="assistant-key__label" htmlFor="llm-key">
            Clé OpenRouter
          </label>
          <div className="row">
            <input
              id="llm-key"
              className="field grow"
              type={keyVisible ? "text" : "password"}
              value={llmKey}
              maxLength={MAX_API_KEY_CHARS}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={loading}
              placeholder={
                llmConfigured === null
                  ? "État de la clé non lu"
                  : llmConfigured
                    ? "Nouvelle clé (facultatif)"
                    : "Colle ta clé ici"
              }
              onChange={(event) => {
                setLlmKey(event.target.value.slice(0, MAX_API_KEY_CHARS));
                if (llmError) setLlmError("");
              }}
            />
            <button
              type="button"
              className="btn btn--ghost btn--small"
              aria-pressed={keyVisible}
              disabled={loading}
              onClick={() => setKeyVisible((value) => !value)}
            >
              {keyVisible ? "Masquer" : "Afficher"}
            </button>
          </div>
          <p className="tiny muted" style={{ margin: "6px 0 0" }}>
            Chiffrée localement, elle est envoyée directement au fournisseur OpenRouter avec chaque
            demande — jamais au serveur de l’établissement.
          </p>
          {storageUnavailable ? (
            // La clé vit en MÉMOIRE (Keystore mort) : elle disparaît à la fermeture.
            // Sans ce message, l'utilisateur croit sa clé enregistrée.
            <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
              {STORAGE_UNAVAILABLE_MESSAGE}
            </p>
          ) : null}
          {llmError ? (
            <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
              {llmError}
            </p>
          ) : null}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={loading || decidingConsent !== ""}
              onClick={() => setWithdrawAsk(true)}
            >
              Retirer mon consentement
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={loading || forgettingKey || !llmConfigured}
              onClick={() => setForgetAsk(true)}
            >
              Oublier la clé
            </button>
            <button
              type="button"
              className="btn btn--small"
              disabled={loading || savingKey || llmKey.trim() === ""}
              onClick={() => void saveKey()}
            >
              {savingKey ? "Enregistrement…" : "Enregistrer la clé"}
            </button>
          </div>
        </Card>
      ) : null}

      <Dialog
        open={forgetAsk}
        title="Oublier la clé de l’assistant ?"
        role="alertdialog"
        description="L’assistant deviendra inactif sur cet appareil. Tes cours, tes fiches et le manuel enregistré restent en place."
        busy={forgettingKey}
        onClose={() => setForgetAsk(false)}
        actions={
          <>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              data-autofocus
              disabled={forgettingKey}
              onClick={() => setForgetAsk(false)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--danger btn--small"
              disabled={forgettingKey}
              onClick={() => void forgetKey()}
            >
              {forgettingKey ? "Suppression…" : "Oublier la clé"}
            </button>
          </>
        }
      />

      <Dialog
        open={withdrawAsk}
        title="Retirer le consentement et l’attestation IA ?"
        role="alertdialog"
        description="L’assistant sera désactivé. Ton attestation d’âge ou d’autorisation parentale est retirée avec ton consentement. Ta clé OpenRouter et le fil du professeur IA seront effacés. Tes cours, tes fiches et le manuel enregistré restent sur cet appareil."
        busy={decidingConsent === "withdrawn"}
        onClose={() => setWithdrawAsk(false)}
        actions={
          <>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              data-autofocus
              disabled={decidingConsent === "withdrawn"}
              onClick={() => setWithdrawAsk(false)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--danger btn--small"
              disabled={decidingConsent === "withdrawn"}
              onClick={() => void decideConsent("withdrawn")}
            >
              {decidingConsent === "withdrawn" ? "Retrait…" : "Retirer le consentement"}
            </button>
          </>
        }
      />
    </>
  );
}
