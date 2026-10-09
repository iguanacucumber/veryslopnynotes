// Cours : EDT, travaux, et contenus de cours rattachés aux devoirs
// (#75, #76, #197). Déplacé tel quel depuis pronote-client-reader.ts.
// `lessonKey`, `mapLesson` et `lessonContents` restent ici : ce sont les
// SOLEMENTS des travaux, donc un seul propriétaire plutôt qu'un module partagé
// entre deux domaines. Ressources et actualités ont leur propre fichier
// (resources.ts) : même origine `client.lessons`, zéro code commun.
import type { Assignment, AssignmentLessonContent, AttachmentRef, TimetableEntry, TimetableStatus } from "../../../shared/contracts/models";
import {
  ASSIGNMENT_ATTACHMENT_LABEL_MAX_CHARS,
  ASSIGNMENT_DESCRIPTION_MAX_CHARS,
  ASSIGNMENT_LESSON_EXCERPT_MAX_CHARS,
  ASSIGNMENT_LESSON_TITLE_MAX_CHARS,
  ASSIGNMENT_MAX_ATTACHMENTS,
  ASSIGNMENT_REF_MAX_CHARS,
  isAssignment,
  isAttachmentRef,
  isTimetableEntry,
  TIMETABLE_ROOM_MAX_CHARS,
  TIMETABLE_TEACHER_MAX_CHARS,
} from "../../../shared/contracts/models";
import type { PronotePage, PronotePageOptions, PronoteTimetableOptions } from "../../domain/ports";
import { PronoteReadError, PronoteWriteError, untrusted } from "../../domain/ports";
import type { ReaderCtx } from "./primitives";
import {
  bounded,
  clampLimit,
  parseOffset,
  refreshSession,
  resolveAccount,
  toIso,
  toReadError,
  toWriteError,
} from "./primitives";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAssignment(
  accountId: string,
  h: any,
  index: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lesson?: { title: string; excerpt: string } | null,
): Assignment | null {
  const fallback = `a-${index}`;
  const description = typeof h?.description === "string" ? bounded(h.description, ASSIGNMENT_DESCRIPTION_MAX_CHARS) : "";
  const candidate: Assignment = {
    id: typeof h?.id === "string" && h.id ? h.id : fallback,
    accountId,
    subject: h?.subject?.name ?? h?.subject ?? "Matière",
    title: description ? description.slice(0, 200) : "Devoir",
    dueDate: toIso(h?.date, new Date().toISOString()),
    done: h?.done === true,
    // #75 : champs add-only, omis quand Pronote ne les publie pas.
    description: description || undefined,
    lessonContent: lesson ? { title: bounded(lesson.title, ASSIGNMENT_LESSON_TITLE_MAX_CHARS), excerpt: bounded(lesson.excerpt, ASSIGNMENT_LESSON_EXCERPT_MAX_CHARS) } : undefined,
    attachments: mapAssignmentFiles(h, index),
    periodId: typeof h?.period?.id === "string" ? bounded(h.period.id, 64) || undefined : undefined,
    weekId: typeof h?.weekId === "string" ? bounded(h.weekId, 64) || undefined : undefined,
  };
  return isAssignment(candidate) ? candidate : null;
}

// --- #76 EDT : statut annulé/déplacé + prof (parité Papillon onglet EDT) ---
// pronotets ne publie ces champs que selon la configuration de l'établissement :
// champ absent = champ OMIS côté contrat, jamais "normal" deviné ni "" vide.
// Le statut textual est normalisé (pronotets/Pronote francophones) mais reste borné :
// un libellé inconnu = absent, pas un statut inventé.
const STATUS_WORDS: { readonly re: RegExp; readonly status: TimetableStatus }[] = [
  { re: /cancel|annul/i, status: "cancelled" },
  { re: /moved|deplac|déplac/i, status: "moved" },
  { re: /^(normal|normalise|normalisé|ok)$/i, status: "normal" },
];

