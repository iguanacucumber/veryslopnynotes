import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAssignmentsResponse } from "../../shared/contracts/api";
import {
  ASSIGNMENT_ATTACHMENT_LABEL_MAX_CHARS,
  ASSIGNMENT_DESCRIPTION_MAX_CHARS,
  ASSIGNMENT_MAX_ATTACHMENTS,
  ASSIGNMENT_REF_MAX_CHARS,
  isAssignment,
} from "../../shared/contracts/models";

// Miroir des helpers Kotlin (Assignment.kt, AssignmentsRepository.kt,
// Assignments.kt, ServerConfig.kt) — doivent rester en sync. org.json = SDK
// Android, aucune dépendance ajoutée (le build Gradle n'est pas exécuté par
// `make check`). Instants injectés : aucun Date.now() incontrôlé.

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
const DATA = join(import.meta.dir, "..", "..", "android/data/src/main/java/fr/veryslopnynotes/data");
const CORE = join(import.meta.dir, "..", "..", "android/core/src/main/java/fr/veryslopnynotes/core");

type Attachment = { id: string; label: string; ref: string };
type Lesson = { title: string; excerpt: string };
type Item = {
  id: string;
  subject: string;
  title: string;
  dueDate: string;
  done: boolean;
  description: string;
  lessonContent: Lesson | null;
  attachments: Attachment[];
  periodId: string | null;
  weekId: string | null;
};

// Kotlin Regex("://|^//|data:|\\\\") -> source regex identique.
const ABSOLUTE_REF = /:\/\/|^\/\/|data:|\\/;

// Mêmes FP que le scan I1 : commentaires `//` et `/* */` ignorés.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .map((l) => l.slice(0, l.search(/(?<!:)\/\//) === -1 ? l.length : l.search(/(?<!:)\/\//)))
    .join("\n");
}

// --- ServerConfig.mediaUrl (kotlin) ---
function tsUrlEncode(value: string): string {
  const chars = [...value.trim().slice(0, 200)];
  let out = "";
  for (const c of chars) {
    const code = c.codePointAt(0) as number;
    if (/[a-zA-Z0-9\-_.]/.test(c)) out += c;
    else out += "%" + code.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function tsMediaUrl(baseUrl: string, accountId: string, ref: string): string {
  return `${baseUrl}/v1/media?accountId=${tsUrlEncode(accountId)}&ref=${tsUrlEncode(ref)}`;
}

function tsAssignmentsToggleUrl(baseUrl: string): string {
  return `${baseUrl}/v1/assignments/toggle`;
}

// --- AssignmentsRepository.parse (kotlin) ---
function tsOptString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v : "";
}

function tsFromJson(raw: unknown): Item | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const atts: Attachment[] = [];
  const arr = o["attachments"];
  if (Array.isArray(arr)) {
    for (const entry of arr) {
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const att: Attachment = {
        id: tsOptString(e, "id"),
        label: tsOptString(e, "label"),
        ref: tsOptString(e, "ref"),
      };
      if (!tsAttachmentValid(att)) return null;
      atts.push(att);
    }
  }
  const lcRaw = o["lessonContent"];
  let lc: Lesson | null = null;
  if (typeof lcRaw === "object" && lcRaw !== null) {
    const l = lcRaw as Record<string, unknown>;
    lc = { title: tsOptString(l, "title"), excerpt: tsOptString(l, "excerpt") };
    if (!tsLessonValid(lc)) lc = null;
  }
  return {
    id: tsOptString(o, "id"),
    subject: tsOptString(o, "subject"),
    title: tsOptString(o, "title"),
    dueDate: tsOptString(o, "dueDate"),
    done: o["done"] === true,
    description: tsOptString(o, "description"),
    lessonContent: lc,
    attachments: atts,
    periodId: tsOptString(o, "periodId") || null,
    weekId: tsOptString(o, "weekId") || null,
  };
}

function tsAttachmentValid(a: Attachment): boolean {
  if (a.id.trim() === "") return false;
  if (a.label.trim() === "" || a.label.length > ASSIGNMENT_ATTACHMENT_LABEL_MAX_CHARS) return false;
  if (a.ref.trim() === "" || a.ref.length > ASSIGNMENT_REF_MAX_CHARS) return false;
  if (ABSOLUTE_REF.test(a.ref)) return false;
  return true;
}

