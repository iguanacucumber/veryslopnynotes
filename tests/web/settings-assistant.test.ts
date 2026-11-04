import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AI_CONSENT_VERSION } from "../../web/src/features/assistant/consent";
import { assistantStatus } from "../../web/src/features/settings/model";

const WEB = join(import.meta.dir, "..", "..", "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = text.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe("réglages — une seule section Assistant (#612)", () => {  const settings = source("features/settings/SettingsScreen.tsx");
  const overview = source("features/settings/AssistantOverviewCard.tsx");
  const keyCard = source("features/settings/AssistantCards.tsx");
  const manual = source("features/settings/ManualCard.tsx");
  const server = source("features/settings/ServerCard.tsx");
  const advancedSection = source("features/settings/AdvancedSection.tsx");

  test("l'ordre Apparence, Matières, Assistant, Avancé remplace la section Sécurité", () => {
    expect(settings).not.toContain('title="Sécurité"');
    const order = [
      settings.search(/<Section[^>]*title="Apparence"/),
      settings.search(/<Section[^>]*title="Matières"/),
      settings.search(/<Section[^>]*title="Assistant"/),
      settings.indexOf("<AdvancedSection"),
    ];
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Une seule section Assistant : la configuration IA n'est pas éparpillée.
    expect(settings.match(/<Section[^>]*title="Assistant"/g)).toHaveLength(1);
  });

  test("clé dans Assistant, manuel et scraper dans Avancé", () => {
    const assistant = between(settings, 'title="Assistant"', "<AdvancedSection");
    expect(assistant).toContain("<AssistantCards");
    expect(assistant).not.toContain("<ManualCard");
    expect(assistant).not.toContain("<ServerCard");
    expect(keyCard).toContain('id="llm-key"');
    expect(manual).toContain('id="manual-url"');
    expect(manual).not.toContain('id="server-host"');
    expect(overview).toContain("assistantStatus(");
    expect(overview).toContain("configured: boolean | null");

    const advanced = settings.slice(settings.indexOf("<AdvancedSection"));
    expect(advanced).toContain("<ManualCard");
    expect(advanced).toContain("<ServerCard");
    expect(advanced).toContain("<SelfHostingNotice");
    expect(server).toContain('id="server-host"');
    expect(server).toContain("Scraper de manuels (facultatif)");
    expect(server).not.toContain('id="manual-url"');
  });

  test("la tuile Avancé ancre vers une section qui dégage la barre", () => {
    expect(settings).toContain('target: "reglages-avance"');
    expect(advancedSection).toContain('id="reglages-avance"');
    const css = source("features/settings/settings.css");
    expect(css).toContain("scroll-margin-top");
    expect(css).toContain("56px");
  });

  test("un instantané en erreur n'est ni « Aucune clé » ni des valeurs lues (I14)", () => {
    // `null` = instantané non lu : le titre ne prétend rien sur la clé.
    const granted = ["granted", AI_CONSENT_VERSION, true] as const;
    expect(assistantStatus(null, false, false, ...granted).title).not.toBe("Aucune clé");
    expect(assistantStatus(null, false, false, ...granted).title).toContain("inconnu");
    expect(assistantStatus(null, false, true, ...granted).title).toContain("Lecture");
    // Seuls les états LUS disent « aucune clé » ou « actif ».
    expect(assistantStatus(false, false, false, ...granted).title).toBe("Aucune clé");
    expect(assistantStatus(true, false, false, ...granted).title).toBe("Assistant actif");
    // Le manuel part vide avant lecture : aucune adresse préremplie.
    expect(manual).toContain('useState("")');
    expect(manual).toContain("Réglages non lus");
  });

  test("Cahier et Fiches sont atteignables depuis Assistant", () => {
    expect(overview).toContain("useViewNavigate");
    expect(overview).toContain('navigate("/course-notes")');
    expect(overview).toContain('navigate("/revision-sheets")');
  });

  test("oublier la clé passe par une confirmation destructive", () => {
    const forget = keyCard.slice(keyCard.indexOf("async function forgetKey()"));
    expect(forget).toContain("bridge.forgetLlmKey()");
    expect(forget).toContain("setForgetAsk(false)");
    // Le bouton de la carte ouvre le dialogue ; il n'appelle jamais le pont.
    expect(keyCard).toContain("onClick={() => setForgetAsk(true)}");
    expect(keyCard.match(/void forgetKey\(\)/g)).toHaveLength(1);

    const dialog = between(keyCard, "<Dialog", "/>");
    expect(dialog).toContain('role="alertdialog"');
    expect(dialog).toContain("void forgetKey()");
    expect(dialog).toContain("btn--danger");
    expect(dialog).toContain("Oublier la clé");
  });

  test("la copie dit où part la clé sans promettre le contraire", () => {
    expect(keyCard).toContain("Clé OpenRouter");
    expect(keyCard).toContain("llmSaveError(response)");
    expect(keyCard).toContain("MAX_API_KEY_CHARS");
    expect(keyCard).toContain("directement au");
    expect(keyCard).not.toContain("ne quitte jamais cet appareil");
  });

  test("le consentement précède la clé : accepter, refuser, retirer (#848)", () => {
    expect(keyCard).toContain("AI_CONSENT_ITEMS.map");
    expect(keyCard).toContain("aiConsentGranted(consent, consentVersion, ageAttested)");
    expect(keyCard).toContain("!consentGranted");
    expect(keyCard).toContain('decideConsent("granted")');
    expect(keyCard).toContain('decideConsent("refused")');
    expect(keyCard).toContain('decideConsent("withdrawn")');
    expect(keyCard).toContain("bridge.setAiConsent");
    // Le champ de clé n'existe que dans la branche « accord donné ».
    expect(keyCard.indexOf("{consentGranted ? (")).toBeLessThan(keyCard.indexOf('id="llm-key"'));
    expect(keyCard.indexOf('id="llm-key"')).toBeLessThan(keyCard.indexOf("Retirer mon consentement"));
  });

  test("l'attestation d'âge précède le bouton d'accord et la clé (#849)", () => {
    expect(keyCard).toContain("<AgeAttestation");
    expect(keyCard).toContain("checked={attestationChecked}");
    expect(keyCard).toContain("!attestationChecked");
    expect(keyCard).toContain("AI_AGE_ATTESTATION_REQUIRED");
    // La case est rendue AVANT les boutons ; accepter reste désactivé sans elle.
    expect(keyCard.indexOf("<AgeAttestation")).toBeLessThan(keyCard.indexOf('decideConsent("granted")'));
    const acceptDisabled = keyCard.indexOf(
      'disabled={loading || decidingConsent !== "" || !attestationChecked}',
    );
    const acceptClick = keyCard.indexOf('onClick={() => void decideConsent("granted")}');
    expect(acceptDisabled).toBeGreaterThan(-1);
    expect(acceptDisabled).toBeLessThan(acceptClick);
    // Le pont reçoit l'attestation avec la décision, jamais une clé seule.
    expect(keyCard).toContain("bridge.setAiConsent(");
    expect(keyCard).toContain('decision === "granted" && attestationChecked');
    expect(keyCard).toContain("setAgeAttested(response.ageAttested === true)");
  });

  test("un accord d'une autre version ou sans attestation redemande l'accord (#860, #849)", () => {
    const stale = assistantStatus(true, false, false, "granted", AI_CONSENT_VERSION + 1, true);
    expect(stale.title).toBe("Consentement IA à renouveler");
    expect(stale.body).toContain("reste désactivé");
    expect(assistantStatus(true, false, false, "granted", AI_CONSENT_VERSION, true).title).toBe(
      "Assistant actif",
    );
    expect(assistantStatus(true, false, false, "refused", AI_CONSENT_VERSION, true).title).toBe(
      "Assistant IA désactivé",
    );
    const unattested = assistantStatus(true, false, false, "granted", AI_CONSENT_VERSION, false);
    expect(unattested.title).toBe("Attestation IA à confirmer");
    expect(unattested.body).toContain("reste désactivé");
    expect(keyCard).toContain("aiConsentNeedsReconsent(decision, version, ageAttested)");
    // Le pont factice suit la même version que l'écran, sans littéral recopié.
    const mock = source("bridge/mock.ts");
    expect(mock).toContain("aiConsentVersion: AI_CONSENT_VERSION");
    expect(mock).not.toMatch(/aiConsentVersion:\s*[1-9]/);
    expect(mock).toContain("aiAgeAttested");
  });

  test("les matières personnalisées chargent avant d'affirmer qu'il n'y en a aucune (#804)", () => {
    const card = source("features/settings/SubjectPrefsCard.tsx");
    expect(card).toContain("Lecture des matières…");
    expect(card).toContain("setLoaded(true)");
    // Le message vide est gardé par la première lecture terminée.
    expect(card).toContain("loaded && prefs.length === 0");
  });

  test("le manuel garde son pont et affiche une puce de statut", () => {
    expect(manual).toContain("Automatique");
    expect(manual).toContain("Prêt");
    expect(manual).toContain("Non récupéré");
    expect(manual).toContain("bridge.saveManualUrl(value)");
    expect(manual).toContain('bridge.saveManualUrl("")');
    expect(manual).toContain("MANUAL_RIGHTS_ATTESTATION");
    expect(manual).toContain("manualCanSave(");
    expect(manual).toContain("MAX_MANUAL_URL_CHARS");
  });
});