function toTimetableStatus(raw: unknown): TimetableStatus | undefined {
  if (raw === true) return undefined; // booléen nu : pas de statut deviné.
  if (typeof raw === "string") {
    const s = bounded(raw, 40);
    return STATUS_WORDS.find((w) => w.re.test(s))?.status;
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLessonStatus(l: any): TimetableStatus | undefined {
  // Priorité aux drapeaux booléens (source la plus fiable), sinon statut texte.
  if (l?.isCancelled === true || l?.cancelled === true) return "cancelled";
  if (l?.isMoved === true || l?.isMovedCourse === true) return "moved";
  const text = toTimetableStatus(l?.status ?? l?.state);
  if (text !== undefined) return text;
  // "Drapeau publié explicitement à faux" = normal, sinon aucune information.
  if (l?.isCancelled === false || l?.isMoved === false) return "normal";
  return undefined;
}


// #75 : PJ du devoir via le PROXY SERVEUR. La ref reprend le format déjà résolu
// par media-proxy (`homework:<index>:file:<di>:<fileId>`) : jamais d'URL Pronote
// dans l'app (I1). Pièce sans fichier lisible (ni id ni nom) = ignorée, donc
// l'app n'affiche jamais une ligne morte.
function mapAssignmentFiles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h: any,
  index: number,
): AttachmentRef[] | undefined {
  const files = typeof h?.files === "function" ? (h.files() as unknown[]) : [];
  if (!Array.isArray(files) || files.length === 0) return undefined;
  const out: AttachmentRef[] = [];
  files.slice(0, ASSIGNMENT_MAX_ATTACHMENTS).forEach((f, di) => {
    if (f === null || typeof f !== "object") return;
    const rec = f as Record<string, unknown>;
    const name = typeof rec["name"] === "string" ? bounded(rec["name"], ASSIGNMENT_ATTACHMENT_LABEL_MAX_CHARS) : "";
    const fileId = typeof rec["id"] === "string" ? bounded(rec["id"], ASSIGNMENT_REF_MAX_CHARS) : "";
    if (name === "" || fileId === "") return;
    const cand: AttachmentRef = { id: fileId, label: name, ref: `homework:${index}:file:${di}:${fileId}` };
    if (isAttachmentRef(cand)) out.push(cand);
  });
  return out.length > 0 ? out : undefined;
}

// #75 : le contenu de cours d'un devoir = PageCahierDeTextes de sa séance
// (même matière, même jour). Chaque `content()` = 1 requête Pronote, donc le
// nombre de lessons enrichies est plafonné ; au-delà, `lessonContent` est omis.
// ponytail: recoupement matière+date, pas d'identifiant de séance published par
// pronotets. Upgrade: index de séances construit une fois par semaine.
const ASSIGNMENT_LESSON_FETCH_LIMIT = 10;

/**
 * Jour CALENDRIER local de l'établissement (Europe/Paris), pas jour UTC :
 * un devoir est daté du jour local (minuit Paris) et une séance du jour
 * local, donc l'ISO UTC de part et d'autre tombe la veille après 22h UTC.
 * Les process/tests ne tournent pas forcément en Paris : le fuseau est donc
 * explicite (jamais implicite comme les bornes de getTimetable/getMenus).
 * ponytail: format ISO court (`en-CA` = AAAA-MM-JJ), pas de lib de dates.
 * Upgrade: fuseau configuré par établissement (constante APP_TIME_ZONE).
 */
const APP_TIME_ZONE = "Europe/Paris";
const LOCAL_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE });

function toLocalDay(date: unknown): string | null {
  if (date instanceof Date && !Number.isNaN(date.getTime())) return LOCAL_DAY_FORMAT.format(date);
  if (typeof date === "string" && !Number.isNaN(Date.parse(date))) return LOCAL_DAY_FORMAT.format(new Date(date));
  return null;
}

