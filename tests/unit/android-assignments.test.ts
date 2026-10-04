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
// Assignments.kt, AssignmentsSections.kt, ServerConfig.kt) — doivent rester en
// sync. org.json = SDK Android, aucune dépendance ajoutée (le build Gradle n'est
// pas exécuté par `make check`). Instants injectés : aucun Date.now()
// incontrôlé.
//
// Ce que ce test PROUVE pour #138 (logique pure de l'écran Devoirs) :
//   - le RANGEMENT par section (en retard / aujourd'hui / à venir / terminés),
//     y compris les deux décisions qui ne vont pas de soi : le FAIT prime sur la
//     date, et la comparaison se fait au JOUR (un devoir de ce matin reste
//     « aujourd'hui », il ne devient pas « en retard » à 14 h) ;
//   - le filtre matière + la recherche sans casse NI accent ;
//   - la fenêtre de semaine : lundi ISO, ± n semaines, numéro de semaine, plage
//     affichée — les quatre valeurs qui partent dans la query de l'API ;
//   - par lecture de la source : la carte, la pastille « fait », les sections
//     repliées, `weight(1f)`, l'`Intent` des pièces jointes, et l'absence de
//     toute dépendance ajoutée.
//
// #161 (capture du 4 octobre) : la consigne s'affichait deux fois, la pastille de
// matière était vide, « Aide devoirs » dominait la carte, les puces de matière
// criaient en majuscules. Ces quatre points sont prouvés ici —
// `assignmentCardText`, `subjectInitial`, `subjectDisplayFr` ont des miroirs, et
// le déclencheur d'aide est vérifié PAR LECTURE de source (la puce est à côté de
// la bascule, plus le bouton vert).

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

// --- AssignmentsSections.kt (logique pure #138) -------------------------------
//
// Même zone que le miroir de `relativeTimeFr` (android-pap-components.test.ts) :
// `java.time.atZone` prend une ZoneId, donc le miroir prend une timeZone IANA,
// et NOW est injecté — sinon « aujourd'hui » dépendrait de l'heure du test.

const ZONE = "Europe/Paris";
/** 2026-10-04 14:00 à Paris : un DIMANCHE, sa semaine commence le 28/09. */
const NOW = Date.UTC(2026, 9, 4, 12, 0);

// Miroir de `relativeTimeFr` (PapComponents.kt #136), recopié depuis
// android-pap-components.test.ts où ses branches sont testées une par une : ici
// il ne sert qu'à prouver que l'échéance d'un devoir passe par les seuils
// français déjà éprouvés (« il y a 3 jours », « demain 08:00 »…).
const MIN = 60_000;
const HOUR = 3_600_000;

function tsRelativeTimeFr(epochMillis: number, now: number, zone: string = ZONE): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (ms: number): Record<string, string> => {
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = part.value;
    const y = Number(p.year), m = Number(p.month), d = Number(p.day);
    return { hh: p.hour, mm: p.minute, day: String(Date.UTC(y, m - 1, d)) };
  };
  const delta = epochMillis - now;
  const gap = Math.abs(delta);
  const past = delta < 0;
  if (gap < MIN) return "à l'instant";
  const minutes = Math.floor(gap / MIN);
  if (minutes < 60) return past ? `il y a ${minutes} min` : `dans ${minutes} min`;
  const hours = Math.floor(gap / HOUR);
  const there = parts(epochMillis);
  const today = parts(now);
  if (there.day === today.day) return past ? `il y a ${hours} h` : `dans ${hours} h`;
  const clock = `${there.hh}:${there.mm}`;
  const dayMs = Number(there.day);
  const todayMs = Number(today.day);
  if (past && dayMs === todayMs - 86_400_000) return `hier ${clock}`;
  if (!past && dayMs === todayMs + 86_400_000) return `demain ${clock}`;
  const days = Math.abs(dayMs - todayMs) / 86_400_000;
  if (days < 7) return past ? `il y a ${days} jours` : `dans ${days} jours`;
  const there2 = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const p: Record<string, string> = {};
  for (const part of there2.formatToParts(new Date(epochMillis))) if (part.type !== "literal") p[part.type] = part.value;
  return `${p.day}/${p.month}/${p.year}`;
}

/** Jour civil local (« 2026-10-04 ») : le jour UTC serait le bug d'offset. */
function tsLocalDay(millis: number, zone: string = ZONE): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(millis),
    );
  } catch {
    return "";
  }
}

