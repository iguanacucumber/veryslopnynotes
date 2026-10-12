// Parité TS <-> Kotlin des jobs (diff notes, détection DS, notifs, fiches #207).
//
// Même principe que `kotlin-domain-parity.test.ts` (#203) : les mêmes fixtures
// alimentent la référence TS (`server/jobs/`) ET le port (`android/core/`,
// compilé pour de vrai par `kotlinc` et piloté en JSON via
// `agents/runtime/kotlin-parity/ParityJobsMain.kt`), sorties comparées
// canoniquement. `sync.ts` (SSE/cron, #208) et `server/ai/*` (#204) sont hors
// périmètre : ce fichier ne les importe jamais (même pas en type).
//
// `RevisionPdf.kt` (`android.graphics`, SDK uniquement) n'est pas compilé par
// le harnais : seul `revisionPdfLines` (pur) est rejoué ici, face à une
// transcription documentée de `renderRevisionPdf` (même règle que les miroirs
// `android-*.test.ts` pour la logique non exécutable).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { diffAgainstPrints, diffGrades, fingerprint } from "../../server/jobs/grades";
import { detectExams, examConfidence } from "../../server/jobs/exams";
import type { ExamCandidate, ExamConfidence } from "../../server/jobs/exams";
import {
  absenceFingerprint,
  errorCause,
  formatAbsencePush,
  formatGradePush,
  newAbsences,
  notifyGradeEvents,
  notifySyncResult,
} from "../../server/jobs/notify";
import type { GradePushSender } from "../../server/jobs/notify";
import {
  assembleRevisionSheet,
  buildRevisionTitle,
  formatRevisionPush,
  listRevisionSheets,
  loadRevisionSheet,
  notifyRevisionSheets,
  revisionIdForExam,
  saveRevisionSheet,
  shouldPushForExam,
} from "../../server/jobs/revision";
import type { RevisionKv } from "../../server/jobs/revision";
import type { ContractEvent } from "../../shared/contracts/events";
import { localDay } from "../../shared/contracts/api";
import { isAbsenceRecord, isGrade, isTokenHash, REVISION_TEMPLATE_VERSION } from "../../shared/contracts/models";
import type { AbsenceRecord, Assignment, Device, Grade, RevisionSheet, TimetableEntry } from "../../shared/contracts/models";
import type { SyncResult } from "../../server/jobs/sync";
import { ROOT, canonTs, parityToolchain, type ParityLink } from "./fixtures/kotlin-harness";

const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const PARITY = join(ROOT, "agents", "runtime", "kotlin-parity");
const SOURCES = [
  "Averages.kt",
  "Assignment.kt",
  "Attendance.kt",
  "GradeDiff.kt",
  "ExamDetect.kt",
  "NotifyFormat.kt",
  "RevisionSheet.kt",
].map((f) => join(CORE, f));
const DRIVER = join(PARITY, "ParityJobsMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  const jar = await parityToolchain.ensureJar("kotlin-jobs-parity", [...SOURCES, DRIVER]);
  link = await parityToolchain.openLink(jar);
}

async function parityOf(op: unknown, tsValue: unknown): Promise<void> {
  const kt = await link!.ask(op);
  const ts = canonTs(tsValue);
  expect(`${kt}\n${ts}`).toBe(`${ts}\n${ts}`);
}

// --- Fixtures ---------------------------------------------------------------

const ACC = "acc-fake-1";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const grade = (over: Partial<Grade> & Pick<Grade, "id" | "subject" | "value" | "scale">): Grade => ({
  accountId: ACC,
  date: "2026-09-20T10:00:00.000Z",
  coefficient: 1,
  ...over,
});