function lessonKey(subject: unknown, date: unknown): string | null {
  const name = typeof subject === "string" ? subject : (subject as { name?: unknown })?.name;
  if (typeof name !== "string" || name === "") return null;
  const day = toLocalDay(date);
  return day === null ? null : `${name}|${day}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLesson(accountId: string, l: any, index: number): TimetableEntry | null {
  const fallback = `t-${index}`;
  const start = toIso(l?.start, "");
  const end = toIso(l?.end, "");
  if (!start || !end) return null;
  const room = typeof l?.classroom === "string" ? l.classroom : Array.isArray(l?.classrooms) ? l.classrooms[0] : undefined;
  // Prof : nom si publié, sinon absent. Jamais de chaîne vide devinée.
  const rawTeacher = l?.teacher?.name ?? l?.teacher ?? l?.teachers?.[0]?.name;
  const teacher = typeof rawTeacher === "string" ? bounded(rawTeacher, TIMETABLE_TEACHER_MAX_CHARS) : "";
  // Cours déplacé : horaires d'origine si Pronote les publie, sinon absents.
  const originalStart = toIso(l?.originalStart ?? l?.movedStart ?? l?.initialStart, "");
  const originalEnd = toIso(l?.originalEnd ?? l?.movedEnd ?? l?.initialEnd, "");
  const candidate = {
    id: typeof l?.id === "string" && l.id ? l.id : fallback,
    accountId,
    subject: l?.subject?.name ?? l?.subject ?? "Cours",
    room: typeof room === "string" ? bounded(room, TIMETABLE_ROOM_MAX_CHARS) || undefined : undefined,
    start,
    end,
    status: mapLessonStatus(l),
    teacher: teacher === "" ? undefined : teacher,
    originalStart: originalStart === "" ? undefined : originalStart,
    originalEnd: originalEnd === "" ? undefined : originalEnd,
  };
  // Cours illisible (dates, statut hors contrat) : entrée IGNORÉE, jamais
  // rendue à moitié remplie côté app.
  return isTimetableEntry(candidate) ? candidate : null;
}

export async function getAssignments(ctx: ReaderCtx, accountId: string, page?: PronotePageOptions): Promise<PronotePage<Assignment>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("assignments session expired", "session_expired");
  const limit = clampLimit(page?.limit);
  const offset = parseOffset(page?.cursor);
  let client;
  try {
    await refreshSession(ctx, id);
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "assignments");
    ctx.logger(`assignments -> error ${mapped.code}`);
    throw mapped;
  }
  try {
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 86400000);
    const later = new Date(now.getTime() + 21 * 86400000);
    const raw = (await client.homework(from, later)) as unknown[];
    const list = Array.isArray(raw) ? raw : [];
    // #75 : contenus de cours rattachés (plafond de requêtes, cf. mapper).
    const wanted = new Set<string>();
    for (const rawHomework of list) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hw = rawHomework as any;
      const key = lessonKey(hw?.subject?.name ?? hw?.subject, hw?.date);
      if (key !== null) wanted.add(key);
    }
    const lessons = await lessonContents(ctx, client, from, later, wanted);
    const all: Assignment[] = [];
    list.forEach((rawHomework, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = rawHomework as any;
      const key = lessonKey(h?.subject?.name ?? h?.subject, h?.date);
      const m = mapAssignment(id, h, i, (key !== null ? lessons.get(key) : undefined) ?? null);
      if (m) all.push(m);
    });
    const slice = all.slice(offset, offset + limit);
    const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
    ctx.logger(`assignments -> ok ${slice.length}`);
    return { items: untrusted(slice), nextCursor };
  } catch (err) {
    const mapped = toReadError(err, "assignments");
    ctx.logger(`assignments -> error ${mapped.code}`);
    throw mapped;
  }
}

/**
 * #75 : index `matière|jour` → contenu de cours, pour les SEULES clés
 * attendues par les devoirs de la page, plafonné à
 * ASSIGNMENT_LESSON_FETCH_LIMIT requêtes. Tout échec (pas de content(),
 * réseau) = entrée absente : `lessonContent` est alors omis, jamais un texte
 * bidon.
 */
async function lessonContents(
  ctx: ReaderCtx,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  from: Date,
  to: Date,
  wanted: Set<string>,
): Promise<Map<string, AssignmentLessonContent>> {
  const out = new Map<string, AssignmentLessonContent>();
  if (wanted.size === 0) return out;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lessons = (await client.lessons(from, to)) as any[];
    if (!Array.isArray(lessons)) return out;
    let fetched = 0;
    for (const l of lessons) {
      if (fetched >= ASSIGNMENT_LESSON_FETCH_LIMIT) break;
      const key = lessonKey(l?.subject?.name ?? l?.subject, l?.start);
      // Séance sans devoir correspondant = inutile de payer une requête.
      if (key === null || !wanted.has(key) || out.has(key)) continue;
      fetched += 1;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = (await l?.content?.()) as any;
        if (c === null || c === undefined) continue;
        const title = bounded(String(c.title ?? ""), ASSIGNMENT_LESSON_TITLE_MAX_CHARS);
        const excerpt = bounded(String(c.description ?? ""), ASSIGNMENT_LESSON_EXCERPT_MAX_CHARS);
        if (title === "" && excerpt === "") continue;
        out.set(key, { title: title || "Contenu de cours", excerpt });
      } catch {
        // Séance sans contenu publié : entrée absente, pas d'erreur de lecture.
      }
    }
    ctx.logger(`assignments -> contenus ${out.size}`);
  } catch (err) {
    // Séances illisibles : les devoirs sortent sans lessonContent (add-only).
    ctx.logger(`assignments -> contenus indisponibles (${toReadError(err, "assignments").code})`);
  }
  return out;
}

/**
 * #75 : bascule "fait" — ÉCRITURE vers Pronote, action APP confirmée (I7).
 * Jamais appelée depuis une sortie LLM : la seule porte d'entrée est
 * POST /v1/assignments/toggle (server/api/assignments.ts).
 * Erreurs typées : `unsupported` si l'adaptateur n'expose pas setDone,
 * `session_expired` (401), `not_found` (409). Jamais de faux succès.
 */
export async function setAssignmentDone(ctx: ReaderCtx, accountId: string, assignmentId: string, done: boolean): Promise<Assignment> {
  const id = resolveAccount(ctx, accountId);
  const target = (assignmentId ?? "").trim();
  if (!id) throw new PronoteWriteError("toggle session expired", "session_expired");
  if (!target) throw new PronoteWriteError("toggle not found", "not_found");
  let client;
  try {
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toWriteError(err, "toggle");
    ctx.logger(`assignments -> toggle error ${mapped.code}`);
    throw mapped;
  }
  try {
    const now = new Date();
    const raw = (await client.homework(new Date(now.getTime() - 7 * 86400000), new Date(now.getTime() + 21 * 86400000))) as unknown[];
    const list = Array.isArray(raw) ? raw : [];
    const index = list.findIndex((h) => (h as { id?: unknown })?.id === target);
    if (index < 0) {
      ctx.logger("assignments -> toggle not_found");
      throw new PronoteWriteError("toggle not found", "not_found");
    }
    const found = list[index] as { setDone?: (status: boolean) => Promise<void> };
    if (typeof found?.setDone !== "function") {
      ctx.logger("assignments -> toggle unsupported");
      throw new PronoteWriteError("toggle unsupported", "unsupported");
    }
    await found.setDone(done);
    const mapped = mapAssignment(id, list[index], index);
    if (!mapped) throw new PronoteWriteError("toggle not found", "not_found");
    // Compteur seul dans les logs : jamais d'identifiant de devoir journalisé.
    ctx.logger("assignments -> toggle ok");
    return { ...mapped, done };
  } catch (err) {
    if (err instanceof PronoteWriteError) throw err;
    const mapped = toWriteError(err, "toggle");
    ctx.logger(`assignments -> toggle error ${mapped.code}`);
    throw mapped;
  }
}

export async function getTimetable(ctx: ReaderCtx, accountId: string, options?: PronoteTimetableOptions): Promise<PronotePage<TimetableEntry>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("timetable session expired", "session_expired");
  let from = new Date(Date.now() - 7 * 86400000);
  let to = new Date(Date.now() + 7 * 86400000);
  if (options?.from !== undefined) {
    if (typeof options.from !== "string" || Number.isNaN(Date.parse(options.from))) {
      throw new PronoteReadError("timetable pronote unavailable", "pronote_unavailable");
    }
    from = new Date(options.from);
  }
  if (options?.to !== undefined) {
    if (typeof options.to !== "string" || Number.isNaN(Date.parse(options.to))) {
      throw new PronoteReadError("timetable pronote unavailable", "pronote_unavailable");
    }
    to = new Date(options.to);
  }
  const limit = clampLimit(options?.limit);
  const offset = parseOffset(options?.cursor);
  // #76 : bornes UTC explicites de la fenêtre (l'app demande une semaine via
  // weekStart, résolu en from/to par le routeur) — pas de fuseau implicite.
  // Fenêtre appliquée côté reader comme getMenus : la lib aligne sur ses
  // semaines, on re-borne sur la fenêtre demandée (cours illisible filtré au mapping).
  const fromMs = from.getTime();
  const toMs = to.getTime();
  let client;
  try {
    await refreshSession(ctx, id);
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "timetable");
    ctx.logger(`timetable -> error ${mapped.code}`);
    throw mapped;
  }
  try {
    const raw = (await client.lessons(from, to)) as unknown[];
    const all: TimetableEntry[] = [];
    // Index bruts monotones (cf. getGrades) : un cours écarté par la fenêtre
    // ne décale plus les ids de repli des cours suivants.
    let seq = 0;
    (Array.isArray(raw) ? raw : []).forEach((l) => {
      const mapped = mapLesson(id, l, seq++);
      if (mapped && Date.parse(mapped.start) >= fromMs && Date.parse(mapped.start) <= toMs) all.push(mapped);
    });
    const slice = all.slice(offset, offset + limit);
    const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
    ctx.logger(`timetable -> ok ${slice.length}`);
    return { items: untrusted(slice), nextCursor };
  } catch (err) {
    const mapped = toReadError(err, "timetable");
    ctx.logger(`timetable -> error ${mapped.code}`);
    throw mapped;
  }
}
