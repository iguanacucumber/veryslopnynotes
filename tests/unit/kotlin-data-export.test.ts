// #857 — export local et portable. Le fichier est construit et RELU par le
// VRAI code Kotlin (`data/DataExport.kt`), pas par un miroir TS : l'aller-retour
// prouve le format, et une clé interdite est écartée avant publication.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { readBridgeSource } from "./fixtures/bridge-source";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "DataExportMain.kt");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) link = await parityToolchain.openParityLink(DRIVER);

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

const GRADE_PAYLOAD = JSON.stringify({
  averages: { general: { value: 14.2, origin: "school" } },
  grades: [
    { id: "g1", subject: "Mathématiques", value: 16, scale: 20, date: "2026-10-01" },
    { id: "g2", subject: "NSI", value: 12.5, scale: 20, date: "2026-10-02" },
  ],
  partial: false,
});

const FIXTURE = {
  op: "build",
  exportedAt: "2026-11-03T08:30:00Z",
  grades: [GRADE_PAYLOAD],
  notes: [
    {
      id: "n1",
      subject: "Mathématiques",
      title: "Dérivées",
      text: "La dérivée de x² est 2x.",
      createdAt: "2026-10-19T08:00:00Z",
    },
  ],
  teacherChat: {
    subject: "Mathématiques",
    messages: [
      { role: "student", text: "Comment dériver x² ?", sources: [], unsourced: false },
      {
        role: "teacher",
        text: "Applique la règle de puissance.",
        sources: ["Cahier : Dérivées"],
        unsourced: false,
        context: [{ type: "note", label: "Cahier : Dérivées", chars: 32, truncated: false }],
        summaryChars: 0,
      },
    ],
  },
  manual: {
    classLabel: "TG2",
    subjects: ["Mathématiques", "NSI"],
    disabledSubjects: ["Histoire-Géographie"],
    docs: [
      {
        title: "Chapitre 4 — Dérivation",
        subject: "Mathématiques",
        page: 42,
        excerpt: "La dérivée de x² vaut 2x.",
      },
    ],
  },
  subjects: [
    { subject: "Mathématiques", color: "#AABBCC", emoji: "📘", label: "Maths", updatedAt: "2026-10-01T10:00:00Z" },
  ],
  newsReadIds: ["news-1", "news-2"],
};

describe("export portable — format, manifeste, aller-retour (#857)", () => {
  test.skipIf(skip)("le JSON exporté est relu avec le MÊME contenu", async () => {
    const out = await ask(FIXTURE);
    expect(out.ok).toBe(true);
    const summary = out.summary;

    expect(summary.schemaVersion).toBe(1);
    expect(summary.exportedAt).toBe("2026-11-03T08:30:00Z");
    expect(summary.gradeCount).toBe(2);
    expect(summary.gradeIds).toEqual(["g1", "g2"]);
    expect(summary.noteIds).toEqual(["n1"]);
    expect(summary.noteTexts).toEqual(["La dérivée de x² est 2x."]);
    expect(summary.chatSubject).toBe("Mathématiques");
    expect(summary.chatTexts).toEqual(["Comment dériver x² ?", "Applique la règle de puissance."]);
    expect(summary.manualClass).toBe("TG2");
    expect(summary.manualDocs).toBe(1);
    expect(summary.manualExcerpts).toEqual(["La dérivée de x² vaut 2x."]);
    expect(summary.subjectNames).toEqual(["Mathématiques"]);
    expect(summary.readIds).toEqual(["news-1", "news-2"]);

    const sections = Object.fromEntries(
      (summary.sections as { name: string; count: number; skipped: number }[]).map((s) => [s.name, s]),
    );
    expect(sections.grades).toEqual({ name: "grades", count: 2, skipped: 0 });
    expect(sections.notes).toEqual({ name: "notes", count: 1, skipped: 0 });
    expect(sections.teacherChat).toEqual({ name: "teacherChat", count: 2, skipped: 0 });
    expect(sections.manual).toEqual({ name: "manual", count: 1, skipped: 0 });
    expect(sections.subjectPrefs).toEqual({ name: "subjectPrefs", count: 1, skipped: 0 });
    expect(sections.newsReadState).toEqual({ name: "newsReadState", count: 2, skipped: 0 });

    // Le document est aussi un JSON strict, indépendamment du parseur Kotlin.
    const raw = JSON.parse(out.json) as Record<string, unknown>;
    expect(raw.format).toBe("veryslopnynotes.data-export");
    expect(raw.schemaVersion).toBe(1);
    expect(typeof raw.manifest).toBe("object");
  });

  test.skipIf(skip)("le manifeste NOMME ce qui est retenu hors du fichier", async () => {
    const summary = (await ask(FIXTURE)).summary;
    for (const withheld of ["sessionToken", "llmKey", "serverUrl", "manualSourceUrl", "credentials"]) {
      expect(summary.withheld).toContain(withheld);
    }
  });

  test.skipIf(skip)("une clé interdite est écartée, jamais recopiée", async () => {
    const forbidden = "valeur-qui-ne-doit-pas-sortir";
    const poisoned = JSON.stringify({
      grades: [
        { id: "safe", subject: "Mathématiques", value: 15 },
        { id: "leak", subject: "Mathématiques", value: 10, token: forbidden },
        { id: "leak2", subject: "NSI", value: 11, nested: { authorization: forbidden } },
      ],
    });
    const out = await ask({ ...FIXTURE, grades: [poisoned, "pas du json"] });
    expect(out.ok).toBe(true);
    expect(out.summary.gradeCount).toBe(1);
    expect(out.summary.gradeIds).toEqual(["safe"]);
    expect(out.json).not.toContain(forbidden);
    expect(out.json).not.toContain('"token"');
    expect(out.json).not.toContain('"authorization"');
    const grades = out.summary.sections.find((s: { name: string }) => s.name === "grades");
    expect(grades.skipped).toBe(3);
  });

  test.skipIf(skip)("un import hors schéma est REFUSÉ, sans valeur inventée", async () => {
    const valid = (await ask(FIXTURE)).json as string;
    for (const broken of [
      valid.replace('"schemaVersion":1', '"schemaVersion":999'),
      valid.replace("veryslopnynotes.data-export", "autre.format"),
      valid.replace('"format"', '"format-absent"'),
    ]) {
      const out = await ask({ op: "parse", json: broken });
      expect(out.ok).toBe(false);
      expect(out.summary).toBeNull();
    }
  });

  test.skipIf(skip)("un import qui porte une clé interdite est refusé", async () => {
    const raw = JSON.parse((await ask(FIXTURE)).json) as { grades: Record<string, unknown>[] };
    raw.grades[0]!.password = "valeur-interdite";
    const out = await ask({ op: "parse", json: JSON.stringify(raw) });
    expect(out.ok).toBe(false);
  });
});