const GRADES: Grade[] = [
  grade({ id: "m1", subject: "Maths", value: 15, scale: 20, date: "2026-09-01T10:00:00.000Z" }),
  grade({ id: "m2", subject: "Maths", value: 10, scale: 20, date: "2026-09-10T10:00:00.000Z" }),
  grade({ id: "a1", subject: "Anglais", value: 12, scale: 20, coefficient: 2, date: "2026-09-05T10:00:00.000Z" }),
  grade({ id: "f1", subject: "EPS", value: 18, scale: 20, optional: true, date: "2026-09-12T10:00:00.000Z" }),
  grade({ id: "s1", subject: "SVT", value: 7, scale: 10, date: "2026-09-15T10:00:00.000Z" }),
  grade({ id: "b1", subject: "Arts", value: 20, scale: 20, bonus: true, date: "2026-09-20T10:00:00.000Z" }),
  grade({ id: "l1", subject: "Français", value: 14, scale: 20, label: "Devoir surveillé n°1", teacher: "Mme Martin" }),
  grade({ id: "c1", subject: "Histoire", value: 11.5, scale: 20, classAverage: 10.25, classMin: 4, classMax: 18, periodId: "p-1" }),
];

const rec = (over: Partial<AbsenceRecord> & Pick<AbsenceRecord, "id" | "kind" | "date">): AbsenceRecord => ({
  accountId: ACC,
  ...over,
});

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

// Titres → confiance attendue (corpus repris de `exams.test.ts`).
const CASES: [string, ExamConfidence | null][] = [
  ["DS n°3 — fonctions", "high"],
  ["Devoir surveillé de maths", "high"],
  ["CONTRÔLE chapitre 4", "high"],
  ["Interro surprise vocabulaire", "high"],
  ["Interrogation écrite", "high"],
  ["Évaluation finale", "high"],
  ["Examen blanc d'histoire", "high"],
  ["Devoir commun de SVT", "high"],
  ["DST de physique", "high"],
  ["QCM chapitre 2", "needs_confirm"],
  ["Test de leçon", "needs_confirm"],
  ["Quiz en ligne", "needs_confirm"],
  ["DM pour lundi", null],
  ["Exposé sur la Révolution", null],
  ["Testez vos connaissances p.42", null],
  ["Lien Quizlet à réviser", null],
  ["Fiche méthode", null],
  ["Lire le chapitre 5", null],
];

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

/** Expéditeur TS miroir du pilote : échec nommé comme l'exception Kotlin. */
function tsSender(calls: { hash: string; title: string; body: string }[], failOn: string[] = []) {
  const sender: GradePushSender = {
    send: async (hash, payload) => {
      if (failOn.includes(hash)) {
        const e = new Error("down");
        e.name = "IllegalStateException";
        throw e;
      }
      calls.push({ hash, ...payload });
    },
  };
  return sender;
}

const devices: Device[] = [
  { id: "d1", tokenHash: HASH_A },
  { id: "d2", tokenHash: HASH_B },
];

async function tsNotify(op: {
  events: { type: string; data: unknown }[];
  devices: Device[];
  failOn?: string[];
  delivers?: boolean;
  firstRun?: boolean;
}) {
  const calls: { hash: string; title: string; body: string }[] = [];
  const logs: string[] = [];
  const sender = tsSender(calls, op.failOn ?? []);
  const wrapped: GradePushSender =
    op.delivers === false ? { ...sender, delivers: false } : sender;
  const events = op.events as unknown as ContractEvent[];
  const res = op.firstRun
    ? await notifySyncResult(
        { firstRun: true, events, snapshot: { version: 1, at: "", gradeIds: [], gradePrints: {}, assignmentIds: [], entryIds: [] } } as SyncResult,
        op.devices,
        wrapped,
        (m) => logs.push(m),
      )
    : await notifyGradeEvents(events, op.devices, wrapped, (m) => logs.push(m));
  return { ...res, errors: [...res.errors], calls, logs };
}

