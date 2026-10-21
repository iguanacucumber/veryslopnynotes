import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountCountLabel,
  activeAccount,
  initialsOf,
  isSafePhotoDataUrl,
  parseProfilePayload,
  profileInitials,
  profileSubtitle,
  switchableAccounts,
} from "../../web/src/features/profile/model";
import {
  buildSubjectPref,
  normalizeColorHex,
  normalizeEmoji,
  parseTheme,
  sanitizeSubjectPrefs,
  subjectNameError,
  subjectSaveRefusal,
  subjectSwatchColors,
  themeLabel,
  validateServerHost,
  SUBJECT_REFUSED_MESSAGE,
} from "../../web/src/features/settings/model";
import {
  normalizePin,
  pairErrorMessage,
  pinError,
  qrHost,
  scanErrorMessage,
  validateScannedQr,
} from "../../web/src/features/pairing/model";

useParisTz();

const USER = {
  accountId: "acc-fake-1",
  displayName: "Camille Exemple",
  firstName: "Camille",
  lastName: "Exemple",
  classLabel: "3E-Fake",
  periodName: "Trimestre 1",
  photoRef: "photo:file-fake-1",
  hasKids: false,
  kids: [],
};

describe("profil : lecture défensive et comptes", () => {
  test("payload conforme, user absent/null ou mal formé = null", () => {
    const profile = parseProfilePayload(JSON.stringify({ user: USER }));
    expect(profile).toEqual(USER);
    expect(parseProfilePayload(JSON.stringify({ user: null }))).toBeNull();
    expect(parseProfilePayload(JSON.stringify({}))).toBeNull();
    expect(parseProfilePayload("pas-du-json")).toBeNull();
    expect(parseProfilePayload("null")).toBeNull();
    expect(parseProfilePayload(null)).toBeNull();
    // Le mock du pont enveloppe le profil dans `{ user }` : même forme.
    expect(parseProfilePayload(JSON.stringify({ user: { ...USER, photoRef: "" } }))?.displayName).toBe("Camille Exemple");
    // Espaces rognés, jamais rendus tels quels.
    expect(parseProfilePayload(JSON.stringify({ user: { ...USER, displayName: "  Camille Exemple  " } }))?.displayName).toBe(
      "Camille Exemple",
    );
  });

  test("bornes du contrat : nom vide/trop long, photo distante, enfant invalide", () => {
    expect(parseProfilePayload(JSON.stringify({ user: { ...USER, accountId: "" } }))).toBeNull();
    expect(parseProfilePayload(JSON.stringify({ user: { ...USER, displayName: "   " } }))).toBeNull();
    expect(parseProfilePayload(JSON.stringify({ user: { ...USER, displayName: "x".repeat(65) } }))).toBeNull();
    expect(parseProfilePayload(JSON.stringify({ user: { ...USER, photoRef: "https://photo.invalid/p.png" } }))).toBeNull();
    expect(parseProfilePayload(JSON.stringify({ user: { ...USER, photoRef: "photo:ok-file_1" } }))?.photoRef).toBe(
      "photo:ok-file_1",
    );
    const kid = { accountId: "acc-kid-1", displayName: "Noé Exemple", classLabel: "6E-Fake" };
    expect(parseProfilePayload(JSON.stringify({ user: { ...USER, hasKids: true, kids: [kid] } }))?.kids).toEqual([kid]);
    expect(
      parseProfilePayload(JSON.stringify({ user: { ...USER, kids: [{ ...kid, displayName: " " }] } })),
    ).toBeNull();
    expect(
      parseProfilePayload(
        JSON.stringify({ user: { ...USER, kids: Array.from({ length: 9 }, (_, i) => ({ ...kid, accountId: `k${i}` })) } }),
      ),
    ).toBeNull();
  });

  test("libellé de période : la borne du contrat, pas celle du nom (#420)", () => {
    // Le natif publie jusqu'à 100 caractères : le web ne tronque plus le
    // profil (borne partagée : `USER_PERIOD_NAME_MAX_CHARS`).
    const long = "Trimestre 1 — année scolaire 2026-2027";
    expect(parseProfilePayload(JSON.stringify({ user: { ...USER, periodName: long } }))?.periodName).toBe(long);
    expect(parseProfilePayload(JSON.stringify({ user: { ...USER, periodName: "P".repeat(100) } }))?.periodName).toHaveLength(
      100,
    );
    expect(parseProfilePayload(JSON.stringify({ user: { ...USER, periodName: "P".repeat(101) } }))).toBeNull();
  });

  test("initiales, sous-titre et compteur", () => {
    expect(profileInitials({ displayName: "Camille Exemple" })).toBe("CE");
    expect(initialsOf("JEAN-PIERRE DUPONT")).toBe("JP");
    expect(initialsOf("  ")).toBe("?");
    expect(profileSubtitle({ classLabel: "3E", periodName: "Trimestre 1" })).toBe("3E · Trimestre 1");
    expect(profileSubtitle({ classLabel: "", periodName: "Trimestre 1" })).toBe("Trimestre 1");
    expect(profileSubtitle({ classLabel: "", periodName: "" })).toBe("");
    expect(accountCountLabel(0)).toBe("Aucun compte appairé");
    expect(accountCountLabel(1)).toBe("1 compte appairé");
    expect(accountCountLabel(4)).toBe("4 comptes appairés");
    expect(accountCountLabel(Number.NaN)).toBe("Aucun compte appairé");
  });

  test("sélecteur : session d'abord, enfants sans doublon, plafond", () => {
    const parent = parseProfilePayload(
      JSON.stringify({
        user: {
          ...USER,
          hasKids: true,
          kids: [
            { accountId: "acc-kid-1", displayName: "Camille Exemple", classLabel: "3E-Fake" },
            { accountId: "acc-fake-1", displayName: "Doublon session", classLabel: "" },
          ],
        },
      }),
    );
    const accounts = switchableAccounts(parent);
    expect(accounts.map((account) => account.accountId)).toEqual(["acc-fake-1", "acc-kid-1"]);
    expect(activeAccount(accounts, "acc-kid-1")?.displayName).toBe("Camille Exemple");
    expect(activeAccount(accounts, null)?.accountId).toBe("acc-fake-1");
    expect(activeAccount(accounts, "acc-inconnu")?.accountId).toBe("acc-fake-1");
    expect(activeAccount([], "acc-fake-1")).toBeNull();
    expect(switchableAccounts(null)).toEqual([]);

    const many = parseProfilePayload(
      JSON.stringify({
        user: {
          ...USER,
          hasKids: true,
          kids: Array.from({ length: 8 }, (_, i) => ({ accountId: `k${i}`, displayName: `Enfant ${i}`, classLabel: "" })),
        },
      }),
    );
    expect(switchableAccounts(many)).toHaveLength(9);
  });

  test("photo : data URL bitmap seulement, jamais une URL distante ou un SVG", () => {
    expect(isSafePhotoDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isSafePhotoDataUrl("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
    expect(isSafePhotoDataUrl("https://photo.invalid/p.png")).toBe(false);
    expect(isSafePhotoDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isSafePhotoDataUrl("data:image/png;base64,")).toBe(false);
    expect(isSafePhotoDataUrl(null)).toBe(false);
  });
});

describe("réglages : validation de l'adresse et des matières", () => {
  test("adresse du serveur : hôte seul, URL, loopback et refus", () => {
    expect(validateServerHost("10.0.2.2:3000")).toEqual({ ok: true, value: "10.0.2.2:3000" });
    expect(validateServerHost("https://Example.ORG/")).toEqual({ ok: true, value: "https://example.org" });
    expect(validateServerHost("https://example.org:8443")).toEqual({ ok: true, value: "https://example.org:8443" });
    expect(validateServerHost("http://localhost:3000")).toEqual({ ok: true, value: "http://localhost:3000" });
    expect(validateServerHost("http://127.0.0.1:8080")).toEqual({ ok: true, value: "http://127.0.0.1:8080" });
    expect(validateServerHost("https://[::1]:8443")).toEqual({ ok: true, value: "https://[::1]:8443" });

    for (const raw of [
      "",
      "   ",
      "ftp://example.org",
      "http://example.org",
      "https://user:pass@example.org",
      "https://example.org/path",
      "https://example.org?x=1",
      "https://example.org#ancre",
      "example.org:0",
      "example.org:70000",
      "https://999.1.1.1",
      "https://exa mple.org",
      "https://[::1",
      "https://example.org.",
    ]) {
      expect({ raw, ok: validateServerHost(raw).ok }).toEqual({ raw, ok: false });
    }
    const tooLong = `https://${"a".repeat(300)}.org`;
    expect(validateServerHost(tooLong).ok).toBe(false);
  });

  test("thème : valeur inconnue = Système", () => {
    expect(parseTheme("DARK")).toBe("DARK");
    expect(parseTheme("LIGHT")).toBe("LIGHT");
    expect(parseTheme("inconnu")).toBe("SYSTEM");
    expect(parseTheme(null)).toBe("SYSTEM");
    expect(themeLabel("DARK")).toBe("Sombre");
  });

  test("matières : bornes, couleur normalisée, brouillon propre", () => {
    expect(subjectNameError("")).toBeNull();
    expect(subjectNameError("x".repeat(64))).toBeNull();
    expect(subjectNameError("x".repeat(65))).toContain("64");
    expect(normalizeColorHex(" #aabbcc ")).toBe("#AABBCC");
    expect(normalizeColorHex("#ABC")).toBeNull();
    expect(normalizeEmoji(" 📘 ")).toBe("📘");
    expect(normalizeEmoji("x".repeat(9))).toBeNull();

    expect(buildSubjectPref("  Maths  ", { color: "#aabbcc", emoji: " 📐 ", label: "  Mathématiques  " })).toEqual({
      subject: "Maths",
      color: "#AABBCC",
      emoji: "📐",
      label: "Mathématiques",
    });
    expect(buildSubjectPref("Maths", { color: "rouge", emoji: "", label: "" })).toEqual({
      subject: "Maths",
      color: null,
      emoji: null,
      label: null,
    });
    expect(buildSubjectPref("", { color: "", emoji: "", label: "" })).toBeNull();
    expect(buildSubjectPref("x".repeat(65), { color: "", emoji: "", label: "" })).toBeNull();
    expect(subjectSwatchColors("#AABBCC")).toContain("#AABBCC");
    expect(subjectSwatchColors("#123456")).toContain("#123456");
  });

  // #395 : le natif refuse une matière hors contrat et ne dit PAS « ok ».
  // L'interface doit montrer le refus, jamais « Matière enregistrée. ».
  test("enregistrement d'une matière : un refus est montré, pas avalé", () => {
    expect(subjectSaveRefusal({ ok: true })).toBeNull();
    expect(subjectSaveRefusal({ ok: true, prefs: [] })).toBeNull();
    expect(subjectSaveRefusal({ ok: false, message: "Couleur invalide : attends #RRGGBB." })).toBe(
      "Couleur invalide : attends #RRGGBB.",
    );
    // Sans message (ou message vide), un repli clair — jamais « enregistré ».
    expect(subjectSaveRefusal({ ok: false })).toBe(SUBJECT_REFUSED_MESSAGE);
    expect(subjectSaveRefusal({ ok: false, message: "   " })).toBe(SUBJECT_REFUSED_MESSAGE);
    expect(SUBJECT_REFUSED_MESSAGE).toContain("Matière refusée");
  });

  test("liste du bridge : formes invalides ignorées, jamais rendues", () => {
    const prefs = sanitizeSubjectPrefs([
      { subject: " Maths ", color: "#aabbcc", emoji: "📐", label: "Maths" },
      { subject: "", color: "#fff" },
      { subject: "NSI", color: "rouge", emoji: "trop-long-emoji", label: "" },
      null,
      "texte",
      { subject: "Philo", label: "x".repeat(65) },
    ]);
    expect(prefs).toEqual([
      { subject: "Maths", color: "#AABBCC", emoji: "📐", label: "Maths" },
      { subject: "NSI", color: null, emoji: null, label: null },
      { subject: "Philo", color: null, emoji: null, label: null },
    ]);
    expect(sanitizeSubjectPrefs(undefined)).toEqual([]);
  });
});

describe("appairage : hôte affichable, PIN et codes d'échec", () => {
  test("seul l'hôte est affichable, jamais le jeton ni les identifiants", () => {
    const host = qrHost("https://pronote.etab.invalid/pronote.html?jeton=SECRET");
    expect(host).toBe("pronote.etab.invalid");
    expect(host).not.toContain("SECRET");
    expect(qrHost("https://user:pass@pronote.etab.invalid/")).toBe("pronote.etab.invalid");
    expect(qrHost("https://[::1]:8443/x")).toBe("[::1]");
    expect(qrHost("ftp://pronote.etab.invalid")).toBe("");
    expect(qrHost("pas une url")).toBe("");
    expect(qrHost("")).toBe("");
  });

  test("QR scanné : trois champs bornés et une adresse lisible", () => {
    expect(validateScannedQr({ login: " l ", jeton: " j ", url: "https://a.invalid/x" })).toEqual({
      login: "l",
      jeton: "j",
      url: "https://a.invalid/x",
    });
    expect(validateScannedQr(null)).toBeNull();
    expect(validateScannedQr({ login: "", jeton: "j", url: "https://a.invalid" })).toBeNull();
    expect(validateScannedQr({ login: "l", jeton: "j", url: "pas-une-url" })).toBeNull();
    expect(validateScannedQr({ login: "l", jeton: "j", url: "https://a.invalid" })).not.toBeNull();
    expect(validateScannedQr({ login: "x".repeat(1025), jeton: "j", url: "https://a.invalid" })).toBeNull();
    expect(validateScannedQr({ login: "l", jeton: "j", url: `https://${"a".repeat(299)}.invalid` })).toBeNull();
  });

  test("PIN : requis, borné à 64, rogné avant envoi", () => {
    expect(normalizePin("  1234  ")).toBe("1234");
    expect(pinError("")).toContain("obligatoire");
    expect(pinError("   ")).toContain("obligatoire");
    expect(pinError("1".repeat(64))).toBeNull();
    expect(pinError("1".repeat(65))).toContain("64");
    expect(normalizePin("1".repeat(65)).length).toBe(65);
  });

  test("codes natifs -> phrases actionnables, inconnu -> repli", () => {
    expect(pairErrorMessage("qr_rejected")).toContain("rescane");
    expect(pairErrorMessage("mfa_required")).toContain("vérification supplémentaire");
    expect(pairErrorMessage("login_refused")).toContain("Compte refusé");
    expect(pairErrorMessage("school_unreachable")).toContain("ne répond pas");
    expect(pairErrorMessage("network")).toContain("Réseau");
    expect(pairErrorMessage("bad_request")).toContain("PIN");
    expect(pairErrorMessage(undefined)).toContain("Appairage impossible");
    expect(pairErrorMessage("code_inconnu")).toContain("rescane");
    expect(scanErrorMessage(true)).toContain("annulé");
    expect(scanErrorMessage(false)).toContain("Aucun QR lu");
  });

  test("aucun secret persisté ni journalisé dans les écrans", () => {
    const root = join(import.meta.dir, "..", "..", "web", "src", "features");
    const files = ["pairing/PairingScreen.tsx", "profile/ProfileScreen.tsx", "settings/SettingsScreen.tsx"];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      expect({ file, localStorage: source.includes("localStorage") }).toEqual({ file, localStorage: false });
      expect({ file, sessionStorage: source.includes("sessionStorage") }).toEqual({ file, sessionStorage: false });
      expect({ file, console: /console\.(?:log|info|debug|warn|error)/.test(source) }).toEqual({ file, console: false });
    }
    const pairing = readFileSync(join(root, "pairing", "PairingScreen.tsx"), "utf8");
    expect(pairing).toContain("type=\"password\"");
    expect(pairing).toContain("qrHost(");
    expect(pairing).not.toContain("qr.jeton");
  });
});