describe("export portable — câblage : aucun secret, partage local (#857)", () => {
  const bridge = codeOnly(readFileSync(join(APP, "VsnBridgeDataExport.kt"), "utf8"));
  const allBridge = codeOnly(readBridgeSource());
  const exportModule = codeOnly(readFileSync(join(DATA, "DataExport.kt"), "utf8"));
  const manual = codeOnly(readFileSync(join(DATA, "Manuals.kt"), "utf8"));

  test("le fichier part au partage Android, depuis le cache purgé avec le compte", () => {
    expect(bridge).toContain("DownloadedFiles.EXPORTS");
    expect(bridge).toContain('shareFile(file, "application/json"');
    // Le partage reste le chemin EXISTANT du pont (FileProvider + ACTION_SEND).
    expect(allBridge).toContain("Intent.ACTION_SEND");
    expect(allBridge).toContain("FileProvider.getUriForFile");
    expect(bridge).toContain("repo.allPayloads(CachePolicy.GRADES, epoch)");
    // Aucun accès réseau ni secret dans ce chemin.
    expect(bridge).not.toContain("currentBaseUrl");
    expect(bridge).not.toContain("apiKey");
    expect(bridge).not.toContain("SessionStore");
    expect(bridge).not.toContain("LlmKeys");
  });

  test("le module pur ne lit que des champs nommés et borne les payloads", () => {
    expect(exportModule).toContain("SCHEMA_VERSION = 1");
    expect(exportModule).toContain("FORBIDDEN_KEYS");
    expect(exportModule).toContain("containsForbiddenKey");
    expect(exportModule).toContain("MAX_GRADE_PAYLOADS");
    // Le JSON du cache passe par la liste de clés interdites AVANT publication.
    const build = exportModule.slice(
      exportModule.indexOf("fun buildDataExport"),
      exportModule.indexOf("fun parseDataExport"),
    );
    expect(build).toContain("containsForbiddenKey(obj)");
  });

  test("l'adresse du manuel n'est pas dans l'instantané exporté", () => {
    const start = manual.indexOf("fun exportSnapshot()");
    expect(start).toBeGreaterThan(-1);
    const snapshot = manual.slice(start, manual.indexOf("private fun docs()", start));
    expect(snapshot.length).toBeGreaterThan(0);
    expect(snapshot).not.toContain("KEY_URL");
    expect(snapshot).not.toContain("storedUrl");
  });

  test("le pont et l'écran connaissent la méthode allowlistée", () => {
    const call = readFileSync(join(APP, "BridgeCall.kt"), "utf8");
    expect(call).toContain('"data.export"');
    const types = readFileSync(join(ROOT, "web", "src", "bridge", "types.ts"), "utf8");
    expect(types).toContain('"data.export"');
    const card = readFileSync(
      join(ROOT, "web", "src", "features", "settings", "DataExportCard.tsx"),
      "utf8",
    );
    expect(card).toContain("bridge.exportData");
    expect(card).toContain("loadNewsReadIds");
  });
});