/** Miroir de `foldFr` : minuscules sans accent (NFD + diacritiques retirés).
 *  Le Kotlin utilise `\p{InCombiningDiacriticalMarks}`, que le moteur de regex de
 *  Bun ne connaît pas : la PLAGE des diacritiques combinants suffit au français
 *  (accent aigu, grave, circonflexe, tréma, cédille). */
function tsFoldFr(value: string): string {
  return value
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[̀-ͯ]+/g, "")
    .trim();
}

/** Miroir de `assignmentDueMillis` : `Instant.parse` n'accepte que l'instant ISO
 *  COMPLET. JS `Date.parse` est plus permissif (il mange « 2026-10-05 »), donc
 *  c'est le motif qui décide ici, sinon le miroir serait plus large que le Kotlin. */
function tsDueMillis(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Miroir de `LocalDate.parse` : « AAAA-MM-JJ » uniquement, et un vrai jour. */
function tsIsoDate(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** Miroir de `assignmentDay(iso, zone)` : instant OU date seule. */
function tsAssignmentDay(iso: string, zone: string = ZONE): string | null {
  const ms = tsDueMillis(iso);
  if (ms !== null) {
    const day = tsLocalDay(ms, zone);
    return day === "" ? null : day;
  }
  return tsIsoDate(iso);
}

const SECTION_OVERDUE = "overdue";
const SECTION_TODAY = "today";
const SECTION_UPCOMING = "upcoming";
const SECTION_DONE = "done";
const SECTION_TITLES: [string, string][] = [
  [SECTION_OVERDUE, "En retard"],
  [SECTION_TODAY, "Aujourd'hui"],
  [SECTION_UPCOMING, "À venir"],
  [SECTION_DONE, "Terminés"],
];

/** Miroir de `assignmentSectionOf` : le FAIT prime, la comparaison est au JOUR. */
function tsSectionOf(a: Item, nowMillis: number, zone: string = ZONE): string {
  if (a.done) return SECTION_DONE;
  const day = tsAssignmentDay(a.dueDate, zone);
  if (day === null) return SECTION_UPCOMING;
  const today = tsLocalDay(nowMillis, zone);
  if (today === "") return SECTION_UPCOMING;
  if (day < today) return SECTION_OVERDUE;
  return day === today ? SECTION_TODAY : SECTION_UPCOMING;
}

/** Miroir de `assignmentSections` : les dates illisibles sont écartées, les
 *  sections vides absentes, l'ordre est celui de l'écran. */
function tsSections(
  list: Item[],
  nowMillis: number,
  zone: string = ZONE,
): { id: string; title: string; days: [string, Item[]][] }[] {
  const dated = list.filter((a) => tsAssignmentDay(a.dueDate, zone) !== null);
  const out: { id: string; title: string; days: [string, Item[]][] }[] = [];
  for (const [id, title] of SECTION_TITLES) {
    const days = tsByDay(dated.filter((a) => tsSectionOf(a, nowMillis, zone) === id));
    if (days.length > 0) out.push({ id, title, days });
  }
  return out;
}

/** Miroir de `filterAssignments`. */
function tsFilterAssignments(list: Item[], subject: string | null | undefined, query: string): Item[] {
  const wanted = (subject ?? "").trim();
  const needle = tsFoldFr(query);
  return list.filter((a) => {
    const sameSubject = wanted === "" || a.subject.trim() === wanted;
    const matches = needle === "" || tsFoldFr(`${a.subject} ${a.title} ${a.description}`).includes(needle);
    return sameSubject && matches;
  });
}

// --- #161 : ce que la carte affiche vraiment ---------------------------------
//
// Le lecteur serveur (`server/integrations/pronote-client-reader.ts`,
// `mapAssignment`) ne lit qu'UN champ descriptif chez Pronote et le publie
// DEUX fois : `title = description.slice(0, 200)` et `description = le texte
// entier`. Les deux champs arrivaient donc sur la carte, l'un sous la matière
// (sous-titre), l'autre dans le corps — la consigne, deux fois de suite.

/** Miroir de `assignmentCardText` : titre et corps ne peuvent PAS porter le même
 *  texte ; la comparaison se fait sur le texte plié (casse + accents). */
function tsAssignmentCardText(a: Item): { title: string; body: string } {
  const title = a.title.trim();
  const body = a.description.trim();
  if (body === "") return { title, body: "" };
  const foldedTitle = tsFoldFr(title);
  if (foldedTitle !== "" && tsFoldFr(body).startsWith(foldedTitle)) return { title: "", body };
  return { title, body };
}

/** Kotlin `Char.isUpperCase()` : une lettre MAJUSCULE et casée (`cased` implicite
 *  des Properties of Strings, qui sont toutes nonMajuscule ou Majuscule). */
const tsIsUpper = (c: string): boolean => c === c.toUpperCase() && c !== c.toLowerCase();

/** Miroir de `subjectDisplayFr` : « ALLEMAND LV2 » → « Allemand LV2 », et le
 *  premier mot SEUL (le reste porte une abréviation de niveau). */
function tsSubjectDisplayFr(name: string): string {
  const trimmed = name.trim();
  const letters = [...trimmed].filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0 || letters.some((c) => !tsIsUpper(c))) return trimmed;
  const cut = trimmed.indexOf(" ");
  const head = (cut < 0 ? trimmed : trimmed.slice(0, cut)).toLocaleLowerCase("fr-FR");
  const spelled = head.slice(0, 1).toLocaleUpperCase("fr-FR") + head.slice(1);
  return cut < 0 ? spelled : `${spelled} ${trimmed.slice(cut + 1)}`;
}

/** Miroir de `subjectInitial` : première lettre ou chiffre de la matière, en
 *  majuscule ; « ? » si elle n'en a aucune (comme `profileInitials`). */
function tsSubjectInitial(subject: string): string {
  const c = [...subject.trim()].find((ch) => /\p{L}|\p{Nd}/u.test(ch));
  return c ? c.toLocaleUpperCase("fr-FR") : "?";
}

/** Miroir de `weekStartIso` : lundi de la semaine, en ISO court. */
function tsWeekStartIso(millis: number, zone: string = ZONE): string {
  const day = tsLocalDay(millis, zone);
  if (day === "") return "";
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Miroir de `shiftWeekIso` : une chaîne illisible est renvoyée TELLE QUELLE. */
function tsShiftWeekIso(iso: string, weeks: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + 7 * weeks);
  return d.toISOString().slice(0, 10);
}

/** Numéro de semaine ISO (`WeekFields.ISO.weekOfWeekBasedYear`) : le jeudi
 *  décide de l'année, donc le calcul se fait sur le jeudi de la semaine. */
function tsIsoWeekNumber(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const thursday = new Date(d.getTime());
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

function tsWeekLabelFr(iso: string): string {
  if (Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime())) return "Semaine";
  return `Semaine ${tsIsoWeekNumber(iso)}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function tsWeekRangeFr(iso: string): string {
  const start = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return "";
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const short = (d: Date) => `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`;
  const tail =
    end.getUTCFullYear() === start.getUTCFullYear() ? short(end) : `${short(end)}/${end.getUTCFullYear()}`;
  return `${short(start)} – ${tail}`;
}

/** Miroir de `assignmentDueLabel` : relatif si l'instant se parse, jour français
 *  si la dueDate est une date seule, RIEN si la chaîne est illisible. */
function tsAssignmentDueLabel(iso: string, nowMillis: number, zone: string = ZONE): string {
  const ms = tsDueMillis(iso);
  if (ms !== null) return tsRelativeTimeFr(ms, nowMillis, zone);
  const day = tsIsoDate(iso);
  if (day === null) return "";
  const names = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  // Kotlin : `dayOfWeek.value % 7` (lundi = 1 … dimanche = 7 → 0), donc JS
  // `getUTCDay()` (dimanche = 0 … samedi = 6) donne déjà le même indice.
  const index = new Date(`${day}T00:00:00Z`).getUTCDay();
  return `${names[index]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
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
    // I1 : aucune URL/hôte Pronote dans le CODE de l'écran (les commentaires
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

// Semaine de référence : dimanche 4 octobre 2026 à Paris. Les devoirs ci-dessous
// sont datés AU JOUR LOCAL (08:00 Paris = 06:00Z), c'est ce qui décide des
// sections — un décalage d'heure ne doit pas changer le rangement.
const item = (id: string, over: Partial<Item> = {}): Item => ({
  ...FULL,
  id,
  attachments: [],
  lessonContent: null,
  description: "",
  ...over,
});

/** 08:00 à Paris : 06:00Z en octobre (UTC+2). */
const at8 = (day: string) => `${day}T06:00:00Z`;

const WEEK_ITEMS: Item[] = [
  item("retard-vendredi", { subject: "Maths", dueDate: at8("2026-10-02") }),
  item("aujourdhui", { subject: "Maths", dueDate: at8("2026-10-04") }),
  item("demain", { subject: "SVT", dueDate: at8("2026-10-05") }),
  item("apres-demain", { subject: "SVT", dueDate: at8("2026-10-06") }),
  item("retard-ancien", { subject: "Histoire", dueDate: at8("2026-09-30") }),
  item("fait-passe", { subject: "Maths", dueDate: at8("2026-10-01"), done: true }),
  item("fait-futur", { subject: "Histoire", dueDate: at8("2026-10-07"), done: true }),
];

describe("sections, filtres et semaine (#138)", () => {
  test("rangement : en retard, aujourd'hui, à venir, terminés — dans cet ordre", () => {
    const sections = tsSections(WEEK_ITEMS, NOW);
    expect(sections.map((s) => s.id)).toEqual([SECTION_OVERDUE, SECTION_TODAY, SECTION_UPCOMING, SECTION_DONE]);
    expect(sections.map((s) => s.title)).toEqual(["En retard", "Aujourd'hui", "À venir", "Terminés"]);
  });

  test("le FAIT prime sur la date : un devoir rendu reste dans « Terminés »", () => {
    const byId = new Map(tsSections(WEEK_ITEMS, NOW).flatMap((s) => s.days.flatMap(([, l]) => l).map((a) => [a.id, s.id])));
    // Rendu et daté de la semaine prochaine : « À venir » l'avalerait à chaque
    // rechargement, l'utilisateur le reverrait comme un travail à rendre.
    expect(byId.get("fait-futur")).toBe(SECTION_DONE);
    // Rendu et daté de la semaine passée : pas davantage « En retard ».
    expect(byId.get("fait-passe")).toBe(SECTION_DONE);
    // Non rendu, daté du jour même : « Aujourd'hui », pas « En retard » — la
    // comparaison se fait au JOUR, donc l'heure de la journée n'entre pas.
    expect(byId.get("aujourdhui")).toBe(SECTION_TODAY);
    expect(byId.get("retard-vendredi")).toBe(SECTION_OVERDUE);
    expect(byId.get("demain")).toBe(SECTION_UPCOMING);
  });

  test("chaque section garde le regroupement par jour, en ordre croissant", () => {
    const overdue = tsSections(WEEK_ITEMS, NOW)[0]!;
    expect(overdue.days.map(([day]) => day)).toEqual(["2026-09-30", "2026-10-02"]);
    expect(overdue.days.map(([, l]) => l.map((a) => a.id))).toEqual([["retard-ancien"], ["retard-vendredi"]]);
    const upcoming = tsSections(WEEK_ITEMS, NOW)[2]!;
    expect(upcoming.days.map(([day]) => day)).toEqual(["2026-10-05", "2026-10-06"]);
  });

  test("sections vides absentes, date illisible écartée (jamais de retard inventé)", () => {
    expect(tsSections([], NOW)).toEqual([]);
    // dueDate illisible : `assignmentsByDay` en tirerait un jour avec les dix
    // premiers caractères (« pas une da »), donc la carte est écartée plutôt
    // qu'affichée sous un intitulé fabriqué.
    expect(tsSections([item("broke", { dueDate: "pas une date" })], NOW)).toEqual([]);
    expect(tsAssignmentDay("pas une date")).toBeNull();
    expect(tsDueMillis("pas une date")).toBeNull();
    // Date SEULE (« 2026-10-05 ») : acceptée par le contrat, donc elle reste
    // affichée et datée, même si `Instant.parse` la refuse.
    expect(tsAssignmentDay("2026-10-05")).toBe("2026-10-05");
    expect(tsSections([item("jour-seul", { dueDate: "2026-10-05" })], NOW)[0]?.id).toBe(SECTION_UPCOMING);
    // Échéance lisible : relative si l'instant se parse, jour sinon, RIEN si la
    // chaîne est du bruit (jamais un fragment de date affiché).
    expect(tsAssignmentDueLabel("2026-10-02T06:00:00Z", NOW)).toBe("il y a 2 jours");
    expect(tsAssignmentDueLabel("2026-10-05T06:00:00Z", NOW)).toBe("demain 08:00");
    expect(tsAssignmentDueLabel("2026-10-04T12:00:00Z", NOW)).toBe("à l'instant");
    expect(tsAssignmentDueLabel("2026-10-05", NOW)).toBe("lundi 05/10");
    expect(tsAssignmentDueLabel("abcdefghij", NOW)).toBe("");
  });

  test("filtre matière : une matière absente donne l'écran vide, pas la liste entière", () => {
    expect(tsFilterAssignments(WEEK_ITEMS, "Maths", "").map((a) => a.id)).toEqual([
      "retard-vendredi",
      "aujourdhui",
      "fait-passe",
    ]);
    expect(tsFilterAssignments(WEEK_ITEMS, "SVT", "").map((a) => a.id)).toEqual(["demain", "apres-demain"]);
    expect(tsFilterAssignments(WEEK_ITEMS, "Physique", "")).toEqual([]);
    expect(tsFilterAssignments(WEEK_ITEMS, null, "").length).toBe(WEEK_ITEMS.length);
    expect(tsFilterAssignments(WEEK_ITEMS, "", "").length).toBe(WEEK_ITEMS.length);
  });

  test("recherche : sans casse ni accent, sur la matière, le titre et la consigne", () => {
    const list = [
      item("e1", { subject: "Économie", title: "Étude de marché", description: "Rendre le dossier" }),
      item("e2", { subject: "Maths", title: "Exos p.12", description: "Fractions" }),
    ];
    expect(tsFilterAssignments(list, null, "economie").map((a) => a.id)).toEqual(["e1"]);
    expect(tsFilterAssignments(list, null, "ÉTUDE").map((a) => a.id)).toEqual(["e1"]);
    expect(tsFilterAssignments(list, null, "exos").map((a) => a.id)).toEqual(["e2"]);
    expect(tsFilterAssignments(list, null, "dossier").map((a) => a.id)).toEqual(["e1"]);
    expect(tsFilterAssignments(list, null, "zzz")).toEqual([]);
    // Matière + recherche se cumulent.
    expect(tsFilterAssignments(list, "Maths", "economie")).toEqual([]);
    expect(tsFoldFr("Économie")).toBe("economie");
    expect(tsFoldFr("  Ça Va  ")).toBe("ca va");
  });

  test("fenêtre de semaine : lundi ISO, ± n semaines, numéro et plage affichés", () => {
    // NOW = dimanche 4 octobre 2026 à Paris : sa semaine commence le 28/09.
    expect(tsWeekStartIso(NOW)).toBe("2026-09-28");
    // Un lundi reste son propre lundi, quelle que soit l'heure locale.
    expect(tsWeekStartIso(Date.UTC(2026, 8, 28, 22, 30))).toBe("2026-09-28");
    expect(tsWeekStartIso(Date.UTC(2026, 8, 28, 6, 0))).toBe("2026-09-28");
    expect(tsShiftWeekIso("2026-09-28", 1)).toBe("2026-10-05");
    expect(tsShiftWeekIso("2026-09-28", -1)).toBe("2026-09-21");
    expect(tsShiftWeekIso("2026-10-05", -1)).toBe("2026-09-28");
    // Fenêtre illisible : la navigation ne fabrique pas de date.
    expect(tsShiftWeekIso("pas une date", 1)).toBe("pas une date");
    expect(tsWeekLabelFr("2026-09-28")).toBe("Semaine 40");
    expect(tsWeekLabelFr("2026-10-05")).toBe("Semaine 41");
    expect(tsWeekLabelFr("2026-01-01")).toBe("Semaine 1");
    expect(tsWeekLabelFr("pas une date")).toBe("Semaine");
    expect(tsWeekRangeFr("2026-09-28")).toBe("28/09 – 04/10");
    expect(tsWeekRangeFr("2026-12-28")).toBe("28/12 – 03/01/2027");
    expect(tsWeekRangeFr("pas une date")).toBe("");
  });

  test("Kotlin : la semaine part dans la QUERY de l'API, pas dans un filtre local", () => {
    const screen = readFileSync(join(UI, "Assignments.kt"), "utf8");
    // La plage est passée au serveur via ServerConfig (chemin issu de core seul).
    expect(screen).toContain("ServerConfig.assignmentsUrl(baseUrl, null, null, weekStart)");
    expect(screen).toContain("api.buildGet(url.removePrefix(baseUrl))");
    // Changer de semaine RELANCE le chargement (pas de filtre en mémoire).
    expect(screen).toContain("LaunchedEffect(week) { refresh() }");
    expect(screen).toContain("week = shiftWeekIso(week, weeks)");
    // Le sélecteur de semaine ne peut pas écrire une query libre.
    expect(screen).not.toMatch(/"\?from=|"\?weekStart=/);
  });

  test("Kotlin : le fait est visible (pastille pleine, « ✓ Terminé », rayure)", () => {
    const screen = readFileSync(join(UI, "Assignments.kt"), "utf8");
    // AVANT #138 : le seul rendu du `done` était le libellé du bouton.
    expect(screen).not.toContain("Marquer non fait");
    expect(screen).toContain('"✓ Terminé"');
    expect(screen).toContain("TextDecoration.LineThrough");
    expect(screen).toContain("bestContentOn(tint)");
    expect(screen).toContain("LocalHapticFeedback");
    expect(screen).toContain("private fun PapTaskCard");
    // Sections : les quatre libellés français, le repli des terminés.
    for (const label of ["En retard", "Aujourd'hui", "À venir", "Terminés"]) {
      expect(readFileSync(join(UI, "AssignmentsSections.kt"), "utf8")).toContain(label);
    }
    expect(screen).toContain("SECTION_DONE && !doneOpen");
    expect(screen).toContain("stickyHeader");
    // `weight(1f)` : le défaut de #138 était un `LazyColumn` non pondéré.
    expect(screen).toContain("Box(modifier = Modifier.weight(1f))");
    // Consigne bornée (elle peut faire 2000 caractères) + dépliage.
    expect(screen).toContain("DESCRIPTION_MAX_LINES = 3");
    expect(screen).toContain("overflow = TextOverflow.Ellipsis");
    expect(screen).toContain("Voir plus");
  });

  test("Kotlin : pièce jointe = puce cliquable + Intent sur le PROXY, jamais d'hôte tiers", () => {
    const screen = readFileSync(join(UI, "Assignments.kt"), "utf8");
    expect(screen).toContain("private fun AttachmentChips");
    expect(screen).toContain("AssignmentsRepository.mediaUrl(baseUrl, accountId, att.ref)");
    expect(screen).toContain("Intent(Intent.ACTION_VIEW, Uri.parse(url))");
    expect(screen).toContain("context.startActivity(intent)");
    // L'URL du proxy ne doit JAMAIS être journalisée (elle finit dans les logs).
    const code = stripComments(screen);
    expect(code).not.toMatch(/Log\.[diewv]|println\(/);
    // Filtre matière en puces défilables + recherche.
    expect(screen).toContain("private fun SubjectFilterRow");
    expect(screen).toContain("LazyRow");
    expect(screen).toContain("FilterChip");
    expect(screen).toContain('label = { Text("Rechercher un devoir", maxLines = 1) }');
  });

  test("Kotlin : zéro dépendance ajoutée, zéro brique #136 dupliquée", () => {
    const uiGradle = readFileSync(join(import.meta.dir, "..", "..", "android/ui/build.gradle.kts"), "utf8");
    // `androidx.compose.material` (le `pullrefresh` de M2) n'est pas déclaré :
    // l'Actions de rafraîchissement reste donc EXPLICITE, faute de composant
    // dans le BOM gelé.
    expect(uiGradle).not.toContain('"androidx.compose.material:material"');
    // Les briques de #136 sont utilisées, pas réécrites.
    const screen = readFileSync(join(UI, "Assignments.kt"), "utf8");
    for (const brick of ["PapLoading", "PapEmptyState", "PapErrorState", "PapStaleBanner", "PapSubjectAvatar", "PapPill"]) {
      expect(screen).toContain(brick);
    }
    // Aucune couleur en dur : tout vient des jetons du thème.
    const sections = readFileSync(join(UI, "AssignmentsSections.kt"), "utf8");
    expect(stripComments(sections)).not.toMatch(/Color\(|0x[0-9A-Fa-f]{6}/);
    expect(stripComments(screen)).not.toMatch(/Color\(0x|#[0-9A-Fa-f]{6}\"/);
  });
});

// #161 : les quatre défauts relevés sur la capture du 4 octobre.
describe("carte de devoir (#161)", () => {
  /** Le cas RÉEL de la capture : le serveur dérive le titre des 200 premiers
   *  caractères de la consigne, donc les deux champs se recoupent. */
  const CAPTURE = "Evaluation de compréhension orale et d'expression écrite sur le début de la séquence Slogans und Werbung. (relire le cours p.42)";
  const captured = (over: Partial<Item> = {}) =>
    item("allemand-lv2", { subject: "ALLEMAND LV2", title: CAPTURE.slice(0, 200), description: CAPTURE, ...over });

  test("la consigne n'apparaît qu'une fois : le titre n'est plus nourri à côté du corps", () => {
    const card = tsAssignmentCardText(captured());
    // Le titre EST le début de la consigne : il ne descend pas en sous-titre, la
    // consigne garde le corps (borné et dépliable).
    expect(card).toEqual({ title: "", body: CAPTURE });
    // LA propriété qui compte : les deux emplacements ne peuvent pas afficher le
    // même texte — pas « rendu deux fois », quelle que soit la donnée.
    expect(card.title).not.toBe(card.body);
    // Re-casé / ré-accenté par le serveur : le pli le voit, donc toujours pas de doublon.
    expect(tsAssignmentCardText(captured({ title: "évaluation de compréhension orale et d'expression" }))).toEqual({
      title: "",
      body: CAPTURE,
    });
    // Titre plus court que la consigne : il en reste le préfixe, donc toujours
    // un seul texte à l'écran (le lecteur tronque à 200 caractères, il ne coupe
    // pas au hasard).
    expect(tsAssignmentCardText(captured({ title: "Evaluation de compréhension orale" })).title).toBe("");
  });

  test("titre VRAI et consigne distincte : les deux survivent, rien n'est perdu", () => {
    // Un établissement qui publie un intitulé de devoir et une consigne séparés
    // (le contrat les autorise) garde ses deux textes.
    const distinct = item("exos", { subject: "Maths", title: "Exos p.12", description: "Rendre la fiche" });
    expect(tsAssignmentCardText(distinct)).toEqual({ title: "Exos p.12", body: "Rendre la fiche" });
    // Pas de consigne : le titre seul porte la carte (repli « Devoir » du lecteur).
    const sansConsigne = item("liser", { subject: "SVT", title: "Devoir", description: "   " });
    expect(tsAssignmentCardText(sansConsigne)).toEqual({ title: "Devoir", body: "" });
    // Le titre n'est pas un préfixe de la consigne → il reste un sous-titre à part.
    const autre = item("oral", { subject: "ANGLAIS", title: "Oral", description: "Préparer la présentation" });
    expect(tsAssignmentCardText(autre)).toEqual({ title: "Oral", body: "Préparer la présentation" });
  });

  test("Kotlin : la carte ne branche plus `title` ET `description` sur deux Text", () => {
    const screen = readFileSync(join(UI, "Assignments.kt"), "utf8");
    expect(screen).toContain("assignmentCardText(a)");
    const code = stripComments(screen);
    // Le garde-fou du doublon : aucun des deux champs n'alimente plus un `Text`
    // tout seul — ils passent par la répartition (titre, corps).
    expect(code).not.toMatch(/text = a\.description/);
    expect(code).not.toMatch(/text = a\.title\b/);
    expect(code).toMatch(/text = text\.body/);
    // La consigne reste bornée et dépliable (elle peut faire 2000 caractères).
    expect(screen).toContain("DESCRIPTION_MAX_LINES = 3");
    expect(screen).toContain("if (text.body.length > DESCRIPTION_EXPAND_CHARS)");
    // Le « fait » se lit sur le texte affiché, où qu'il soit (rayure + atténuation).
    expect(screen).toContain("val strike = if (a.done) TextDecoration.LineThrough else null");
  });

  test("pastille de matière : toujours un glyphe, et la brique partagée reste intacte", () => {
    const screen = readFileSync(join(UI, "Assignments.kt"), "utf8");
    // Emoji de prefs, sinon INITIALE de la matière — plus jamais `emoji = null`.
    expect(screen).toContain("style.emoji ?: subjectInitial(a.subject)");
    expect(stripComments(screen)).not.toMatch(/PapSubjectAvatar\(emoji = style\.emoji,/);
    expect(tsSubjectInitial("ALLEMAND LV2")).toBe("A");
    expect(tsSubjectInitial("Mathématiques")).toBe("M");
    expect(tsSubjectInitial("histoire-géographie")).toBe("H");
    expect(tsSubjectInitial("  2nde STL")).toBe("2");
    expect(tsSubjectInitial("2nde STL")).toBe("2");
    // Matière sans aucune lettre ni chiffre : un glyphe neutre, PAS une pastille vide.
    expect(tsSubjectInitial("« »")).toBe("?");
    // `PapComponents.kt` est PARTAGÉ (les notes l'utilisent déjà) : il ne doit pas
    // connaître les replis de l'écran Devoirs, la correction est à l'appel.
    const pap = readFileSync(join(UI, "PapComponents.kt"), "utf8");
    expect(pap).toContain("fun PapSubjectAvatar(");
    expect(stripComments(pap)).not.toMatch(/subjectInitial|subjectDisplayFr|assignmentCardText/);
  });

  test("« Aide devoirs » : une puce discrète alignée sur la bascule, pas un bouton vert", () => {
    const screen = readFileSync(join(UI, "Assignments.kt"), "utf8");
    expect(screen).toContain("private fun HomeworkHelpChip");
    // Le `Button` pleine largeur de `HomeworkHelp.kt` n'est plus appelé par la carte…
    expect(stripComments(screen)).not.toMatch(/HomeworkHelpButton/);
    // …et la puce est COLLÉE à la bascule « fait », qui redevient l'action visible.
    expect(screen).toMatch(/HomeworkHelpChip \{ onHelp\(a\) \}\n\s*DoneToggle/);
    // La puce reprend la langue visuelle des pièces jointes (pas de couleur en dur).
    expect(screen).toContain('text = "Aide devoirs"');
    // Le DIALOGUE LLM, lui, est toujours câblé et inchangé (sortie = donnée, I6).
    expect(screen).toContain("HomeworkHelpDialog(");
    expect(screen).toContain("if (helpRepo == null) null else");
  });

  test("matière : la casse publiée, sans les majuscules qui crient", () => {
    expect(tsSubjectDisplayFr("ALLEMAND LV2")).toBe("Allemand LV2");
    expect(tsSubjectDisplayFr("ALLEMAND ANGLAIS LV2")).toBe("Allemand ANGLAIS LV2");
    expect(tsSubjectDisplayFr("  ALLEMAND  ")).toBe("Allemand");
    // Une matière qui a sa propre casse n'est pas réécrite (préf. saisie à la main).
    expect(tsSubjectDisplayFr("Mathématiques")).toBe("Mathématiques");
    expect(tsSubjectDisplayFr("Anglais LV2")).toBe("Anglais LV2");
    expect(tsSubjectDisplayFr("LV2")).toBe("Lv2");
    expect(tsSubjectDisplayFr("")).toBe("");
    expect(tsSubjectDisplayFr("2nde STL")).toBe("2nde STL");
    // Les deux appels (carte ET puce de filtre) passent par le même résolveur.
    const screen = readFileSync(join(UI, "Assignments.kt"), "utf8");
    expect(screen).toContain("subjectDisplayFr(style.label)");
    expect(screen).toContain("style.copy(label = subjectDisplayFr(style.label))");
  });

  test("#166 : le dépliage est un LIBELLÉ, plus un bouton de 48 dp qui creuse un vide", () => {
    // Le défaut, mesuré sur la capture du 04/10 : la rangée du bas (« Aide
    // devoirs » + bascule) était repoussée par un grand vide, et la cause n'était
    // ni un `weight(1f)` ni une hauteur fixe — c'était le `TextButton` « Voir
    // plus ». `Button` de material3 impose `minimumInteractiveComponentSize()`
    // (48 dp) puis `sizeIn(minHeight = 40.dp)`, donc sa boîte fait 48 dp pour un
    // libellé `labelSmall` de ~16 dp : 32 dp de vide, 16 en-dessus et 16 en-
    // dessous, dont la moitié tombait entre la consigne et la rangée du bas.
    const screen = readFileSync(join(UI, "Assignments.kt"), "utf8");
    const code = stripComments(screen);
    // Le dépliage n'est plus un bouton…
    expect(code).not.toMatch(/TextButton\([\s\S]{0,200}Voir plus/);
    // …c'est un libellé cliquable, dans la couleur du thème. #146 : l'accent
    // passe de `primary` (3.74:1, sous AA en 13 sp) à `secondary` (4.93:1) —
    // même vert à l'œil, lisible en texte.
    expect(code).toMatch(/text = if \(expanded\) "Réduire" else "Voir plus"/);
    expect(code).toMatch(/color = MaterialTheme\.colorScheme\.secondary/);
    // Le geste reste nommé pour un lecteur d'écran (on n'a pas échangé une
    // hauteur pour un silence).
    expect(code).toMatch(/onClickLabel = if \(expanded\)/);
    expect(code).toMatch(/role = Role\.Button/);
    // Le `Box(weight(1f))` de la rangée du bas est un poids de RANGÉE : c'est
    // l'espaceur qui colle la bascule à droite. Il reste, et le test le dit —
    // c'était l'hypothèse du défaut, et elle était fausse.
    expect(code).toMatch(/Row\([\s\S]{0,400}Box\(modifier = Modifier\.weight\(1f\)\)/);
    // Et AUCUNE hauteur fixe dans la carte : rien ne réserve de place à la rangée
    // du bas, donc elle se colle au contenu comme le veut le défaut. (Les
    // `weight(1f)` restants sont tous des poids de `Row`, donc horizontaux :
    // la colonne interne de l'en-tête et l'espaceur du bas.)
    const carte = code.slice(code.indexOf("private fun PapTaskCard"), code.indexOf("private fun HomeworkHelpChip"));
    expect(carte).not.toMatch(/fillMaxHeight|requiredHeight|\bheight\(|\bheightIn\(|Spacer\(Modifier\.height/);
  });
});
