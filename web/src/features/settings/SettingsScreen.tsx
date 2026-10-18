import { useEffect, useState } from "react";
import { bridge } from "../../bridge/client";
import { BridgeCallError, type SubjectPref } from "../../bridge/types";
import { subjectColor } from "../../lib/format";
import { useApp } from "../../ui/AppContext";
import { Card, Divider, ErrorBox, Loading, Page, Section } from "../../ui/components";
import { IconChevronRight, IconLock, IconSettings, IconUser } from "../../ui/icons";
import { SubjectEditor } from "./SubjectEditor";
import {
  MAX_API_KEY_CHARS,
  THEME_OPTIONS,
  accountCountText,
  sanitizeSubjectPrefs,
  subjectNameError,
  themeLabel,
  validateServerHost,
} from "./model";

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
  const { theme, setTheme, refreshTick, notify } = useApp();
  const [host, setHost] = useState("");
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [reload, setReload] = useState(0);

  const [hostError, setHostError] = useState("");
  const [hostSaved, setHostSaved] = useState("");
  const [savingHost, setSavingHost] = useState(false);

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
        setAccountCount(
          typeof snapshot.accountCount === "number" && Number.isFinite(snapshot.accountCount)
            ? Math.max(0, Math.trunc(snapshot.accountCount))
            : null,
        );
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
      if (!response.ok) {
        setLlmError("Clé refusée : vérifie qu'elle est complète.");
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
    }
  }

  async function saveSubject(next: SubjectPref): Promise<void> {
    setEditorError("");
    setSavingSubject(true);
    try {
      const response = await bridge.saveSubject(next);
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
    <Page>
      {loading ? <Loading label="Lecture des réglages…" /> : null}

      {settingsError ? (
        <ErrorBox message={settingsError}>
          <button type="button" className="btn btn--small" style={{ marginTop: 10 }} onClick={() => setReload((n) => n + 1)}>
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
        </Card>
      </Section>

      <Section title="Serveur">
        <Card className="card--flat">
          <label className="tiny muted" htmlFor="server-host" style={{ display: "block" }}>
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

      <Section title="Matières">
        <Card className="card--flat">
          {prefsError ? (
            <div role="alert" style={{ marginBottom: 10 }}>
              <p className="t-body-m" style={{ color: "var(--danger-ink)", margin: 0 }}>
                {prefsError}
              </p>
              <button
                type="button"
                className="btn btn--ghost btn--small"
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
              const color = pref.color ?? subjectColor(pref.subject);
              const display = pref.label ?? pref.subject;
              return (
                <div key={pref.subject}>
                  <button
                    type="button"
                    onClick={() => {
                      setEditorError("");
                      setEditing(pref.subject);
                    }}
                    className="row"
                    style={{
                      width: "100%",
                      minHeight: 52,
                      padding: "8px 4px",
                      border: 0,
                      background: "transparent",
                      textAlign: "left",
                      color: "inherit",
                      borderRadius: "var(--radius-sm)",
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
                        background: color,
                        color: "#fff",
                        fontWeight: 700,
                        textShadow: "0 1px 2px rgba(0,0,0,0.45)",
                        flex: "0 0 auto",
                      }}
                    >
                      {pref.emoji ?? subjectInitial(pref.subject)}
                    </span>
                    <span className="grow">
                      <span style={{ display: "block", fontWeight: 600 }}>{display}</span>
                      {pref.label ? (
                        <span className="tiny muted" style={{ display: "block" }}>
                          {pref.subject}
                        </span>
                      ) : null}
                    </span>
                    <IconChevronRight size={18} />
                  </button>
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

      <Section title="Sécurité">
        <Card className="card--flat">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <span style={{ color: "var(--muted)" }}>
              <IconLock size={20} />
            </span>
            <div className="grow">
              <strong style={{ display: "block" }}>Assistant devoirs</strong>
              <p className="tiny muted" style={{ margin: "2px 0 0" }}>
                {llmConfigured
                  ? "Clé enregistrée (chiffrée). Elle part avec chaque demande, jamais stockée par le serveur."
                  : "Aucune clé : l'assistant reste inactif tant qu'elle n'est pas saisie."}
              </p>
            </div>
          </div>

          <label className="tiny muted" htmlFor="llm-key" style={{ display: "block", marginTop: 12 }}>
            Clé du fournisseur LLM
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
              onChange={(event) => setLlmKey(event.target.value.slice(0, MAX_API_KEY_CHARS))}
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
            Collée depuis ton compte fournisseur. Elle ne quitte jamais cet appareil.
          </p>
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
              onClick={() => void forgetKey()}
            >
              {forgettingKey ? "Suppression…" : "Oublier"}
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
      </Section>

      <Section title="Compte">
        <Card className="card--flat">
          <div className="row">
            <span style={{ color: "var(--muted)" }}>
              <IconUser size={20} />
            </span>
            <div className="grow">
              <strong style={{ display: "block" }}>Comptes appairés</strong>
              <span className="tiny muted">{accountCountText(accountCount)}</span>
            </div>
          </div>
          <p className="tiny muted" style={{ margin: "10px 0 0" }}>
            L'appairage, la déconnexion et le changement de compte sont dans l'onglet Profil. La clé de l'assistant ne
            sort jamais de l'appareil.
          </p>
        </Card>
      </Section>

      <div className="row" style={{ justifyContent: "center", color: "var(--muted)" }}>
        <IconSettings size={16} />
        <span className="tiny">Réglages enregistrés sur cet appareil</span>
      </div>
    </Page>
  );
}
