import { useEffect, useState } from "react";
import { bridge } from "../../bridge/client";
import { BridgeCallError, type SubjectPref } from "../../bridge/types";
import { schemeLabel } from "../../lib/schemes";
import { STORAGE_UNAVAILABLE_MESSAGE } from "../../lib/session";
import { useApp } from "../../ui/AppContext";
import {
  Card,
  Divider,
  ErrorBox,
  ListRow,
  Loading,
  Page,
  Section,
  SubjectBadge,
} from "../../ui/components";
import { Dialog } from "../../ui/Dialog";
import { IconBook, IconSettings, IconSparkles } from "../../ui/icons";
import { useViewNavigate } from "../../ui/viewTransition";
import { SchemePicker } from "./SchemePicker";
import { SubjectEditor } from "./SubjectEditor";
import {
  DEFAULT_MANUAL_URL,
  MAX_API_KEY_CHARS,
  MAX_MANUAL_URL_CHARS,
  THEME_OPTIONS,
  llmSaveError,
  sanitizeSubjectPrefs,
  subjectNameError,
  subjectSaveRefusal,
  themeLabel,
  validateServerHost,
} from "./model";
import "./settings.css";

function actionMessage(error: unknown, fallback: string): string {
  if (error instanceof BridgeCallError) {
    if (error.code === "auth_required") {
      window.dispatchEvent(new Event("vsn:auth"));
      return "Session expirée : rescane le QR de l'établissement.";
    }
    if (error.code === "unavailable") return "Téléphone injoignable : réessaie dans un instant.";
  }
  return fallback;
}

function subjectInitial(subject: string): string {
  return subject.trim().charAt(0).toUpperCase() || "?";
}

