import { describe, expect, test } from "bun:test";
import { detectExams } from "../../server/jobs/exams";
import type { ExamCandidate } from "../../server/jobs/exams";
import {
  assembleRevisionSheet,
  buildRevisionTitle,
  formatRevisionPush,
  listRevisionSheets,
  loadRevisionSheet,
  notifyRevisionSheets,
  renderRevisionPdf,
  revisionIdForExam,
  saveRevisionSheet,
  shouldPushForExam,
} from "../../server/jobs/revision";
import type { RevisionKv } from "../../server/jobs/revision";
import { REVISION_TEMPLATE_VERSION, isRevisionSheet } from "../../shared/contracts/models";
import {
  buildRevisionDocs,
  isRevisionAnswer,
  parseRevisionAnswer,
  requestRevisionFiche,
  revisionPromptFor,
} from "../../server/ai/revision";
import { chunkManual, retrieveManuals } from "../../server/infrastructure/manuals";
import { syntheticManualDocs } from "./fixtures/manuals";
import type { Assignment } from "../../shared/contracts/models";

const HASH_A = "a".repeat(64);

const examHigh: ExamCandidate = {
  source: "assignment",
  id: "a0",
  subject: "Maths",
  date: "2026-10-06T08:00:00.000Z",
  confidence: "high",
  matched: "ds",
};

const examMaybe: ExamCandidate = {
  source: "assignment",
  id: "a9",
  subject: "Maths",
  date: "2026-10-06T08:00:00.000Z",
  confidence: "needs_confirm",
  matched: "qcm",
};

function memoryKv(): RevisionKv & { size(): number } {
  const map = new Map<string, Uint8Array>();
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => {
      map.set(k, v);
    },
    size: () => map.size,
  };
}