// Transcription documentée de `renderRevisionPdf` (découpe + 60 lignes) : le
// pilote rejoue `revisionPdfLines`, cette fonction rejoue la référence TS.
const tsWrap = (line: string, max: number): string[] => {
  if (line.length <= max) return [line || " "];
  const words = line.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const add = (cur ? 1 : 0) + w.length;
    if (cur.length + add > max && cur) {
      out.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [" "];
};

const tsPdfLines = (sheet: RevisionSheet): string[] => {
  const raw = [
    sheet.title,
    `${sheet.subject} — ${localDay(sheet.date)}`,
    "",
    ...sheet.body.split("\n"),
    "",
    `Gabarit ${sheet.templateVersion}`,
  ];
  return raw.flatMap((l) => (l.trim() === "" ? [" "] : tsWrap(l, 90))).slice(0, 60);
};

describe("parité TS <-> Kotlin des jobs (#207)", () => {
  test.skipIf(skip)("pilote : l'écho valide le parseur sur des données réelles", async () => {
    await parityOf({ op: "echo", value: GRADES }, GRADES);
  });

  test.skipIf(skip)("diff notes : ajout / correction / suppression", async () => {
    const before = [grade({ id: "g1", subject: "Maths", value: 14, scale: 20 }), grade({ id: "g2", subject: "Maths", value: 12, scale: 20 }), grade({ id: "g3", subject: "Maths", value: 9, scale: 20 })];
    const after = [grade({ id: "g1", subject: "Maths", value: 14, scale: 20 }), grade({ id: "g2", subject: "Maths", value: 16, scale: 20 }), grade({ id: "g4", subject: "Maths", value: 13, scale: 20 })];
    await parityOf({ op: "diffGrades", previous: before, current: after }, diffGrades(before, after));
    await parityOf({ op: "diffGrades", previous: before, current: before }, diffGrades(before, before));
  });

  test.skipIf(skip)("diff notes : empreintes stables, contexte #74 + libellé", async () => {
    for (const g of GRADES) {
      await parityOf({ op: "fingerprint", grade: g }, { fingerprint: fingerprint(g) });
    }
    // Chaque bascule de contexte est une correction.
    const base = grade({ id: "g1", subject: "Maths", value: 14, scale: 20 });
    for (const variant of [
      { ...base, optional: true },
      { ...base, bonus: true },
      { ...base, coefficient: 3 },
      { ...base, classAverage: 11 },
      { ...base, classMin: 5 },
      { ...base, classMax: 19 },
      { ...base, periodId: "p-2" },
      { ...base, label: "Devoir surveillé n°2 (corrigé)" },
      { ...base, teacher: "M. Dupont" },
    ]) {
      await parityOf({ op: "diffGrades", previous: [base], current: [variant] }, diffGrades([base], [variant]));
    }
    // Contre empreintes : équivalent au diff de listes.
    const prints: Record<string, string> = {};
    for (const g of GRADES) prints[g.id] = fingerprint(g);
    await parityOf({ op: "diffPrints", previous: prints, current: GRADES }, diffAgainstPrints(prints, GRADES));
    const extended = [...GRADES, grade({ id: "g9", subject: "Maths", value: 3, scale: 20 })];
    await parityOf({ op: "diffPrints", previous: prints, current: extended }, diffAgainstPrints(prints, extended));
  });

  test.skipIf(skip)("DS : chaque titre classé exactement, zéro faux positif EDT", async () => {
    for (const [title] of CASES) {
      await parityOf({ op: "examConfidence", title }, examConfidence(title));
    }
    const assignments: Assignment[] = CASES.map(([title], i) => ({
      id: `a${i}`,
      accountId: ACC,
      subject: "Maths",
      title,
      dueDate: "2026-10-06T08:00:00.000Z",
      done: false,
    }));
    const entries: TimetableEntry[] = [
      { id: "t1", accountId: ACC, subject: "Histoire", start: "2026-10-03T08:00:00.000Z", end: "2026-10-03T09:00:00.000Z" },
      { id: "t2", accountId: ACC, subject: "DST blanc", room: "B12", start: "2026-10-04T08:00:00.000Z", end: "2026-10-04T10:00:00.000Z" },
    ];
    await parityOf(
      { op: "detectExams", assignments, entries },
      detectExams(assignments, entries),
    );
  });

  test.skipIf(skip)("notif notes : format borné, accents, coefficient", async () => {
    for (const g of [...GRADES, grade({ id: "long", subject: "S".repeat(500), value: 15, scale: 20 }), grade({ id: "emoji", subject: "Maths 🎒", value: 13.5, scale: 20 })]) {
      await parityOf({ op: "formatGradePush", grade: g }, formatGradePush(g));
    }
  });

  test.skipIf(skip)("notif notes : fan-out, dedup, premier passage silencieux", async () => {
    const g = (id: string, value = 14): Grade => grade({ id, subject: "Maths", value, scale: 20 });
    const ev = (type: string, data: unknown) => ({ type, data });
    await parityOf(
      { op: "notifyGrades", events: [ev("GradeCreated", g("g2", 16))], devices, failOn: [] },
      await tsNotify({ events: [ev("GradeCreated", g("g2", 16))], devices }),
    );
    // Rejeu du même lot : une seule notification par note.
    const twice = [ev("GradeCreated", g("g2", 16)), ev("GradeCreated", g("g2", 16))];
    await parityOf({ op: "notifyGrades", events: twice, devices, failOn: [] }, await tsNotify({ events: twice, devices }));
    // Non-GradeCreated et note invalide ignorés.
    const mixed = [ev("SyncCompleted", { accountId: ACC, grades: 1, assignments: 0 }), ev("GradeCreated", { ...g("bad"), value: -5 })];
    await parityOf({ op: "notifyGrades", events: mixed, devices, failOn: [] }, await tsNotify({ events: mixed, devices }));
    // Premier passage silencieux même avec événements.
    await parityOf(
      { op: "notifyGrades", events: [ev("GradeCreated", g("g1"))], devices, failOn: [], firstRun: true },
      await tsNotify({ events: [ev("GradeCreated", g("g1"))], devices, firstRun: true }),
    );
    // Fail-soft par appareil + token invalide écarté + cause d'échec portée.
    const withBad: Device[] = [...devices, { id: "dx", tokenHash: "not-hex" }];
    await parityOf(
      { op: "notifyGrades", events: [ev("GradeCreated", g("g3"))], devices: withBad, failOn: [HASH_A] },
      await tsNotify({ events: [ev("GradeCreated", g("g3"))], devices: withBad, failOn: [HASH_A] }),
    );
    // Provider inerte : rien compté, motif au log.
    await parityOf(
      { op: "notifyGrades", events: [ev("GradeCreated", g("g4"))], devices, failOn: [], delivers: false },
      await tsNotify({ events: [ev("GradeCreated", g("g4"))], devices, delivers: false }),
    );
  });

  test.skipIf(skip)("notif notes : causes d'échec (nom + message, secret caviardé)", async () => {
    const HEX = "f".repeat(64);
    const cases: { name: string | null; message: string }[] = [
      { name: "Error", message: "down" },
      { name: "IllegalStateException", message: "down" },
      { name: null, message: "panne franche" },
      { name: "Error", message: `envoi vers ${HASH_A} refusé` },
      { name: "Error", message: `mélange ${HEX} et ${"a".repeat(64)} dedans` },
      { name: "TimeoutError", message: "x".repeat(500) },
    ];
    for (const c of cases) {
      const err = c.name === null ? c.message : Object.assign(new Error(c.message), { name: c.name });
      await parityOf({ op: "errorCause", name: c.name, message: c.message }, { cause: errorCause(err) });
    }
    expect(isTokenHash(HASH_A)).toBe(true);
    expect(isTokenHash("not-hex")).toBe(false);
    expect(isGrade(grade({ id: "ok", subject: "Maths", value: 10, scale: 20 }))).toBe(true);
  });

  test.skipIf(skip)("jour local Paris : 22h30 UTC = lendemain, illisible = tranche", async () => {
    for (const iso of ["2026-10-06T22:30:00.000Z", "2026-10-06T08:00:00.000Z", "2026-09-01", "n importe quoi", "2026-10-06T22:30:00.000+02:00"]) {
      await parityOf({ op: "localDay", iso }, { day: localDay(iso) });
    }
  });

  test.skipIf(skip)("vie scolaire : empreintes, nouveautés, format Paris", async () => {
    const records: AbsenceRecord[] = [
      rec({ id: "a1", kind: "absence", date: "2026-09-01T08:00:00.000Z", periodId: "p-1", durationMinutes: 120 }),
      rec({ id: "l1", kind: "late", date: "2026-10-06T22:30:00.000Z", subject: "Maths", motif: "Rendez-vous médical" }),
      rec({ id: "j1", kind: "absence", date: "2026-09-04T08:00:00.000Z", justified: true }),
      rec({ id: "x1", kind: "exclusion" as unknown as "absence", date: "2026-09-05T08:00:00.000Z" }),
    ];
    for (const r of records) {
      await parityOf({ op: "absenceFingerprint", record: r }, { fingerprint: absenceFingerprint(r) });
      await parityOf({ op: "formatAbsencePush", record: r }, formatAbsencePush(r));
    }
    const previous = [absenceFingerprint(records[0]!), absenceFingerprint(records[2]!)];
    await parityOf({ op: "newAbsences", previous, records }, newAbsences(previous, records));
    await parityOf({ op: "newAbsences", previous: [], records }, newAbsences([], records));
    expect(isAbsenceRecord(records[0])).toBe(true);
    expect(isAbsenceRecord(records[3])).toBe(false);
  });

  test.skipIf(skip)("fiches : ids déterministes, titres, déclenchement", async () => {
    for (const id of ["a0", "a/b", "a?b", "  ", "x".repeat(200), "devoir n°3 (spécialité)"]) {
      await parityOf({ op: "revisionId", examId: id }, { id: revisionIdForExam(id) });
    }
    expect(revisionIdForExam("a/b")).not.toBe(revisionIdForExam("a?b"));
    for (const exam of [examHigh, examMaybe, { ...examHigh, subject: "  " }, { ...examHigh, date: "2026-10-06T22:30:00.000Z" }]) {
      await parityOf({ op: "revisionTitle", exam }, { title: buildRevisionTitle(exam) });
      await parityOf({ op: "shouldPush", exam }, shouldPushForExam(exam));
      await parityOf({ op: "formatRevisionPush", exam }, formatRevisionPush(exam));
    }
  });

  test.skipIf(skip)("fiches : assemblage, refus, citation des sources", async () => {
    const AT = "2026-10-02T06:00:00.000Z";
    const text = "Résumé fractions : 1/2 + 1/4 = 3/4. Réviser les additions — méthode « pas à pas ».";
    const sources = ["éditeur-fake • Maths-Fake 6e • p.42", "éditeur-fake • Maths-Fake 6e • p.42", "  carnet-fake  "];
    const ok = (() => {
      try {
        return { sheet: assembleRevisionSheet(examHigh, text, sources, AT) };
      } catch (e) {
        return { refus: (e as Error).message };
      }
    })();
    await parityOf({ op: "assemble", exam: examHigh, ficheText: text, sources, now: AT }, ok);
    expect((ok as { sheet: RevisionSheet }).sheet.templateVersion).toBe(REVISION_TEMPLATE_VERSION);
    for (const bad of [
      { ficheText: "   ", sources: ["src"] },
      { ficheText: "texte", sources: [] as string[] },
      { ficheText: "texte", sources: ["  "] },
    ]) {
      const ts = (() => {
        try {
          return { sheet: assembleRevisionSheet(examHigh, bad.ficheText, bad.sources, AT) };
        } catch (e) {
          return { refus: (e as Error).message };
        }
      })();
      await parityOf({ op: "assemble", exam: examHigh, ficheText: bad.ficheText, sources: bad.sources, now: AT }, ts);
    }
    // Texte citant déjà : pas de double bloc « Sources : ».
    const cited = `${text}\n\nSources :\n- déjà-là`;
    const tsCited = (() => {
      try {
        return { sheet: assembleRevisionSheet(examHigh, cited, ["src"], AT) };
      } catch (e) {
        return { refus: (e as Error).message };
      }
    })();
    await parityOf({ op: "assemble", exam: examHigh, ficheText: cited, sources: ["src"], now: AT }, tsCited);
  });

  test.skipIf(skip)("fiches : push structuré (high seul, map d'examens)", async () => {
    const AT = "2026-10-02T06:00:00.000Z";
    const sheet = assembleRevisionSheet(examHigh, "Résumé.", ["src1"], AT);
    const sheetMaybe = assembleRevisionSheet(examMaybe, "Résumé.", ["src1"], AT);
    const exams = [examHigh, examMaybe];
    const withBad: Device[] = [{ id: "d1", tokenHash: HASH_A }, { id: "dx", tokenHash: "not-hex" }];
    const ts = await (async () => {
      const calls: { hash: string; title: string; body: string }[] = [];
      const sender = {
        send: async (hash: string, payload: { title: string; body: string }) => {
          calls.push({ hash, ...payload });
        },
      };
      const res = await notifyRevisionSheets(
        [sheet, sheetMaybe],
        new Map([[examHigh.id, examHigh], [examMaybe.id, examMaybe]]),
        withBad,
        sender,
        () => {},
      );
      return { ...res, calls };
    })();
    await parityOf({ op: "notifyRevision", sheets: [sheet, sheetMaybe], exams, devices: withBad }, ts);
  });

  test.skipIf(skip)("fiches : stockage kv (save/load/list, index corrompu, gabarit)", async () => {
    const AT = "2026-10-02T06:00:00.000Z";
    const kv = memoryKv();
    await link!.ask({ op: "kvReset" });
    const s1 = assembleRevisionSheet({ ...examHigh, id: "s1" }, "Fiche 1.", ["src-fake"], AT);
    const s2 = assembleRevisionSheet({ ...examHigh, id: "s2" }, "Fiche 2 : accents — « été ».", ["src-fake"], AT);
    await saveRevisionSheet(kv, s1);
    await saveRevisionSheet(kv, s2);
    await parityOf({ op: "kvSave", sheet: s1 }, "ok");
    await parityOf({ op: "kvSave", sheet: s2 }, "ok");
    await parityOf({ op: "kvLoad", id: s1.id }, await loadRevisionSheet(kv, s1.id));
    await parityOf({ op: "kvLoad", id: "nope" }, await loadRevisionSheet(kv, "nope"));
    await parityOf({ op: "kvList" }, await listRevisionSheets(kv));
    // Aller-retour JSON exact (accents compris).
    await parityOf({ op: "kvJson", sheet: s2 }, JSON.parse(JSON.stringify(s2)) as RevisionSheet);
    // Index corrompu : les fiches restent listables après un nouvel ajout.
    const enc = new TextEncoder();
    await kv.set("revision:index", enc.encode("{corrompu"));
    await parityOf({ op: "kvRawSet", key: "revision:index", value: "{corrompu" }, "ok");
    const s3 = assembleRevisionSheet({ ...examHigh, id: "s3" }, "Fiche 3.", ["src-fake"], AT);
    await saveRevisionSheet(kv, s3);
    await parityOf({ op: "kvSave", sheet: s3 }, "ok");
    await parityOf(
      { op: "kvList" },
      await listRevisionSheets(kv),
    );
  });

  test.skipIf(skip)("fiches : mise en page PDF (découpe 90, plafond 60, accents)", async () => {
    const AT = "2026-10-02T06:00:00.000Z";
    const longLine =
      "Un très long paragraphe de révision sur les fractions — additions, soustractions, multiplications et divisions, avec des exemples détaillés pas à pas pour bien comprendre la méthode générale.";
    const body = `${longLine}\n\nDeuxième paragraphe court.\n${"répétition ".repeat(60)}`;
    const sheet = assembleRevisionSheet(examHigh, body, ["éditeur-fake • Maths-Fake 6e • p.42"], AT);
    await parityOf({ op: "pdfLines", sheet }, { lines: tsPdfLines(sheet) });
    const tiny = assembleRevisionSheet(examHigh, "Court.", ["src"], AT);
    await parityOf({ op: "pdfLines", sheet: tiny }, { lines: tsPdfLines(tiny) });
  });
});
