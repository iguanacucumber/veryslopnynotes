import { describe, expect, test } from "bun:test";
import type { Assignment, Device, TimetableEntry } from "../../shared/contracts/models";
import { isRevisionSheetsResponse } from "../../shared/contracts/api";
import { detectExams } from "../../server/jobs/exams";
import { assembleRevisionSheet, notifyRevisionSheets, renderRevisionPdf } from "../../server/jobs/revision";
import { requestRevisionFiche } from "../../server/ai/revision";
import { chunkManual, retrieveManuals } from "../../server/infrastructure/manuals";
import { createRevisionMemoryStore, selectRevisionTriggers } from "../../server/api/revision";
import { createMemoryStore } from "../../server/api/store";
import { createHandler } from "../../server/api/router";
import { syntheticManualDocs } from "../unit/fixtures/manuals";

// e2e revision (issue #30, phase 10) : annonce DS structurée -> fiche
// sourcée -> push -> API liste + export PDF. Zéro réseau externe, zéro
// secret, fixtures synthétiques. Sortie modèle ne déclenche jamais seule :
// seul high structuré pousse (I7).
const HASH_A = "a".repeat(64);

const devices: Device[] = [{ id: "d1", tokenHash: HASH_A }];

describe("e2e revision", () => {
  test("DS high -> fiche poussée, listée, exportable PDF", async () => {
    const assignments: Assignment[] = [
      { id: "a-ds", accountId: "acc", subject: "Maths", title: "DS n°3 — fractions", dueDate: "2026-10-06T08:00:00.000Z", done: false },
    ];
    const entries: TimetableEntry[] = [];
    const exams = detectExams(assignments, entries);
    expect(exams.length).toBe(1);
    expect(exams[0].confidence).toBe("high");

    const triggers = selectRevisionTriggers(exams);
    expect(triggers.length).toBe(1);

    const chunks = syntheticManualDocs.flatMap((d) => chunkManual(d, 500));
    const hits = retrieveManuals(chunks, "fractions half quarter Maths", 2);
    expect(hits.length).toBeGreaterThan(0);

    const fakeLlm = {
      async generate() {
        return JSON.stringify({ fiche: "Réviser : half + quarter = three quarters. Exemple 1/2 + 1/4 = 3/4." });
      },
    };
    const ficheText = await requestRevisionFiche(fakeLlm, triggers[0], hits, "E2eNonce12345678");
    expect(ficheText).toContain("3/4");

    const sheet = assembleRevisionSheet(triggers[0], ficheText, hits.map((h) => h.source));
    expect(sheet.body).toContain("Sources :");
    expect(sheet.body).toContain(hits[0].source);

    const calls: { hash: string; title: string; body: string }[] = [];
    const res = await notifyRevisionSheets(
      [sheet],
      new Map([[triggers[0].id, triggers[0]]]),
      devices,
      { send: async (hash, payload) => { calls.push({ hash, ...payload }); } },
    );
    expect(res.sheets).toBe(1);
    expect(res.sent).toBe(1);
    expect(calls[0].title).toContain("Maths");

    const revisions = createRevisionMemoryStore([sheet]);
    const handler = createHandler(createMemoryStore(), undefined, revisions);

    const listRes = await handler(new Request("http://127.0.0.1/v1/revision-sheets"));
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(isRevisionSheetsResponse(listJson)).toBe(true);
    expect(listJson.sheets.length).toBe(1);
    expect(listJson.sheets[0].templateVersion).toBe("fiche-v1");

    const pdfRes = await handler(new Request(`http://127.0.0.1/v1/revision-sheets/pdf?id=${sheet.id}`));
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toContain("application/pdf");
    const buf = new Uint8Array(await pdfRes.arrayBuffer());
    expect(new TextDecoder().decode(buf.slice(0, 5))).toContain("%PDF");
    expect(buf.length).toBeGreaterThan(100);

    const direct = renderRevisionPdf(sheet);
    expect(direct.length).toBeGreaterThan(100);
  });

  test("I7 : incertain + sortie modèle seule ne poussent jamais", async () => {
    const assignments: Assignment[] = [
      { id: "a-qcm", accountId: "acc", subject: "Maths", title: "QCM chapitre 2", dueDate: "2026-10-06T08:00:00.000Z", done: false },
    ];
    const exams = detectExams(assignments, []);
    expect(exams.length).toBe(1);
    expect(exams[0].confidence).toBe("needs_confirm");
    expect(selectRevisionTriggers(exams)).toEqual([]);

    const chunks = syntheticManualDocs.flatMap((d) => chunkManual(d, 500));
    const hits = retrieveManuals(chunks, "fractions", 1);
    const fakeLlm = {
      async generate() {
        return JSON.stringify({ fiche: "Fiche QCM." });
      },
    };
    const text = await requestRevisionFiche(fakeLlm, exams[0], hits, "E2eNonce12345678");
    const sheet = assembleRevisionSheet(exams[0], text, hits.map((h) => h.source));
    const calls: unknown[] = [];
    const res = await notifyRevisionSheets([sheet], new Map([[exams[0].id, exams[0]]]), devices, {
      send: async () => { calls.push(1); },
    });
    expect(res.sent).toBe(0);
    expect(calls.length).toBe(0);
  });

  test("API pdf : 400 sans id, 404 inconnu", async () => {
    const handler = createHandler(createMemoryStore(), undefined, createRevisionMemoryStore());
    const bad = await handler(new Request("http://127.0.0.1/v1/revision-sheets/pdf"));
    expect(bad.status).toBe(400);
    const nf = await handler(new Request("http://127.0.0.1/v1/revision-sheets/pdf?id=nope"));
    expect(nf.status).toBe(404);
  });
});