function tsLessonValid(c: Lesson): boolean {
  return c.title.trim() !== "" && c.title.length <= 200 && c.excerpt.length <= 500;
}

function tsAssignmentValid(a: Item): boolean {
  if (a.id.trim() === "" || a.subject.trim() === "" || a.title.trim() === "") return false;
  if (a.description.length > ASSIGNMENT_DESCRIPTION_MAX_CHARS) return false;
  if (a.attachments.length > ASSIGNMENT_MAX_ATTACHMENTS) return false;
  if (a.attachments.some((x) => !tsAttachmentValid(x))) return false;
  if (a.lessonContent !== null && !tsLessonValid(a.lessonContent)) return false;
  return true;
}

function tsParse(body: string): Item[] {
  const root = JSON.parse(body) as Record<string, unknown>;
  const arr = Array.isArray(root["assignments"]) ? (root["assignments"] as unknown[]) : [];
  const out: Item[] = [];
  for (const entry of arr) {
    const a = tsFromJson(entry);
    if (a && tsAssignmentValid(a)) out.push(a);
  }
  return out;
}

function tsDayLabel(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : "";
}

// --- Assignments.assignmentsByDay (kotlin) ---
function tsByDay(list: Item[]): [string, Item[]][] {
  const byDay = new Map<string, Item[]>();
  for (const a of list) {
    const day = tsDayLabel(a.dueDate);
    if (day === "") continue;
    const cur = byDay.get(day);
    if (cur) cur.push(a);
    else byDay.set(day, [a]);
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

// Toggle Optimiste : l'affichage bascule puis revient sur échec (mirror Kotlin).
function tsToggleOptimistic(list: Item[], id: string, done: boolean, ok: boolean): Item[] {
  const pending = list.map((a) => (a.id === id ? { ...a, done } : a));
  return ok ? pending : list;
}

const REF = { id: "f1", label: "fiche.pdf", ref: "homework:0:file:0:f1" };
const FULL = {
  id: "a1",
  accountId: "acc1",
  subject: "Maths-Fake",
  title: "Exos p.12",
  dueDate: "2026-10-05T08:00:00.000Z",
  done: false,
  description: "Rendre la fiche",
  lessonContent: { title: "Séance 1", excerpt: "Cours sur les fractions." },
  attachments: [REF],
  periodId: "p-1",
  weekId: "2026-W41",
};

describe("miroir Kotlin devoirs #75", () => {
  test("payload enrichi : l'app voit description, contenu de cours et PJ", () => {
    expect(isAssignmentsResponse({ assignments: [FULL] })).toBe(true);
    const list = tsParse(JSON.stringify({ assignments: [FULL] }));
    expect(list).toHaveLength(1);
    expect(list[0]?.description).toBe("Rendre la fiche");
    expect(list[0]?.lessonContent?.title).toBe("Séance 1");
    expect(list[0]?.attachments[0]?.label).toBe("fiche.pdf");
  });

  test("payload 0.2.0 (sans champs #75) : même parse, aucun champ inventé", () => {
    const legacy = { id: "a0", accountId: "acc1", subject: "SVT-Fake", title: "Liser", dueDate: "2026-10-05T08:00:00.000Z", done: true };
    expect(isAssignmentsResponse({ assignments: [legacy] })).toBe(true);
    const list = tsParse(JSON.stringify({ assignments: [legacy] }));
    expect(list[0]?.description).toBe("");
    expect(list[0]?.lessonContent).toBeNull();
    expect(list[0]?.attachments).toEqual([]);
  });

  test("ref en URL absolue : devoir REJETÉ (aucune URL Pronote dans l'app)", () => {
    for (const ref of [
      "https://pronote.example.invalid/fichiers/x.pdf",
      "http://example.invalid/fichiers/x.pdf",
      "//example.invalid/fichiers/x.pdf",
      "data:application/pdf;base64,AAAA",
    ]) {
      const payload = { assignments: [{ ...FULL, attachments: [{ ...REF, ref }] }] };
      expect({ ref, parsed: tsParse(JSON.stringify(payload)).length }).toEqual({ ref, parsed: 0 });
    }
    // Aucune des refs rejetées n'est acceptée par le contrat TS non plus.
    expect(isAssignment({ ...FULL, attachments: [{ ...REF, ref: "//x/y" }] })).toBe(false);
    expect(tsMediaUrl("https://srv.example.test", "acc1", REF.ref)).toBe(
      "https://srv.example.test/v1/media?accountId=acc1&ref=homework%3A0%3Afile%3A0%3Af1",
    );
  });

  test("groupe par jour : badge semaine dérivé de dueDate, ordre croissant", () => {
    const list = tsParse(
      JSON.stringify({
        assignments: [
          { ...FULL, id: "a-jeudi", dueDate: "2026-10-08T08:00:00.000Z" },
          { ...FULL, id: "a-lundi", dueDate: "2026-10-05T08:00:00.000Z" },
          { ...FULL, id: "a-jeudi2", dueDate: "2026-10-08T18:00:00.000Z" },
        ],
      }),
    );
    const days = tsByDay(list);
    expect(days.map(([day]) => day)).toEqual(["2026-10-05", "2026-10-08"]);
    expect(days[1]?.[1].map((a) => a.id)).toEqual(["a-jeudi", "a-jeudi2"]);
    expect(tsDayLabel("2026-10-05T08:00:00.000Z")).toBe("2026-10-05");
  });

  test("toggle Optimiste avec retour arrière sur échec", () => {
    const list = tsParse(JSON.stringify({ assignments: [FULL] }));
    expect(tsToggleOptimistic(list, "a1", true, true)[0]?.done).toBe(true);
    // Échec (401/409/501/réseau) : retour à l'état du cache, aucun faux "fait".
    expect(tsToggleOptimistic(list, "a1", true, false)[0]?.done).toBe(false);
    // Succès puis resync : le payload serveur fait foi (evenement AssignmentUpdated
    // invalide le cache, le payload rafraîchi rend l'état définitif).
    const resync = tsToggleOptimistic(list, "a1", true, true);
    expect(tsToggleOptimistic(resync, "a1", true, true)).toEqual(list.map((a) => ({ ...a, done: true })));
  });

  test("Kotlin : écran, proxy et câblage sans dépendance ajoutée", () => {
    const core = readFileSync(join(CORE, "Assignment.kt"), "utf8");
    expect(core).toContain("data class AssignmentAttachment");
    expect(core).toContain("ABSOLUTE_REF");
    expect(core).toContain("fun dayLabelFr");
    const repo = readFileSync(join(DATA, "AssignmentsRepository.kt"), "utf8");
    expect(repo).toContain("ServerConfig.assignmentsToggleUrl");
    expect(repo).toContain("fun mediaUrl");
    expect(repo).toContain("ServerConfig.mediaUrl");
    const screen = readFileSync(join(UI, "Assignments.kt"), "utf8");
    expect(screen).toContain("fun assignmentsByDay");
    expect(screen).toContain("AssignmentsRepository.mediaUrl");
    // Toggle Optimiste : retour arrière sur échec, resync du cache sur succès.
    expect(screen).toContain("Retour arrière immédiat");
    expect(screen).toContain("resync du cache");
    // I1 : aucune URL/hôte Pronote/ENT dans le CODE de l'écran (les commentaires
    // sont ignorés, comme dans agents/runtime/check-architecture.ts).
    expect(stripComments(screen)).not.toMatch(/pronote|index-education/i);
    const config = readFileSync(join(CORE, "ServerConfig.kt"), "utf8");
    expect(config).toContain("/v1/media?accountId=");
    expect(config).toContain("/v1/assignments/toggle");
    // org.json vient du SDK : aucune ligne de dépendance ajoutée.
    const uiGradle = readFileSync(join(import.meta.dir, "..", "..", "android/ui/build.gradle.kts"), "utf8");
    expect(uiGradle).not.toContain("gson");
    expect(uiGradle).not.toContain("moshi");
    expect(uiGradle).not.toContain("kotlinx-serialization");
  });
});