describe("profil — assistant découvrable (#612)", () => {
  const profile = source("features/profile/ProfileScreen.tsx");

  test("une section Assistant avant Ressources porte Cahier et Fiches", () => {
    expect(profile.indexOf('<Section title="Assistant">')).toBeGreaterThan(-1);
    expect(profile.indexOf('<Section title="Assistant">')).toBeLessThan(
      profile.indexOf('<Section title="Ressources">'),
    );

    const assistant = between(profile, '<Section title="Assistant">', '<Section title="Ressources">');
    expect(assistant).toContain('title="Cahier de cours"');
    expect(assistant).toContain("Tes cours, sources de l’assistant");
    expect(assistant).toContain('title="Fiches de révision"');
    expect(assistant).toContain("Générées depuis un devoir");
    expect(assistant).toContain("<IconBook");
    expect(assistant).toContain("<IconSparkles");
    expect(assistant).toContain('navigate("/course-notes")');
    expect(assistant).toContain('navigate("/revision-sheets")');
  });

  test("la copie de déconnexion correspond à ce qui est purgé (I16)", () => {
    const dialog = profile.slice(profile.indexOf('title="Se déconnecter"'));
    // Matières personnalisées et manuel partent avec le compte ; seule la clé
    // de l'assistant survit (OfflineCache.clearAll + Manuals.clearAccountData).
    expect(dialog).toContain("matières personnalisées");
    expect(dialog).toContain("manuel enregistré");
    expect(dialog).toContain("seule la clé de l’assistant reste");
    expect(dialog).not.toContain("préférences et la clé");
  });

  test("Ressources garde les quatre entrées scolaires, sans doublon assistant", () => {
    const resources = between(profile, '<Section title="Ressources">', '<Section title="Réglages">');
    expect(resources).toContain('navigate("/messages")');
    expect(resources).toContain('navigate("/news")');
    expect(resources).toContain('navigate("/canteen")');
    expect(resources).toContain('navigate("/attendance")');
    expect(resources).not.toContain('navigate("/course-notes")');
    expect(resources).not.toContain('navigate("/revision-sheets")');
  });
});