describe("unit revision", () => {
  test("déclenchement structuré : high pousse, incertain jamais", () => {
    expect(shouldPushForExam(examHigh)).toBe(true);
    expect(shouldPushForExam(examMaybe)).toBe(false);
    const p = formatRevisionPush(examHigh);
    expect(p.title).toContain("Maths");
    expect(p.title.length).toBeLessThanOrEqual(120);
    expect(p.body.length).toBeLessThanOrEqual(1000);
    expect(buildRevisionTitle(examHigh)).toContain("Maths");
    expect(revisionIdForExam("a0")).toBe("fiche-a0");
    expect(revisionIdForExam("a0")).toBe(revisionIdForExam("a0"));
  });

  test("detectExams -> trigger : high seul retenu", () => {
    const assignments: Assignment[] = [
      { id: "a0", accountId: "acc", subject: "Maths", title: "DS n°3", dueDate: "2026-10-06T08:00:00.000Z", done: false },
      { id: "a1", accountId: "acc", subject: "Maths", title: "QCM chapitre 2", dueDate: "2026-10-06T08:00:00.000Z", done: false },
      { id: "a2", accountId: "acc", subject: "Maths", title: "DM pour lundi", dueDate: "2026-10-06T08:00:00.000Z", done: false },
    ];
    const found = detectExams(assignments, []);
    const highs = found.filter(shouldPushForExam);
    expect(highs.map((e) => e.id)).toEqual(["a0"]);
  });

  test("assemblage : sources citées, gabarit stocké, refus si vide", () => {
    const s = assembleRevisionSheet(examHigh, "Résumé fractions.", ["editeur-fake • Maths-Fake 6e • p.42"]);
    expect(isRevisionSheet(s)).toBe(true);
    expect(s.templateVersion).toBe(REVISION_TEMPLATE_VERSION);
    expect(s.body).toContain("Sources :");
    expect(s.sources).toEqual(["editeur-fake • Maths-Fake 6e • p.42"]);
    expect(() => assembleRevisionSheet(examHigh, "   ", ["src"])).toThrow();
    expect(() => assembleRevisionSheet(examHigh, "texte", [])).toThrow();
    expect(() => assembleRevisionSheet(examHigh, "texte", ["  "])).toThrow();
  });

  test("pipeline IA : docs + prompt nonce + JSON validé", async () => {
    const chunks = syntheticManualDocs.flatMap((d) => chunkManual(d, 500));
    const hits = retrieveManuals(chunks, "fractions half quarter", 2);
    expect(hits.length).toBeGreaterThan(0);
    const docs = buildRevisionDocs(examHigh, hits);
    expect(docs[0]).toContain("Maths");
    const prompt = revisionPromptFor(examHigh, hits, "TestNonce12345678");
    expect(prompt.body).toContain(`nonce="TestNonce12345678"`);
    expect(prompt.body).toContain("Maths");
    expect(isRevisionAnswer({ fiche: "ok" })).toBe(true);
    expect(isRevisionAnswer({ fiche: "  " })).toBe(false);
    expect(parseRevisionAnswer({ fiche: "  résumé  " })).toBe("résumé");
    expect(() => parseRevisionAnswer({ fiche: "" })).toThrow();
    const fake = {
      async generate(_p: { system: string; data: unknown[] }) {
        return JSON.stringify({ fiche: "Fiche : 1/2 + 1/4 = 3/4." });
      },
    };
    const text = await requestRevisionFiche(fake, examHigh, hits, "TestNonce12345678");
    expect(text).toContain("3/4");
    const broken = {
      async generate() {
        return "pas json";
      },
    };
    await expect(requestRevisionFiche(broken, examHigh, hits, "TestNonce12345678")).rejects.toThrow();
  });

  test("push fiches : fan-out structuré, incertain skippé, log sans token", async () => {
    const sheet = assembleRevisionSheet(examHigh, "Résumé.", ["src1"]);
    const sheetMaybe = assembleRevisionSheet(examMaybe, "Résumé.", ["src1"]);
    const calls: { hash: string; title: string; body: string }[] = [];
    const sender = {
      send: async (hash: string, payload: { title: string; body: string }) => {
        calls.push({ hash, ...payload });
      },
    };
    const logs: string[] = [];
    const res = await notifyRevisionSheets(
      [sheet, sheetMaybe],
      new Map([[examHigh.id, examHigh], [examMaybe.id, examMaybe]]),
      [{ id: "d1", tokenHash: HASH_A }, { id: "dx", tokenHash: "not-hex" }],
      sender,
      (m) => logs.push(m),
    );
    expect(res.sheets).toBe(1);
    expect(res.sent).toBe(1);
    expect(calls.length).toBe(1);
    expect(calls[0].title).toContain("Maths");
    expect(logs.join("\n")).not.toContain(HASH_A);
  });

  test("stockage kv : save/load/list + gabarit persisté", async () => {
    const kv = memoryKv();
    const s = assembleRevisionSheet(examHigh, "Résumé.", ["src1"], "2026-10-02T06:00:00.000Z");
    await saveRevisionSheet(kv, s);
    await saveRevisionSheet(kv, s);
    const back = await loadRevisionSheet(kv, s.id);
    expect(back).toEqual(s);
    expect(back?.templateVersion).toBe(REVISION_TEMPLATE_VERSION);
    expect(await loadRevisionSheet(kv, "nope")).toBeNull();
    const all = await listRevisionSheets(kv);
    expect(all.length).toBe(1);
  });

  test("export PDF : en-tête %PDF + titre + gabarit", () => {
    const s = assembleRevisionSheet(examHigh, "Résumé fractions.", ["editeur-fake • Maths-Fake 6e • p.42"]);
    const pdf = renderRevisionPdf(s);
    const head = new TextDecoder().decode(pdf.slice(0, 8));
    expect(head).toContain("%PDF");
    const text = new TextDecoder().decode(pdf);
    expect(text).toContain("Fiche");
    expect(text).toContain("fiche-v1");
  });
});