export default function SettingsScreen() {
  const { theme, setTheme, scheme, setScheme, refreshTick, notify, storageUnavailable, dark } = useApp();
  const navigate = useViewNavigate();
  const [host, setHost] = useState("");
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [reload, setReload] = useState(0);

  const [hostError, setHostError] = useState("");
  const [hostSaved, setHostSaved] = useState("");
  const [savingHost, setSavingHost] = useState(false);

  const [manualUrl, setManualUrl] = useState(DEFAULT_MANUAL_URL);
  const [manualConfigured, setManualConfigured] = useState(false);
  const [manualAuto, setManualAuto] = useState(false);
  const [manualReady, setManualReady] = useState(false);
  const [manualLevel, setManualLevel] = useState("");
  const [manualSpecialties, setManualSpecialties] = useState<string[]>([]);
  const [manualError, setManualError] = useState("");
  const [manualNotice, setManualNotice] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  const [prefs, setPrefs] = useState<SubjectPref[]>([]);
  const [prefsError, setPrefsError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editorError, setEditorError] = useState("");
  const [savingSubject, setSavingSubject] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [llmKey, setLlmKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [llmError, setLlmError] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [forgetAsk, setForgetAsk] = useState(false);
  const [forgettingKey, setForgettingKey] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSettingsError("");
    setPrefsError("");
    void (async () => {
      const [settingsResult, prefsResult] = await Promise.allSettled([bridge.settings(), bridge.subjectPrefs()]);
      if (!alive) return;
      if (settingsResult.status === "fulfilled") {
        const snapshot = settingsResult.value;
        setHost(typeof snapshot.serverHost === "string" ? snapshot.serverHost : "");
        setLlmConfigured(snapshot.llmConfigured === true);
        setManualUrl(
          typeof snapshot.manualUrl === "string" && snapshot.manualUrl !== ""
            ? snapshot.manualUrl
            : DEFAULT_MANUAL_URL,
        );
        setManualConfigured(snapshot.manualConfigured === true);
        setManualAuto(snapshot.manualAuto === true);
        setManualReady(snapshot.manualReady === true);
        setManualLevel(typeof snapshot.manualLevel === "string" ? snapshot.manualLevel : "");
        setManualSpecialties(Array.isArray(snapshot.manualSpecialties) ? snapshot.manualSpecialties : []);
      } else {
        setSettingsError(actionMessage(settingsResult.reason, "Réglages indisponibles : réessaie dans un instant."));
      }
      if (prefsResult.status === "fulfilled") {
        setPrefs(sanitizeSubjectPrefs(prefsResult.value?.prefs));
      } else {
        setPrefsError(actionMessage(prefsResult.reason, "Préférences de matières indisponibles."));
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [refreshTick, reload]);

  async function saveHost(): Promise<void> {
    setHostSaved("");
    const result = validateServerHost(host);
    if (!result.ok) {
      setHostError(result.message);
      return;
    }
    setHostError("");
    setSavingHost(true);
    try {
      const response = await bridge.saveServer(result.value);
      if (!response.ok) {
        setHostError("Adresse refusée : vérifie le domaine et le port.");
        return;
      }
      setHost(result.value);
      setHostSaved("Adresse du serveur enregistrée.");
      notify("Adresse du serveur enregistrée.");
    } catch (error) {
      setHostError(actionMessage(error, "Adresse non enregistrée : réessaie dans un instant."));
    } finally {
      setSavingHost(false);
    }
  }

  async function saveManual(): Promise<void> {
    const value = manualUrl.trim();
    if (value === "") {
      setManualError("Colle l'adresse de ton manuel avant d'enregistrer.");
      return;
    }
    setManualError("");
    setManualNotice("");
    setSavingManual(true);
    try {
      const response = await bridge.saveManualUrl(value);
      if (!response.ok) {
        setManualError(response.message || "Adresse refusée : vérifie-la.");
        return;
      }
      setManualUrl(value);
      setManualConfigured(true);
      setManualAuto(response.auto === true);
      setManualReady(response.ready === true);
      setManualLevel(typeof response.level === "string" ? response.level : "");
      setManualSpecialties(Array.isArray(response.specialties) ? response.specialties : []);
      if (response.auto === true) {
        const guess = [response.level ?? "", (response.specialties ?? []).join(", ")]
          .map((part) => part.trim())
          .filter((part) => part !== "")
          .join(" · ");
        const notice =
          guess === ""
            ? "Manuel automatique activé : l’ouvrage suivra la matière du devoir."
            : `Manuel automatique activé (${guess}).`;
        setManualNotice(notice);
        notify(notice);
      } else {
        const notice = response.ready
          ? "Manuel récupéré : l'assistant peut le citer."
          : response.message || "Adresse enregistrée, mais le manuel n'a pas pu être récupéré.";
        setManualNotice(notice);
        notify(notice, response.ready ? "info" : "error");
      }
    } catch (error) {
      setManualError(actionMessage(error, "Manuel non enregistré : réessaie dans un instant."));
    } finally {
      setSavingManual(false);
    }
  }

  async function forgetManual(): Promise<void> {
    setManualError("");
    setManualNotice("");
    setSavingManual(true);
    try {
      const response = await bridge.saveManualUrl("");
      if (!response.ok) {
        setManualError(response.message || "Manuel non supprimé : réessaie dans un instant.");
        return;
      }
      setManualUrl(DEFAULT_MANUAL_URL);
      setManualConfigured(false);
      setManualAuto(false);
      setManualReady(false);
      setManualLevel("");
      setManualSpecialties([]);
      setManualNotice("Manuel oublié.");
      notify("Manuel oublié.");
    } catch (error) {
      setManualError(actionMessage(error, "Manuel non supprimé : réessaie dans un instant."));
    } finally {
      setSavingManual(false);
    }
  }

  async function saveKey(): Promise<void> {
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
    // #612 : la suppression ne part que du dialogue de confirmation.
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

  async function saveSubject(next: SubjectPref): Promise<void> {
    setEditorError("");
    setSavingSubject(true);
    try {
      const response = await bridge.saveSubject(next);
      // #395 : le natif peut REFUSER la matière (couleur, emoji ou libellé
      // hors contrat) : rien n'est alors écrit. On montre le refus, on ne
      // dit JAMAIS « Matière enregistrée. ».
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
  const manualGuess = [manualLevel, manualSpecialties.join(", ")]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" · ");
  const manualStatus = manualAuto ? "Automatique" : manualReady ? "Prêt" : "Non récupéré";

  return (
    <Page>
      {loading ? <Loading label="Lecture des réglages…" /> : null}

      {settingsError ? (
        <ErrorBox message={settingsError}>
          <button type="button" className="btn btn--small" onClick={() => setReload((n) => n + 1)}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      <Section title="Apparence">
        <Card className="card--flat">
          <div className="row row--wrap" role="group" aria-label="Thème de l'application">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`chip${theme === option.value ? " chip--active" : ""}`}
                aria-pressed={theme === option.value}
                onClick={() => setTheme(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="tiny muted" style={{ margin: "8px 0 0" }}>
            Thème actuel : {themeLabel(theme)}.
          </p>

          <Divider />

          <p className="tiny muted" style={{ margin: "10px 0 0" }}>
            Palette
          </p>
          <SchemePicker value={scheme} onChange={setScheme} />
          <p className="tiny muted" style={{ margin: "8px 0 0" }}>
            Palette actuelle : {schemeLabel(scheme)} — chaque palette a sa variante claire et sombre.
          </p>
        </Card>
      </Section>

      <Section title="Matières">
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
                onClick={() => setReload((n) => n + 1)}
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
      </Section>

      <Section title="Assistant">
        <Card className="card--flat">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <span className="settings-assistant__icon" aria-hidden="true">
              <IconSparkles size={20} />
            </span>
            <div className="grow">
              <strong style={{ display: "block" }}>{llmConfigured ? "Assistant actif" : "Aucune clé"}</strong>
              <p className="tiny muted" style={{ margin: "2px 0 0" }}>
                {llmConfigured
                  ? storageUnavailable
                    ? "Clé en mémoire seulement : elle sera oubliée à la fermeture de l'app."
                    : "Clé enregistrée (chiffrée) : l’aide devoirs et les fiches de révision sont disponibles."
                  : "Sans clé OpenRouter, l’assistant ne peut ni aider sur un devoir ni générer une fiche."}
              </p>
            </div>
          </div>

          <Divider />

          <p className="tiny muted" style={{ margin: "10px 0 6px" }}>
            Sources de l’assistant
          </p>
          <div className="row row--wrap">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => navigate("/cahier")}>
              <IconBook size={16} />
              Cahier de cours
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => navigate("/fiches")}>
              <IconSparkles size={16} />
              Fiches de révision
            </button>
          </div>
        </Card>

        <Card className="card--flat">
          <strong style={{ display: "block" }}>Connexion OpenRouter</strong>
          <label className="tiny muted" htmlFor="llm-key" style={{ display: "block", marginTop: 12 }}>
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
              placeholder={llmConfigured ? "Nouvelle clé (facultatif)" : "Colle ta clé ici"}
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
            // #401 : la clé vit en MÉMOIRE (le Keystore est mort) : elle
            // fonctionnera jusqu'à la fermeture de l'app, puis disparaîtra.
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

        <Card className="card--flat">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <strong className="grow" style={{ display: "block" }}>
              Manuel de l’élève (facultatif)
            </strong>
            {manualConfigured ? (
              <span
                className={`chip settings-manual__status${
                  manualAuto || manualReady ? " chip--active" : " settings-manual__status--warn"
                }`}
              >
                {manualStatus}
              </span>
            ) : null}
          </div>
          <p className="tiny muted" style={{ margin: "2px 0 0" }}>
            L’assistant choisit l’ouvrage selon ta classe et la matière du devoir, puis en cite un
            extrait dans l’aide devoirs et les fiches de révision. L’adresse est lue par le scraper
            facultatif, jamais par l’établissement.
          </p>
          <label className="tiny muted" htmlFor="manual-url" style={{ display: "block", marginTop: 12 }}>
            Adresse du manuel
          </label>
          <input
            id="manual-url"
            className="field"
            type="url"
            value={manualUrl}
            maxLength={MAX_MANUAL_URL_CHARS}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={loading || savingManual}
            aria-invalid={manualError !== ""}
            aria-describedby="manual-help"
            placeholder="https://manuel.exemple.fr/chapitre"
            onChange={(event) => {
              setManualUrl(event.target.value);
              setManualConfigured(false);
              setManualAuto(false);
              setManualReady(false);
              setManualNotice("");
              if (manualError) setManualError("");
            }}
          />
          <p id="manual-help" className="tiny muted" style={{ margin: "6px 0 0" }}>
            Garde l’adresse du catalogue : l’assistant choisit l’ouvrage selon ta classe et la
            matière du devoir. Tu peux aussi coller l’adresse d’un manuel précis. La récupération
            passe par le scraper facultatif des réglages avancés.
          </p>
          {manualConfigured && !manualNotice ? (
            <p
              className="tiny"
              role="status"
              style={{
                color: manualAuto || manualReady ? "var(--brand-deep)" : "var(--danger-ink)",
                margin: "6px 0 0",
              }}
            >
              {manualAuto
                ? manualGuess === ""
                  ? "Manuel automatique : l’ouvrage suivra la matière du devoir."
                  : `Manuel automatique (${manualGuess}) : l’ouvrage suivra la matière du devoir.`
                : manualReady
                  ? "Manuel récupéré : l’assistant peut le citer."
                  : "Manuel pas encore récupéré : enregistre-le pour réessayer."}
            </p>
          ) : null}
          {manualNotice ? (
            <p
              className="tiny"
              role="status"
              style={{
                color: manualAuto || manualReady ? "var(--brand-deep)" : "var(--danger-ink)",
                margin: "6px 0 0",
              }}
            >
              {manualNotice}
            </p>
          ) : null}
          {manualError ? (
            <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
              {manualError}
            </p>
          ) : null}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={loading || savingManual || !manualConfigured}
              onClick={() => void forgetManual()}
            >
              Oublier le manuel
            </button>
            <button
              type="button"
              className="btn btn--small"
              disabled={loading || savingManual || manualUrl.trim() === ""}
              onClick={() => void saveManual()}
            >
              {savingManual ? "Enregistrement…" : "Enregistrer le manuel"}
            </button>
          </div>
        </Card>
      </Section>

      <Section title="Avancé">
        <Card className="card--flat">
          <strong style={{ display: "block" }}>Scraper de manuels (facultatif)</strong>
          <p className="tiny muted" style={{ margin: "2px 0 0" }}>
            Sert uniquement à récupérer les manuels. L’établissement et l’assistant fonctionnent sans ce serveur.
          </p>
          <label className="tiny muted" htmlFor="server-host" style={{ display: "block", marginTop: 12 }}>
            Adresse du serveur
          </label>
          <input
            id="server-host"
            className="field"
            value={host}
            maxLength={300}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={loading}
            aria-invalid={hostError !== ""}
            aria-describedby="server-help"
            placeholder="https://serveur.exemple"
            onChange={(event) => {
              setHost(event.target.value);
              setHostSaved("");
              if (hostError) setHostError("");
            }}
          />
          <p id="server-help" className="tiny muted" style={{ margin: "6px 0 0" }}>
            Domaine seul ou adresse complète. HTTP n'est accepté que pour l'émulateur et la boucle locale.
          </p>
          {hostError ? (
            <p className="tiny" role="alert" style={{ color: "var(--danger-ink)", margin: "6px 0 0" }}>
              {hostError}
            </p>
          ) : null}
          {hostSaved ? (
            <p className="tiny" role="status" style={{ color: "var(--brand-deep)", margin: "6px 0 0" }}>
              {hostSaved}
            </p>
          ) : null}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
            <button
              type="button"
              className="btn btn--small"
              disabled={loading || savingHost || host.trim() === ""}
              onClick={() => void saveHost()}
            >
              {savingHost ? "Enregistrement…" : "Enregistrer l'adresse"}
            </button>
          </div>
        </Card>
      </Section>

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

      <div className="row" style={{ justifyContent: "center", color: "var(--muted)" }}>
        <IconSettings size={16} />
        <span className="tiny">Réglages enregistrés sur cet appareil</span>
      </div>
    </Page>
  );
}
