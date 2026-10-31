// Le pont ne doit JAMAIS dire « enregistré » quand rien n'est écrit : couleur,
// emoji et libellé sont validés avant écriture, jamais tronqués.
// Les VRAIES sources (`SubjectPrefRules.kt`, `SubjectPrefMessages.kt`) sont
// compilées et pilotées ; le câblage du pont est vérifié sur la source.
// Outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "SubjectPrefParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface ReadResult {
  ok: boolean;
  subject?: string;
  color?: string;
  emoji?: string;
  label?: string;
  field?: string;
  message?: string;
}

/** Lecture d'une matière par les règles RÉELLES (Kotlin exécuté). */
async function read(pref: {
  subject?: string;
  color?: string;
  emoji?: string;
  label?: string;
}): Promise<ReadResult> {
  const res = JSON.parse(
    await link!.ask({
      op: "read",
      subject: pref.subject ?? "",
      color: pref.color ?? "",
      emoji: pref.emoji ?? "",
      label: pref.label ?? "",
    }),
  ) as ReadResult;
  return res;
}

/** Le corps d'une méthode du pont (source), pour vérifier son ORDRE. */
function bridgeMethod(source: string, name: string): string {
  const start = source.indexOf(`internal fun VsnBridge.${name}(`);
  if (start < 0) return "";
  const rest = source.slice(start);
  const end = rest.indexOf("\ninternal fun ", 10);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Une constante numérique d'un miroir TypeScript. */
function tsLimit(source: string, pattern: RegExp): number {
  const match = pattern.exec(source);
  if (!match) throw new Error(`borne absente du miroir TypeScript : ${pattern}`);
  return Number(match[1]);
}

describe("pont : une matière hors contrat est refusée, pas enregistrée (#395)", () => {
  test.skipIf(skip)("une couleur invalide est refusée (et la saisie n'est pas recopiée)", async () => {
    const res = await read({ subject: "Maths", color: "red" });
    expect(res.ok).toBe(false);
    expect(res.field).toBe("COLOR");
    // La phrase dit POURQUOI, sans reprendre la saisie brute.
    expect(res.message ?? "").toContain("#RRGGBB");
    expect(res.message ?? "").not.toContain("red");
    // Rien n'est renvoyé comme matière : aucune valeur n'est enregistrée.
    expect(res.subject).toBeUndefined();
  });

  test.skipIf(skip)("une matière conforme passe et revient normalisée", async () => {
    const res = await read({
      subject: "  Maths  ",
      color: " #AABBCC ",
      emoji: " 📘 ",
      label: "  Mathématiques  ",
    });
    expect(res.ok).toBe(true);
    expect(res.subject).toBe("Maths");
    expect(res.color).toBe("#AABBCC");
    expect(res.emoji).toBe("📘");
    expect(res.label).toBe("Mathématiques");
  });

  test.skipIf(skip)("une matière sans couleur ni emoji reste conforme", async () => {
    const res = await read({ subject: "Maths" });
    expect(res.ok).toBe(true);
    expect(res.color).toBe("");
    expect(res.emoji).toBe("");
    expect(res.label).toBe("");
  });

  test.skipIf(skip)("les entrées sont BORNÉES : rien de 256 Ko ne passe", async () => {
    // Frontière de confiance (I10) : couleur, emoji ou libellé démesurés sont REFUSÉS.
    const huge = "x".repeat(256 * 1024);
    expect((await read({ subject: "Maths", color: huge })).field).toBe("COLOR");
    expect((await read({ subject: "Maths", label: huge })).field).toBe("LABEL");
    expect((await read({ subject: huge })).field).toBe("SUBJECT");
    // Un libellé de 64 Ko ne passe pas non plus.
    expect((await read({ subject: "Maths", label: "x".repeat(64 * 1024) })).ok).toBe(false);
  });

  test.skipIf(skip)("les bornes sont celles du contrat (64 / 8 / 64)", async () => {
    const limits = JSON.parse(await link!.ask({ op: "limits" })) as Record<string, number>;
    expect(limits["subject"]).toBe(64);
    expect(limits["emoji"]).toBe(8);
    expect(limits["label"]).toBe(64);
    expect(limits["color"]).toBe(7);
  });

  test.skipIf(skip)("l'emoji est compté en POINTS DE CODE (8 emoji = 8 points)", async () => {
    const huit = "📘📗📙📕📓📔📚📖";
    const neuf = huit + "📙";
    // Huit emoji = 16 unités UTF-16 : un compte en `length` refuserait à tort.
    expect((await read({ subject: "Maths", emoji: huit })).ok).toBe(true);
    expect((await read({ subject: "Maths", emoji: neuf })).field).toBe("EMOJI");
  });

  test.skipIf(skip)("un nom ou un libellé trop long est refusé", async () => {
    expect((await read({ subject: "M".repeat(64) })).ok).toBe(true);
    expect((await read({ subject: "M".repeat(65) })).field).toBe("SUBJECT");
    expect((await read({ subject: "Maths", label: "L".repeat(64) })).ok).toBe(true);
    expect((await read({ subject: "Maths", label: "L".repeat(65) })).field).toBe("LABEL");
    // Un nom vide n'est pas une matière.
    expect((await read({ subject: "   " })).field).toBe("SUBJECT");
  });

  test.skipIf(skip)("chaque refus a une phrase bornée, en français", async () => {
    for (const champ of ["SUBJECT", "COLOR", "EMOJI", "LABEL"]) {
      const res = JSON.parse(
        await link!.ask({ op: "message", field: champ }),
      ) as { message?: string };
      const message = res.message ?? "";
      expect(message.trim()).not.toBe("");
      // Bornée comme tout message du pont (une seule ligne, 200 caractères).
      expect(message.length).toBeLessThanOrEqual(200);
      expect(message).not.toMatch(/[\n\r]/);
    }
  });
});

describe("câblage : le pont et le dépôt partagent la MÊME règle (#395)", () => {
  const bridge = readBridgeSource();
  const prefs = readFileSync(join(DATA, "SubjectPrefs.kt"), "utf8");
  const save = bridgeMethod(bridge, "saveSubject");

  test("le dépôt valide par les règles partagées", () => {
    // `isValid` s'appuie sur `SubjectPrefRules.invalidField` : une seule vérité.
    expect(prefs).toContain("SubjectPrefRules.invalidField(");
    expect(prefs).not.toContain("COLOR_RE");
  });

  test("le pont lit la matière par les règles partagées", () => {
    expect(save).toContain("SubjectPrefRules.read(");
    // Le dépôt reçoit les valeurs VALIDÉES, jamais la saisie brute.
    expect(save).toMatch(/upsert\(\s*valid\.subject,\s*valid\.color,\s*valid\.emoji,\s*valid\.label,/);
    expect(save).not.toMatch(/upsert\([^)]*p\.string\(/);
  });

  test("un refus répond ok:false AVANT toute écriture", () => {
    const refus = save.indexOf("SubjectPrefInput.Invalid");
    const ecriture = save.indexOf("prefsRepo.upsert(");
    expect(refus).toBeGreaterThan(-1);
    expect(ecriture).toBeGreaterThan(-1);
    // Le refus est traité AVANT l'écriture : rien n'est écrit.
    expect(refus).toBeLessThan(ecriture);
    // Et la réponse est honnête : `ok:false` + une phrase choisie par le pont.
    expect(save).toMatch(/SubjectPrefInput\.Invalid\s*->\s*return\s+JSONObject\(\)/);
    expect(save).toContain("subjectPrefIssueMessage(");
  });

  test("le pont ne dit JAMAIS « ok » quand le dépôt n'a rien écrit", () => {
    // Le pont répond `ok:false` si le dépôt refuse : le « ok » vient APRÈS l'écriture.
    expect(save).toContain("SubjectPrefsWrite.INVALID");
    expect(save.indexOf('put("ok", true)')).toBeGreaterThan(save.indexOf("SubjectPrefsWrite.INVALID"));
  });

  test("le dépôt n'écrit RIEN quand la matière est hors contrat", () => {
    // `upsert` valide AVANT d'écrire : un refus laisse le disque intact.
    const upsert = prefs.slice(prefs.indexOf("fun upsert("));
    const refus = upsert.indexOf("return SubjectPrefsWrite.INVALID");
    const ecriture = upsert.indexOf("write(");
    expect(refus).toBeGreaterThan(-1);
    expect(ecriture).toBeGreaterThan(-1);
    expect(refus).toBeLessThan(ecriture);
  });

  test("les bornes du pont sont celles du contrat (miroir TypeScript)", () => {
    const contracts = readFileSync(
      join(ROOT, "shared", "contracts", "models", "subject-prefs.ts"),
      "utf8",
    );
    const web = readFileSync(join(ROOT, "web", "src", "features", "settings", "model.ts"), "utf8");
    expect(tsLimit(contracts, /SUBJECT_PREFS_MAX_SUBJECT_CHARS = (\d+)/)).toBe(64);
    expect(tsLimit(contracts, /SUBJECT_PREFS_MAX_EMOJI_CHARS = (\d+)/)).toBe(8);
    expect(tsLimit(contracts, /SUBJECT_PREFS_MAX_LABEL_CHARS = (\d+)/)).toBe(64);
    expect(tsLimit(web, /MAX_SUBJECT_CHARS = (\d+)/)).toBe(64);
    expect(tsLimit(web, /MAX_EMOJI_CHARS = (\d+)/)).toBe(8);
    expect(tsLimit(web, /MAX_LABEL_CHARS = (\d+)/)).toBe(64);
  });
});
