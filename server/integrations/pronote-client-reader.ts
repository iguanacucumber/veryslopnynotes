// Lectures via Client pronotets (session Pronote).
// Hiérarchie : Domain → PronoteReader → PronoteClientReader → pronotets → HTTP (I2).
// Sorties marquées Untrusted (I6). Erreurs typées sans secret.
// Pagination : limit clampée 1..100 (défaut 50), cursor = offset opaque, nextCursor null = fin.
// Mappers : Grade pronotets (grade/outOf strings) → contrat (value/scale numbers).
// ponytail: mappers purs minimaux, pas de lib date.
// #74 : moyennes de classe (average/min/max), bonus, facultative, période et
// libellé repris de pronotets Grade. Les moyennes *de matière* et *générale*
// fournies par l'établissement (period.averages()/overallAverage()) ne sont pas
// encore lues : ProvidedAverages reste null, les rapports sont donc estimés,
// ce qui est le comportement Papillon par défaut. Upgrade: getProvidedAverages
// sur ce reader, sans toucher aux trois algorithmes.
import type { AbsenceRecord, Assignment, AssignmentLessonContent, AttachmentRef, CanteenMeal, CanteenMenu, Capabilities, ChildAccount, Discussion, Evaluation, Grade, Message, NewsItem, Period, Punishment, Recipient, RecipientKind, TimetableEntry, TimetableStatus, UserInfo } from "../../shared/contracts/models";
import { ABSENCE_MOTIF_MAX_CHARS, ABSENCE_SUBJECT_MAX_CHARS, ASSIGNMENT_ATTACHMENT_LABEL_MAX_CHARS, ASSIGNMENT_DESCRIPTION_MAX_CHARS, ASSIGNMENT_LESSON_EXCERPT_MAX_CHARS, ASSIGNMENT_LESSON_TITLE_MAX_CHARS, ASSIGNMENT_MAX_ATTACHMENTS, ASSIGNMENT_REF_MAX_CHARS, CANTEEN_MAX_ALLERGEN_CHARS, CANTEEN_MAX_ALLERGENS, CANTEEN_MAX_DISH_CHARS, CANTEEN_MAX_DISHES, DISCUSSION_ID_MAX_CHARS, DISCUSSION_MAX_PARTICIPANTS, DISCUSSION_MAX_UNREAD, DISCUSSION_PARTICIPANT_MAX_CHARS, DISCUSSION_SUBJECT_MAX_CHARS, EVALUATION_LABEL_MAX_CHARS, isAbsenceRecord, isAssignment, isAttachmentRef, isCanteenMenu, isChildAccount, isDiscussion, isEvaluation, isGrade, isMessage, isNewsItem, isOpaquePhotoRef, isPeriod, isPunishment, isRecipient, isTimetableEntry, isUserInfo, MESSAGE_AUTHOR_MAX_CHARS, MESSAGE_BODY_MAX_CHARS, NEWS_BODY_MAX_CHARS, NEWS_META_MAX_CHARS, NEWS_TITLE_MAX_CHARS, PHOTO_REF_PREFIX, PUNISHMENT_MOTIF_MAX_CHARS, PUNISHMENT_TYPE_MAX_CHARS, RECIPIENT_NAME_MAX_CHARS, TIMETABLE_ROOM_MAX_CHARS, TIMETABLE_TEACHER_MAX_CHARS, USER_CLASS_MAX_CHARS, USER_MAX_KIDS, USER_NAME_MAX_CHARS } from "../../shared/contracts/models";
import type { PedagogicResource, PronotePage, PronotePageOptions, PronoteReader, PronoteTimetableOptions } from "../domain/ports";
import { isPedagogicResource, PronoteAuthError, PronoteReadError, PronoteWriteError, untrusted } from "../domain/ports";
import { capabilitiesFromProbe } from "../domain/capabilities";


export interface PronoteClientReaderOptions {
  /** Résolveur session injecté (PronoteSessionStore.requireClient). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly sessions: { requireClient(accountId: string): any; currentAccountId?(): string | null; refreshSession?(accountId: string): Promise<void> };
  readonly logger?: (message: string) => void;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
// #79 : le corps d'une actuité coûte 1 requête Pronote (content()) : on plafonne
// le nombre de corps téléchargés par page. Upgrade: endpoint contenu groupé.
const NEWS_BODY_FETCH_LIMIT = 20;

function clampLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  const n = Math.floor(limit);
  if (n < 1) return DEFAULT_LIMIT;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

function parseOffset(cursor?: string): number {
  if (typeof cursor !== "string") return 0;
  const n = Number.parseInt(cursor.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Chaîne vide / espaces = valeur absente (non notée), jamais 0 : Number("")
// vaut 0 et ferait passer une note ou une moyenne de classe inexistante.
function toNumber(v: unknown, fallback: number): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return fallback;
    const n = Number(t.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toIso(d: unknown, fallback: string): string {
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  if (typeof d === "string" && !Number.isNaN(Date.parse(d))) return new Date(d).toISOString();
  return fallback;
}

function toReadError(err: unknown, what: string): PronoteReadError {
  if (err instanceof PronoteReadError) return err;
  if (err instanceof PronoteAuthError) {
    if (err.code === "session_expired") return new PronoteReadError(`${what} session expired`, "session_expired");
    if (err.code === "timeout") return new PronoteReadError(`${what} timeout`, "timeout");
    if (err.code === "network") return new PronoteReadError(`${what} network`, "network");
    return new PronoteReadError(`${what} pronote unavailable`, "pronote_unavailable");
  }
  const msg = err instanceof Error ? err.message : "";
  if (/session|expired|expir/i.test(msg)) return new PronoteReadError(`${what} session expired`, "session_expired");
  if (/timeout|timed out/i.test(msg)) return new PronoteReadError(`${what} timeout`, "timeout");
  if (/network|fetch failed|injoignable/i.test(msg)) return new PronoteReadError(`${what} network`, "network");
  return new PronoteReadError(`${what} pronote unavailable`, "pronote_unavailable");
}

/** Écriture (#75) : mêmes classes d'erreur que la lecture, plus `unsupported`. */
function toWriteError(err: unknown, what: string): PronoteWriteError {
  if (err instanceof PronoteWriteError) return err;
  if (/unsupported|not.?implemented/i.test(err instanceof Error ? err.message : "")) {
    return new PronoteWriteError(`${what} unsupported`, "unsupported");
  }
  const read = toReadError(err, what);
  const code = read.code === "session_expired" ? "session_expired" : read.code;
  return new PronoteWriteError(`${what} ${code}`, code);
}

/**
 * Trim + borne dure. Vide après trim = "" (l'appelant le transforme en undefined).
 * La borne compte en POINTS DE CODE, comme `isOptionalBoundedString` du contrat
 * (models.ts) : un slice() en unités UTF-16 couperait un surrogate pair en son
 * demi-caractère orphelin, que le contrat rejetera ensuite (ou que le client
 * affichera en U+FFFD). Le chemin rapide `t.length <= max` (unités UTF-16) est
 * sûr : un texte plus court que la borne ne peut pas avoir de point de code en
 * excès, donc aucun couple ne peut être coupé.
 */
function bounded(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const points = [...t];
  return points.length > max ? points.slice(0, max).join("") : t;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGrade(accountId: string, g: any, index: number, periodId?: string): Grade | null {
  const fallback = `g-${index}`;
  const candidate = {
    id: typeof g?.id === "string" && g.id ? g.id : fallback,
    accountId,
    subject: g?.subject?.name ?? g?.subject ?? "Matière",
    value: toNumber(g?.grade, Number.NaN),
    scale: toNumber(g?.outOf ?? g?.defaultOutOf, 20),
    coefficient: g?.coefficient !== undefined ? toNumber(g.coefficient, 1) : undefined,
    date: toIso(g?.date, new Date().toISOString()),
    // #74 : moyennes de classe, bonus/facultative, période, libellé enseignant.
    // Le contrat est borné (200 chars pour le libellé) : une chaîne Pronote
    // arbitrairement longue ne sort jamais telle quelle côté API.
    classAverage: g?.average !== undefined ? toNumber(g.average, Number.NaN) : undefined,
    classMin: g?.min !== undefined ? toNumber(g.min, Number.NaN) : undefined,
    classMax: g?.max !== undefined ? toNumber(g.max, Number.NaN) : undefined,
    periodId: periodId ?? (typeof g?.period?.id === "string" ? bounded(g.period.id, 64) || undefined : undefined),
    bonus: g?.isBonus === true ? true : undefined,
    optional: g?.isOptionnal === true ? true : undefined,
    label: typeof g?.comment === "string" ? bounded(g.comment, 200) || undefined : undefined,
  };
  if (!Number.isFinite(candidate.value)) return null;
  // isGrade rejette les moyennes de classe illisibles (absent, "N.Rendu", ...) :
  // on les retire plutôt que de laisser un NaN ou un 0 trompeur dans le contrat.
  const clean: Grade = {
    ...candidate,
    ...(Number.isFinite(candidate.classAverage as number) ? {} : { classAverage: undefined }),
    ...(Number.isFinite(candidate.classMin as number) ? {} : { classMin: undefined }),
    ...(Number.isFinite(candidate.classMax as number) ? {} : { classMax: undefined }),
  };
  return isGrade(clean) ? clean : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPeriods(raw: any[]): Period[] {
  const out: Period[] = [];
  raw.forEach((p, i) => {
    const start = toIso(p?.start, "");
    const end = toIso(p?.end, "");
    if (!start || !end) return;
    const cand: Period = {
      id: typeof p?.id === "string" && p.id ? p.id : `period-${i}`,
      name: typeof p?.name === "string" && p.name.trim() ? p.name.trim().slice(0, 100) : `Période ${i + 1}`,
      start,
      end,
    };
    if (isPeriod(cand)) out.push(cand);
  });
  return out;
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapResources(accountId: string, lessons: any[], homeworks?: any[]): PedagogicResource[] {
  const out: PedagogicResource[] = [];
  lessons.forEach((l, li) => {
    const subject = l?.subject?.name ?? l?.subject ?? "Matière";
    const subj = typeof subject === "string" ? subject : "Matière";
    // Contenus de cours (LessonContent : title + description + files).
    const content = typeof l?.contentValue === "object" && l.contentValue !== null ? l.contentValue : null;
    if (content && (typeof content.title === "string" || typeof content.description === "string")) {
      const title = (typeof content.title === "string" && content.title.trim() ? content.title : "Contenu de cours").slice(0, 200);
      const excerpt = (typeof content.description === "string" ? content.description : "").slice(0, 500);
      const cand: PedagogicResource = {
        id: `r-lesson-${li}`,
        accountId,
        subject: subj,
        title,
        excerpt,
        origin: "lesson-content",
        ref: `lesson:${li}:content`,
      };
      if (isPedagogicResource(cand)) out.push(cand);
    }
    const pushFile = (d: unknown, di: number, prefix: string) => {
      // Pièce nulle ou non-objet (même forme sale que `homework.files()`) :
      // IGNORÉE, sinon toute la lecture des ressources tombe sur un TypeError.
      if (d === null || typeof d !== "object") return;
      const rec = d as Record<string, unknown>;
      const name = typeof rec["name"] === "string" ? (rec["name"] as string) : `doc-${di}`;
      const fileId = typeof rec["id"] === "string" ? (rec["id"] as string) : "";
      const cand: PedagogicResource = {
        id: `r-${prefix}-${li}-${di}`,
        accountId,
        subject: subj,
        title: name.slice(0, 200),
        excerpt: name.slice(0, 500),
        origin: "homework-file",
        // Réf opaque : index stables + id fichier (jamais URL directe en app, proxy serveur).
        ref: `lesson:${li}:${prefix}:${di}:${fileId}`.slice(0, 200),
      };
      if (isPedagogicResource(cand)) out.push(cand);
    };
    const docs = Array.isArray(l?.homeworkDocuments) ? l.homeworkDocuments : [];
    docs.forEach((d: unknown, di: number) => pushFile(d, di, "doc"));
    const cfiles = Array.isArray(content?.files) ? content.files : [];
    cfiles.forEach((d: unknown, di: number) => pushFile(d, di, "content-file"));
  });
  (homeworks ?? []).forEach((h, hi) => {
    const subject = h?.subject?.name ?? h?.subject ?? "Matière";
    const subj = typeof subject === "string" ? subject : "Matière";
    const files = typeof h?.files === "function" ? (h.files() as unknown[]) : [];
    files.forEach((d: unknown, di: number) => {
      // Même garde que les PJ de séance : un élément nul de la liste des
      // devoirs est ignoré, pas indexé.
      if (d === null || typeof d !== "object") return;
      const rec = d as Record<string, unknown>;
      const name = typeof rec["name"] === "string" ? (rec["name"] as string) : `doc-${di}`;
      const fileId = typeof rec["id"] === "string" ? (rec["id"] as string) : "";
      const cand: PedagogicResource = {
        id: `r-hw-${hi}-${di}`,
        accountId,
        subject: subj,
        title: name.slice(0, 200),
        excerpt: name.slice(0, 500),
        origin: "homework-file",
        ref: `homework:${hi}:file:${di}:${fileId}`.slice(0, 200),
      };
      if (isPedagogicResource(cand)) out.push(cand);
    });
  });
  return out;
}

// #78 : évaluations par compétences. pronotets `Evaluation` ne porte la note
// que selon la configuration de l'établissement : champ absent = omitted,
// `note: null` (non noté), jamais 0. Onglet "évaluations" absent de la période
// = page vide, pas une erreur.
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function toHexColor(v: unknown): string | undefined {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return s !== "" && HEX_COLOR.test(s) ? s.toLowerCase() : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvaluation(accountId: string, e: any, index: number, periodId?: string): Evaluation | null {
  const rawSubject = e?.subject?.name ?? e?.subject;
  const subject = typeof rawSubject === "string" ? bounded(rawSubject, 100) : "";
  // Compétence = domaine d'acquisition de l'évaluation (pronotets acquisitions).
  const acquisition = Array.isArray(e?.acquisitions) ? e.acquisitions[0] : undefined;
  const rawSkill = acquisition?.domainId ?? acquisition?.name ?? e?.domain ?? e?.domainId;
  const skillId = rawSkill === undefined || rawSkill === null || String(rawSkill).trim() === ""
    ? `skill-${index}`
    : bounded(String(rawSkill), 64);
  const rawLabel = typeof e?.name === "string" ? bounded(e.name, EVALUATION_LABEL_MAX_CHARS) : "";
  const note = toNumber(e?.grade ?? e?.value, Number.NaN);
  // Moyenne de classe illisible ("N.Rendu", "") : omitted, jamais 0.
  const classAverage = e?.average !== undefined ? toNumber(e.average, Number.NaN) : Number.NaN;
  const candidate: Evaluation = {
    id: typeof e?.id === "string" && e.id ? bounded(e.id, 64) : `ev-${index}`,
    accountId,
    periodId,
    subject: subject || "Matière",
    skillId,
    label: rawLabel || "Évaluation",
    // Note non publiée / non notée = null : ignorée par tous les calculs.
    note: Number.isFinite(note) ? note : null,
    scale: toNumber(e?.outOf ?? e?.defaultOutOf, 20),
    date: toIso(e?.date, new Date().toISOString()),
    classAverage: Number.isFinite(classAverage) ? classAverage : undefined,
    color: toHexColor(acquisition?.color ?? e?.color),
  };
  return isEvaluation(candidate) ? candidate : null;
}


/**
 * #79 : actu établissement (Information pronotets). Tous les textes passent par
 * bounded() et le contrat est validé par isNewsItem : champs absents ou date
 * illisible = valeurs sûres (titre de repli, publishedAt = maintenant), jamais
 * de chaîne brute ni de date "NaN" côté API.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mapNews(accountId: string, raw: any, index: number, withBody: boolean): Promise<NewsItem | null> {
  const id = typeof raw?.id === "string" && raw.id.trim() ? bounded(raw.id, 64) : `news-${index}`;
  let body = "";
  if (withBody) {
    // content() = 1 requête Pronote par actu ; peut échouer (pièce absente).
    try {
      const c = typeof raw?.content === "function" ? await raw.content() : "";
      body = typeof c === "string" ? bounded(c, NEWS_BODY_MAX_CHARS) : "";
    } catch {
      body = "";
    }
  }
  const title = typeof raw?.title === "string" ? bounded(raw.title, NEWS_TITLE_MAX_CHARS) : "";
  const candidate: NewsItem = {
    id,
    accountId,
    // Titre du contrat obligatoire : corps (extrait) sinon libellé générique.
    title: title || bounded(body, NEWS_TITLE_MAX_CHARS) || "Actualité",
    body: body || undefined,
    publishedAt: toIso(raw?.creationDate, toIso(raw?.startDate, new Date().toISOString())),
    category: typeof raw?.category === "string" ? bounded(raw.category, NEWS_META_MAX_CHARS) || undefined : undefined,
    author: typeof raw?.author === "string" ? bounded(raw.author, NEWS_META_MAX_CHARS) || undefined : undefined,
    read: typeof raw?.read === "boolean" ? raw.read : undefined,
  };
  return isNewsItem(candidate) ? candidate : null;
}


// #81 cantine : plats = libellés bornés + étiquettes alimentaires agrégées.
// pronotets n'expose que isLunch/isDinner : le petit-déjeuner est reconnu par
// une regex simple et bornée sur le nom du repas.
// ponytail: allergènes agrégés au repas, pas de structure par plat. Upgrade:
// plat structuré {label, allergens, composition} si l'établissement publie la composition.
const BREAKFAST_RE = /\b(petit[\s-]?d[eé]jeuner|breakfast)\b/i;

function canteenMealOf(m: unknown): CanteenMeal {
  const r = m as { isDinner?: unknown; name?: unknown } | null;
  if (r?.isDinner === true) return "dinner";
  if (typeof r?.name === "string" && BREAKFAST_RE.test(bounded(r.name, 100))) return "breakfast";
  return "lunch";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCanteenMenu(accountId: string, m: any, index: number): CanteenMenu | null {
  const date = toIso(m?.date, "");
  if (!date) return null;
  const groups = [m?.firstMeal, m?.mainMeal, m?.sideMeal, m?.otherMeal, m?.cheese, m?.dessert];
  const dishes: string[] = [];
  const allergens: string[] = [];
  for (const group of groups) {
    for (const f of Array.isArray(group) ? group : []) {
      const label = typeof f?.name === "string" ? bounded(f.name, CANTEEN_MAX_DISH_CHARS) : "";
      if (label === "") continue;
      if (!dishes.includes(label) && dishes.length < CANTEEN_MAX_DISHES) dishes.push(label);
      for (const l of Array.isArray(f?.labels) ? f.labels : []) {
        const a = typeof l?.name === "string" ? bounded(l.name, CANTEEN_MAX_ALLERGEN_CHARS) : "";
        if (a !== "" && !allergens.includes(a) && allergens.length < CANTEEN_MAX_ALLERGENS) allergens.push(a);
      }
    }
  }
  // Repas sans plat lisible = pas de ligne (l'app masque, n'invente pas).
  if (dishes.length === 0) return null;
  const cand: CanteenMenu = {
    id: typeof m?.id === "string" && m.id ? bounded(m.id, 64) : `menu-${index}`,
    accountId,
    date,
    meal: canteenMealOf(m),
    dishes,
    ...(allergens.length > 0 ? { allergens } : {}),
  };
  return isCanteenMenu(cand) ? cand : null;
}

// --- #77 vie scolaire : absences, retards, sanctions ---
// pronotets expose, par période, `absences()`, `delays()` (retards) et
// `punishments()`. Absences et retards ont la même forme côté app : un seul
// modèle `kind` (parité Papillon). Motifs/sanctions = DONNÉES bornées, jamais
// instruction (I6). Onglet absent ou en erreur = page VIDE (capacités
// dynamiques), seule la session morte remonte.
// ponytail: `hours` ("2h", "1h30") est converti en minutes par regex ; une
// durée illisible est OMISE (compteurs en occurrences), jamais 0 deviné.

/**
 * Liste d'une période : [] si l'appel n'existe pas ou échoue (onglet inactif).
 * Session morte = le cas PARTICULIER qui REMONTE : une session expirée ne doit
 * jamais devenir une page vide, sinon live-sync applique `absences: []` et
 * PURGE l'instantané déjà synchronisé au lieu de demander un ré-appairage (I6).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function periodList(period: any, method: string, what: string): Promise<unknown[]> {
  if (typeof period?.[method] !== "function") return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await period[method]()) as any;
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    const mapped = toReadError(err, what);
    if (mapped.code === "session_expired") throw mapped;
    return [];
  }
}

/** Motif = raisons pronotets dédupliquées puis bornées ; vide = champ omis. */
function joinReasons(raw: unknown, max: number): string | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parts: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const t = bounded(r, max);
    if (t !== "" && !parts.includes(t)) parts.push(t);
  }
  return parts.length > 0 ? bounded(parts.join(" ; "), max) : undefined;
}

const HOURS_MIN_RE = /(\d{1,2})\s*h(?:(\d{1,2}))?/i;

function hoursToMinutes(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : undefined;
  if (typeof v !== "string") return undefined;
  const m = HOURS_MIN_RE.exec(v);
  if (!m) return undefined;
  const total = Number(m[1]) * 60 + (m[2] === undefined ? 0 : Number(m[2]));
  return Number.isFinite(total) ? total : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAbsence(accountId: string, a: any, index: number, periodId?: string): AbsenceRecord | null {
  const from = toIso(a?.fromDate, "");
  if (!from) return null;
  const to = toIso(a?.toDate, from);
  const cand: AbsenceRecord = {
    id: typeof a?.id === "string" && a.id ? bounded(a.id, 64) : `abs-${index}`,
    accountId,
    kind: "absence",
    date: from,
    // Journée simple = pas de dateEnd (jamais de doublon de date).
    dateEnd: to !== from ? to : undefined,
    subject: typeof a?.subject?.name === "string" ? bounded(a.subject.name, ABSENCE_SUBJECT_MAX_CHARS) || undefined : undefined,
    motif: joinReasons(a?.reasons, ABSENCE_MOTIF_MAX_CHARS),
    periodId,
    durationMinutes: hoursToMinutes(a?.hours),
    justified: typeof a?.justified === "boolean" ? a.justified : undefined,
  };
  return isAbsenceRecord(cand) ? cand : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDelay(accountId: string, d: any, index: number, periodId?: string): AbsenceRecord | null {
  const date = toIso(d?.date, "");
  if (!date) return null;
  const minutes = d?.minutes !== undefined ? toNumber(d.minutes, Number.NaN) : Number.NaN;
  const cand: AbsenceRecord = {
    id: typeof d?.id === "string" && d.id ? bounded(d.id, 64) : `late-${index}`,
    accountId,
    kind: "late",
    date,
    motif: joinReasons(d?.reasons, ABSENCE_MOTIF_MAX_CHARS),
    periodId,
    durationMinutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : undefined,
    justified: typeof d?.justified === "boolean" ? d.justified : undefined,
  };
  return isAbsenceRecord(cand) ? cand : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPunishment(accountId: string, p: any, index: number, periodId?: string): Punishment | null {
  const date = toIso(p?.given, "");
  if (!date) return null;
  const nature = typeof p?.nature === "string" ? bounded(p.nature, PUNISHMENT_TYPE_MAX_CHARS) : "";
  // gravity = durée publiée par l'établissement (échelle libre, ex. heures
  // d'exclusion) ; absente si non publiée, jamais 0 déduit.
  const gravity = p?.duration !== undefined ? toNumber(p.duration, Number.NaN) : Number.NaN;
  const cand: Punishment = {
    id: typeof p?.id === "string" && p.id ? bounded(p.id, 64) : `pun-${index}`,
    accountId,
    date,
    // ponytail: dateEnd non renseigné (Pronote donne un instantané + un
    // calendrier de sanctions). Upgrade: lire `schedule` si l'établissement publie une plage.
    motif: joinReasons(p?.reasons, PUNISHMENT_MOTIF_MAX_CHARS) ?? "Sanction",
    type: nature || "Sanction",
    gravity: Number.isFinite(gravity) && gravity >= 0 ? gravity : undefined,
    periodId,
  };
  return isPunishment(cand) ? cand : null;
}

export class PronoteClientReader implements PronoteReader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly sessions: { requireClient(accountId: string): any; currentAccountId?(): string | null; refreshSession?(accountId: string): Promise<void> };
  private readonly logger: (message: string) => void;

  constructor(options: PronoteClientReaderOptions) {
    if (!options.sessions) throw new Error("sessions requises (PronoteSessionStore injecté)");
    this.sessions = options.sessions;
    this.logger = options.logger ?? (() => {});
  }

  /**
   * #87 : validation de session avant LECTURE. Renouvellement 5 min sérialisé
   * (timeout 10 s, retry 1) délégué au session store ; absent = aucun appel
   * (les adaptateurs de test et les stubs ne cassent pas). Une renewal
   * impossible remonte en erreur typée → l'app se ré-appaire.
   */
  private async refreshSession(id: string): Promise<void> {
    const refresh = this.sessions.refreshSession;
    if (typeof refresh !== "function") return;
    try {
      await refresh.call(this.sessions, id);
    } catch (err) {
      const mapped = toReadError(err, "session");
      this.logger(`session -> error ${mapped.code}`);
      throw mapped;
    }
  }

  /**
   * accountId vide = serveur mono-compte : on prend l'unique session appairée.
   * Aucun secret journalisé, juste une résolution de clé de session.
   * ponytail: multi-compte = l'app enverra l'accountId appairé (#82 /v1/me).
   */
  private resolveAccount(accountId: string): string {
    const id = (accountId ?? "").trim();
    if (id !== "") return id;
    try {
      return this.sessions.currentAccountId?.() ?? "";
    } catch {
      return "";
    }
  }

  async getGrades(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Grade>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("grades session expired", "session_expired");
    const limit = clampLimit(page?.limit);
    const offset = parseOffset(page?.cursor);
    let client;
    try {
      await this.refreshSession(id);
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "grades");
      this.logger(`grades -> error ${mapped.code}`);
      throw mapped;
    }
    try {
      const periods = client.periods ?? [];
      const all: Grade[] = [];
      // Compteur MONOTONE d'index bruts. `all.length + i` repartait de
      // `all.length` (recalculé à chaque période) alors que les notes écartées
      // ne le faisaient PAS monter : deux notes distinctes de périodes
      // différentes se retrouvaient avec le même id de repli — clé de sync/diff
      // serveur. L'id reste STABLE : il ne dépend que de la position brute.
      let seq = 0;
      for (const p of periods) {
        const grades = (await p.grades()) as unknown[];
        // #74 : periodId porte le regroupement des moyennes, il vient de la
        // période Pronote qui porte ces notes (jamais deviné).
        const periodId = typeof p?.id === "string" && p.id ? p.id : undefined;
        grades.forEach((g) => {
          const m = mapGrade(id, g, seq++, periodId);
          if (m) all.push(m);
        });
        if (all.length >= offset + limit + 1) break;
      }
      const slice = all.slice(offset, offset + limit);
      const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
      this.logger(`grades -> ok ${slice.length}`);
      return { items: untrusted(slice), nextCursor };
    } catch (err) {
      const mapped = toReadError(err, "grades");
      this.logger(`grades -> error ${mapped.code}`);
      throw mapped;
    }
  }

  /** Périodes (#74) : libellés + bornes pour les onglets et le filtre periodId. */
  async getPeriods(accountId: string): Promise<PronotePage<Period>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("periods session expired", "session_expired");
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "periods");
      this.logger(`periods -> error ${mapped.code}`);
      throw mapped;
    }
    try {
      const items = mapPeriods((client.periods ?? []) as unknown[]);
      this.logger(`periods -> ok ${items.length}`);
      return { items: untrusted(items), nextCursor: null };
    } catch (err) {
      const mapped = toReadError(err, "periods");
      this.logger(`periods -> error ${mapped.code}`);
      throw mapped;
    }
  }

  async getAssignments(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Assignment>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("assignments session expired", "session_expired");
    const limit = clampLimit(page?.limit);
    const offset = parseOffset(page?.cursor);
    let client;
    try {
      await this.refreshSession(id);
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "assignments");
      this.logger(`assignments -> error ${mapped.code}`);
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
      const lessons = await this.lessonContents(client, from, later, wanted);
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
      this.logger(`assignments -> ok ${slice.length}`);
      return { items: untrusted(slice), nextCursor };
    } catch (err) {
      const mapped = toReadError(err, "assignments");
      this.logger(`assignments -> error ${mapped.code}`);
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
  private async lessonContents(
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
      this.logger(`assignments -> contenus ${out.size}`);
    } catch (err) {
      // Séances illisibles : les devoirs sortent sans lessonContent (add-only).
      this.logger(`assignments -> contenus indisponibles (${toReadError(err, "assignments").code})`);
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
  async setAssignmentDone(accountId: string, assignmentId: string, done: boolean): Promise<Assignment> {
    const id = this.resolveAccount(accountId);
    const target = (assignmentId ?? "").trim();
    if (!id) throw new PronoteWriteError("toggle session expired", "session_expired");
    if (!target) throw new PronoteWriteError("toggle not found", "not_found");
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toWriteError(err, "toggle");
      this.logger(`assignments -> toggle error ${mapped.code}`);
      throw mapped;
    }
    try {
      const now = new Date();
      const raw = (await client.homework(new Date(now.getTime() - 7 * 86400000), new Date(now.getTime() + 21 * 86400000))) as unknown[];
      const list = Array.isArray(raw) ? raw : [];
      const index = list.findIndex((h) => (h as { id?: unknown })?.id === target);
      if (index < 0) {
        this.logger("assignments -> toggle not_found");
        throw new PronoteWriteError("toggle not found", "not_found");
      }
      const found = list[index] as { setDone?: (status: boolean) => Promise<void> };
      if (typeof found?.setDone !== "function") {
        this.logger("assignments -> toggle unsupported");
        throw new PronoteWriteError("toggle unsupported", "unsupported");
      }
      await found.setDone(done);
      const mapped = mapAssignment(id, list[index], index);
      if (!mapped) throw new PronoteWriteError("toggle not found", "not_found");
      // Compteur seul dans les logs : jamais d'identifiant de devoir journalisé.
      this.logger("assignments -> toggle ok");
      return { ...mapped, done };
    } catch (err) {
      if (err instanceof PronoteWriteError) throw err;
      const mapped = toWriteError(err, "toggle");
      this.logger(`assignments -> toggle error ${mapped.code}`);
      throw mapped;
    }
  }

  async getTimetable(accountId: string, options?: PronoteTimetableOptions): Promise<PronotePage<TimetableEntry>> {
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
      await this.refreshSession(id);
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "timetable");
      this.logger(`timetable -> error ${mapped.code}`);
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
      this.logger(`timetable -> ok ${slice.length}`);
      return { items: untrusted(slice), nextCursor };
    } catch (err) {
      const mapped = toReadError(err, "timetable");
      this.logger(`timetable -> error ${mapped.code}`);
      throw mapped;
    }
  }

  /** Ressources pédagogiques : contenus cours + PJ devoirs (proxy serveur, #84). */
  async getResources(accountId: string, page?: PronotePageOptions): Promise<PronotePage<PedagogicResource>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("resources session expired", "session_expired");
    const limit = clampLimit(page?.limit);
    const offset = parseOffset(page?.cursor);
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "resources");
      this.logger(`resources -> error ${mapped.code}`);
      throw mapped;
    }
    try {
      const now = new Date();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (await client.lessons(
        new Date(now.getTime() - 14 * 86400000),
        new Date(now.getTime() + 7 * 86400000),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      )) as any[];
      // Contenus cours : 1 requête par leçon avec description (borné, sérialisé côté lib).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enriched: any[] = [];
      for (const l of raw.slice(0, 60)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c = (await (l as any).content?.()) as any;
          enriched.push({
            ...l,
            contentValue:
              c !== null && c !== undefined
                ? { title: c.title, description: c.description, files: typeof c.files === "function" ? c.files() : [] }
                : null,
          });
        } catch {
          enriched.push(l);
        }
      }
      const later = new Date(now.getTime() + 21 * 86400000);
      let homeworks: unknown[] = [];
      try {
        homeworks = (await client.homework(new Date(now.getTime() - 7 * 86400000), later)) as unknown[];
      } catch {
        homeworks = [];
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all = mapResources(id, enriched, homeworks as any[]);
      const slice = all.slice(offset, offset + limit);
      const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
      this.logger(`resources -> ok ${slice.length}`);
      return { items: untrusted(slice), nextCursor };
    } catch (err) {
      const mapped = toReadError(err, "resources");
      this.logger(`resources -> error ${mapped.code}`);
      throw mapped;
    }
  }

  /** Évaluations par compétences (#78). Onglet absent = page vide (pas d'erreur). */
  async getEvaluations(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Evaluation>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("evaluations session expired", "session_expired");
    const limit = clampLimit(page?.limit);
    const offset = parseOffset(page?.cursor);
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "evaluations");
      this.logger(`evaluations -> error ${mapped.code}`);
      throw mapped;
    }
    try {
      const periods = client.periods ?? [];
      const all: Evaluation[] = [];
      // ids de repli uniques dans la page : `i` repart à 0 à chaque période
      // alors que `all.length` n'avance que des items MAPPÉS → deux évaluations
      // sans id de périodes différentes se partageaient le même `ev-<n>`.
      // `consumed` (bruts déjà lus) ré-étale les index SANS changer la
      // numérotation d'un établissement à une seule période (cf.
      // tests/unit/evaluations.test.ts, qui fige `skill-4`).
      let consumed = 0;
      for (const p of periods) {
        // Établissement sans évaluations par compétences : pas d'appel, pas d'erreur.
        if (typeof p?.evaluations !== "function") continue;
        let raw: unknown[] = [];
        try {
          raw = (await p.evaluations()) as unknown[];
        } catch (err) {
          // Session morte = re-appairage demandé par l'app, jamais une page
          // vide (l'onglet « évaluations » disparaîtrait au lieu de proposer
          // le re-login). Onglet absent/KO = page vide, comme avant.
          const mapped = toReadError(err, "evaluations");
          if (mapped.code === "session_expired") throw mapped;
          continue;
        }
        const periodId = typeof p?.id === "string" && p.id ? p.id : undefined;
        const rawBase = consumed;
        (raw ?? []).forEach((e, i) => {
          const m = mapEvaluation(id, e, all.length + i + rawBase, periodId);
          consumed += 1;
          if (m) all.push(m);
        });
        if (all.length >= offset + limit + 1) break;
      }
      const slice = all.slice(offset, offset + limit);
      const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
      this.logger(`evaluations -> ok ${slice.length}`);
      return { items: untrusted(slice), nextCursor };
    } catch (err) {
      const mapped = toReadError(err, "evaluations");
      this.logger(`evaluations -> error ${mapped.code}`);
      throw mapped;
    }
  }


  /**
   * Actualités établissement (#79) : onglet Actualités/sondages.
   * ponytail: la lib n'expose pas l'onglet partout (établissement sans
   * actualités, version antérieure) et l'appel peut échouer selon les droits :
   * on renvoie alors une page VIDE plutôt qu'une erreur (l'app affiche "Aucune
   * actualité"). Upgrade: fetch paginé côté serveur d'actions + pièces jointes.
   */
  async getNews(accountId: string, page?: PronotePageOptions): Promise<PronotePage<NewsItem>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("news session expired", "session_expired");
    const limit = clampLimit(page?.limit);
    const offset = parseOffset(page?.cursor);
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "news");
      this.logger(`news -> error ${mapped.code}`);
      throw mapped;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = (client as any)?.informationAndSurveys;
    if (typeof reader !== "function") {
      this.logger("news -> onglet absent, page vide");
      return { items: untrusted([]), nextCursor: null };
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (await reader.call(client)) as any[];
      const list = Array.isArray(raw) ? raw : [];
      const items: NewsItem[] = [];
      for (const [i, info] of list.slice(offset, offset + limit).entries()) {
        try {
          const m = await mapNews(id, info, offset + i, i < NEWS_BODY_FETCH_LIMIT);
          if (m) items.push(m);
        } catch {
          // Actu illisible (champs requis manquants) : ignorée, pas de 500.
        }
      }
      const nextCursor = offset + limit < list.length ? String(offset + limit) : null;
      this.logger(`news -> ok ${items.length}`);
      return { items: untrusted(items), nextCursor };
    } catch (err) {
      const mapped = toReadError(err, "news");
      // Session morte = re-auth nécessaire (l'app recharge), reste = page vide.
      if (mapped.code === "session_expired") {
        this.logger(`news -> error ${mapped.code}`);
        throw mapped;
      }
      this.logger(`news -> indisponible (${mapped.code}), page vide`);
      return { items: untrusted([]), nextCursor: null };
    }
  }


  /**
   * Menus cantine (#81). Fenêtre from/to, défaut semaine courante (lundi→dimanche).
   * Défensif : la cantine est souvent hors périmètre (module non activé, onglet
   * absent, pas de self-service) => page VIDE + log, jamais une erreur, pour que
   * l'onglet puisse être masqué (capacités dynamiques, #81). Seules les erreurs
   * de session et les bornes de fenêtre illisibles remontent, comme getTimetable.
   * ponytail: solde non lu (Turboself/ARD hors Pronote, rien dans pronotets) =>
   * CanteenBalance reste absent de la réponse. Upgrade: source solde dédiée
   * derrière PronoteHttpClient (I2) une fois le service identifié.
   */
  async getMenus(accountId: string, options?: PronoteTimetableOptions): Promise<PronotePage<CanteenMenu>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("menus session expired", "session_expired");
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start.getTime() + 6 * 86400000);
    let from = start;
    let to = end;
    if (options?.from !== undefined) {
      if (typeof options.from !== "string" || Number.isNaN(Date.parse(options.from))) {
        throw new PronoteReadError("menus pronote unavailable", "pronote_unavailable");
      }
      from = new Date(options.from);
    }
    if (options?.to !== undefined) {
      if (typeof options.to !== "string" || Number.isNaN(Date.parse(options.to))) {
        throw new PronoteReadError("menus pronote unavailable", "pronote_unavailable");
      }
      to = new Date(options.to);
    }
    const fromMs = from.getTime();
    const toMs = to.getTime();
    const limit = clampLimit(options?.limit);
    const offset = parseOffset(options?.cursor);
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "menus");
      this.logger(`menus -> error ${mapped.code}`);
      throw mapped;
    }
    try {
      const raw = (await client.menus(from, to)) as unknown[];
      const all: CanteenMenu[] = [];
      // Index bruts monotones (cf. getGrades) : un menu écarté par la fenêtre ne
      // décale plus les ids de repli des menus suivants.
      let seq = 0;
      (Array.isArray(raw) ? raw : []).forEach((m) => {
        const mapped = mapCanteenMenu(id, m, seq++);
        // Fenêtre appliquée côté reader : la lib aligne sur ses semaines, on
        // re-borne sur la fenêtre demandée (dates illisibles filtrées au mapping).
        if (mapped && Date.parse(mapped.date) >= fromMs && Date.parse(mapped.date) <= toMs) all.push(mapped);
      });
      const slice = all.slice(offset, offset + limit);
      const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
      this.logger(`menus -> ok ${slice.length}`);
      return { items: untrusted(slice), nextCursor };
    } catch (err) {
      const mapped = toReadError(err, "menus");
      // Session morte = re-authentification requise, jamais "aucun menu" : sinon
      // l'app afficherait un onglet vide au lieu de proposer le re-login.
      if (mapped.code === "session_expired") {
        this.logger(`menus -> error ${mapped.code}`);
        throw mapped;
      }
      // Cantine indisponible = absence de donnée, pas une panne de sync.
      this.logger(`menus -> indisponible ${mapped.code}`);
      return { items: untrusted([]), nextCursor: null };
    }
  }

  /**
   * Infos du compte appairé (#82, parité Papillon Profil) : nom, classe,
   * période courante, photo (réf opaque) + enfants d'un compte parent.
   * DEFENSIF : pronotets expose `client.info` (name/className/profilePicture)
   * et `client.children` (ParentClient). Champ non publié = omis ; nom vide =
   * aucune page (jamais de faux nom, jamais de photo inventée). Seules les
   * erreurs de session remontent (l'app doit se ré-appairer) ; le reste donne
   * une page vide + log. Logs = compteurs seulement, aucun nom/secret.
   * ponytail: période courante déduite des périodes déjà chargées par la lib
   * (aucune requête en plus). Upgrade: currentPeriod() si la lib l'expose.
   */
  async getUserInfo(accountId: string): Promise<PronotePage<UserInfo>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("me session expired", "session_expired");
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "me");
      this.logger(`me -> error ${mapped.code}`);
      throw mapped;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const info = (client as any)?.info;
      const periods = mapPeriods(((client as { periods?: unknown })?.periods ?? []) as unknown[]);
      const user = mapUserInfo(id, info, periods);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kids = mapKids((client as any)?.children);
      const candidate =
        user === null
          ? null
          : { ...user, hasKids: kids.length > 0, ...(kids.length > 0 ? { kids } : {}) };
      if (candidate === null || !isUserInfo(candidate)) {
        this.logger("me -> infos non publiees, page vide");
        return { items: untrusted([]), nextCursor: null };
      }
      this.logger(`me -> ok 1 profil, ${kids.length} compte(s) enfant`);
      return { items: untrusted([candidate]), nextCursor: null };
    } catch (err) {
      const mapped = toReadError(err, "me");
      // Session morte = re-appairage, jamais "profil vide" (I6) : une page
      // vide ferait croire à un compte sans données au lieu d'un re-login.
      if (mapped.code === "session_expired") {
        this.logger(`me -> error ${mapped.code}`);
        throw mapped;
      }
      // Panne de lecture du profil = donnée absente, jamais une 500.
      this.logger(`me -> indisponible (${mapped.code}), page vide`);
      return { items: untrusted([]), nextCursor: null };
    }
  }

  /**
   * Absences + retards par période (#77). L'onglet vie scolaire est souvent
   * absent d'un établissement : page VIDE + log `attendance -> indisponible
   * <code>`, jamais une erreur (l'app masque l'onglet). Seules les erreurs de
   * session remontent, comme getMenus.
   * ponytail: une SEULE période en erreur n'annule pas les autres (l'onglet est
   *lu période par période) ; le compte est alors simplement incomplet.
   */
  async getAttendance(accountId: string, page?: PronotePageOptions): Promise<PronotePage<AbsenceRecord>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("attendance session expired", "session_expired");
    const limit = clampLimit(page?.limit);
    const offset = parseOffset(page?.cursor);
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "attendance");
      this.logger(`attendance -> error ${mapped.code}`);
      throw mapped;
    }
    try {
      const periods = (client.periods ?? []) as unknown[];
      const all: AbsenceRecord[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of periods as any[]) {
        const periodId = typeof p?.id === "string" && p.id ? bounded(p.id, 64) || undefined : undefined;
        for (const a of await periodList(p, "absences", "attendance")) {
          const m = mapAbsence(id, a, all.length, periodId);
          if (m) all.push(m);
        }
        for (const d of await periodList(p, "delays", "attendance")) {
          const m = mapDelay(id, d, all.length, periodId);
          if (m) all.push(m);
        }
        if (all.length >= offset + limit + 1) break;
      }
      const slice = all.slice(offset, offset + limit);
      const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
      this.logger(`attendance -> ok ${slice.length}`);
      return { items: untrusted(slice), nextCursor };
    } catch (err) {
      const mapped = toReadError(err, "attendance");
      // Session morte = re-appairage demandé par l'app. Une page vide ici
      // EFFACERAIT les absences déjà synchronisées (I6) au lieu de les
      // mettre en attente : getMenus/getNews font déjà ce tri.
      if (mapped.code === "session_expired") {
        this.logger(`attendance -> error ${mapped.code}`);
        throw mapped;
      }
      this.logger(`attendance -> indisponible ${mapped.code}`);
      return { items: untrusted([]), nextCursor: null };
    }
  }

  /** Sanctions vie scolaire (#77). Onglet absent/KO = page vide, jamais d'erreur. */
  async getPunishments(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Punishment>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("punishments session expired", "session_expired");
    const limit = clampLimit(page?.limit);
    const offset = parseOffset(page?.cursor);
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "punishments");
      this.logger(`punishments -> error ${mapped.code}`);
      throw mapped;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const periods = (client.periods ?? []) as any[];
      const all: Punishment[] = [];
      for (const p of periods) {
        const periodId = typeof p?.id === "string" && p.id ? bounded(p.id, 64) || undefined : undefined;
        for (const s of await periodList(p, "punishments", "punishments")) {
          const m = mapPunishment(id, s, all.length, periodId);
          if (m) all.push(m);
        }
        if (all.length >= offset + limit + 1) break;
      }
      const slice = all.slice(offset, offset + limit);
      const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
      this.logger(`punishments -> ok ${slice.length}`);
      return { items: untrusted(slice), nextCursor };
    } catch (err) {
      const mapped = toReadError(err, "punishments");
      // Session morte = re-appairage (I6), jamais une page vide qui purge les
      // sanctions déjà synchronisées.
      if (mapped.code === "session_expired") {
        this.logger(`punishments -> error ${mapped.code}`);
        throw mapped;
      }
      this.logger(`punishments -> indisponible ${mapped.code}`);
      return { items: untrusted([]), nextCursor: null };
    }
  }

  /**
   * #87 : capacités dynamiques — onglets Pronote réellement servis par cet
   * établissement. Observation STRUCTURELLE (le client expose-t-il la méthode de
   * l'onglet ?) : aucune requête Pronote, donc aucune erreur possible côté
   * établissement. Onglet non observé = capacité absente, JAMAIS un `true`
   * deviné : la réduction canonique est faite par server/domain/capabilities.
   * ponytail: `discussions` (onglet Discussions de Papillon) reste absent tant
   * que pronotets n'expose pas l'onglet ; l'app masque donc l'entrée, ce qui est
   * le comportement correct pour un établissement qui ne l'a pas. Upgrade: mapper
   * `client.information` quand la lib le publiera.
   */
  async getCapabilities(accountId: string): Promise<Capabilities> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("capabilities session expired", "session_expired");
    let client;
    try {
      await this.refreshSession(id);
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "capabilities");
      this.logger(`capabilities -> error ${mapped.code}`);
      throw mapped;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = client as any;
      const periods = Array.isArray(raw?.periods) ? (raw.periods as unknown[]) : [];
      const anyPeriod = (method: string): boolean => periods.some((p) => typeof (p as { [k: string]: unknown })?.[method] === "function");
      const caps = capabilitiesFromProbe(
        id,
        {
          grades: anyPeriod("grades"),
          homework: typeof raw?.homework === "function",
          timetable: typeof raw?.lessons === "function",
          evaluations: anyPeriod("evaluations"),
          news: typeof raw?.informationAndSurveys === "function",
          menus: typeof raw?.menus === "function",
          attendance: anyPeriod("absences") || anyPeriod("delays"),
          punishments: anyPeriod("punishments"),
          profile: typeof raw?.info === "object" && raw.info !== null,
        },
        new Date().toISOString(),
      );
      // Logs = compteurs seuls (aucun nom, aucun hôte, aucun secret).
      this.logger(`capabilities -> ok ${caps.tabs.length} onglet(s) actif(s)`);
      return caps;
    } catch {
      // Détection impossible = aucune capacité affirmée, jamais une erreur 500.
      this.logger("capabilities -> indisponible, aucune capacite");
      return capabilitiesFromProbe(id, {}, new Date().toISOString());
    }
  }


  // --- #80 messagerie : lectures + ÉCRITURES (actions APP confirmées, I7) ---
  // Les 4 écritures (create/reply/read-state/delete) n'ont qu'une seule porte
  // d'entrée : les routes POST /v1/discussions/* de server/api/discussions.ts,
  // donc un geste CONFIRMÉ de l'app — jamais une sortie LLM (I7). Le port de
  // LECTURE PronoteReader n'expose aucune écriture (voir ports.ts).
  // ponytail: ce bloc vit dans le reader comme `setAssignmentDone` (#75) : la
  // session Pronote reste côté serveur, jamais dans l'app (I2).

  /**
   * Liste des fils de discussion. `null` = onglet Discussions indisponible
   * (absent de l'installation, droits refusés, panne) → page VIDE côté lecture
   * et 409 sur une écriture, jamais une erreur 500. Seule la session morte
   * remonte (l'app doit se ré-appairer).
   */
  private async discussionList(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
    what: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any[] | null> {
    if (typeof client?.discussions !== "function") {
      this.logger(`${what} -> onglet Discussions absent`);
      return null;
    }
    try {
      const raw = (await client.discussions()) as unknown[];
      return Array.isArray(raw) ? raw : [];
    } catch (err) {
      const mapped = toReadError(err, what);
      if (mapped.code === "session_expired") {
        this.logger(`${what} -> error ${mapped.code}`);
        throw mapped;
      }
      this.logger(`${what} -> indisponible (${mapped.code})`);
      return null;
    }
  }

  /** Fil visé par une écriture ; absent = `not_found` (409), jamais de faux succès. */
  private async requireDiscussion(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
    discussionId: string,
    what: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const list = await this.discussionList(client, what);
    const found = list === null ? undefined : list.find((d) => (d as { id?: unknown })?.id === discussionId);
    if (!found) throw new PronoteWriteError(`${what} not found`, "not_found");
    return found;
  }

  /**
   * Fils de discussion (parité Papillon onglet Discussions). Onglet inactif =
   * page VIDE (l'app masque l'onglet), jamais une erreur de lecture.
   * ponytail: `participants()` + `messages()` = 2 requêtes Pronote par fil, donc
   * enrichissement plafonné à DISCUSSION_ENRICH_LIMIT ; au-delà le fil reste
   * listé (participants vides, `updatedAt` = heure de lecture).
   */
  async getDiscussions(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Discussion>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("discussions session expired", "session_expired");
    const limit = clampLimit(page?.limit);
    const offset = parseOffset(page?.cursor);
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "discussions");
      this.logger(`discussions -> error ${mapped.code}`);
      throw mapped;
    }
    const list = await this.discussionList(client, "discussions");
    if (list === null) return { items: untrusted([]), nextCursor: null };
    const out: Discussion[] = [];
    for (const [i, raw] of list.slice(offset, offset + limit).entries()) {
      const mapped = await mapDiscussion(offset + i, raw, offset + i < DISCUSSION_ENRICH_LIMIT);
      if (mapped) out.push(mapped);
    }
    const nextCursor = offset + limit < list.length ? String(offset + limit) : null;
    this.logger(`discussions -> ok ${out.length}`);
    return { items: untrusted(out), nextCursor };
  }

  /**
   * Messages d'UN fil (borne d'affichage). Fil inconnu, fermé ou illisible =
   * page VIDE, jamais une erreur : la lecture ne doit pas casser l'écran.
   */
  async getDiscussionMessages(accountId: string, discussionId: string): Promise<PronotePage<Message>> {
    const id = (accountId ?? "").trim();
    const target = (discussionId ?? "").trim();
    if (!id) throw new PronoteReadError("messages session expired", "session_expired");
    if (target === "") return { items: untrusted([]), nextCursor: null };
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "messages");
      this.logger(`messages -> error ${mapped.code}`);
      throw mapped;
    }
    const list = await this.discussionList(client, "messages");
    if (list === null) return { items: untrusted([]), nextCursor: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = list.find((d) => (d as any)?.id === target);
    if (!raw) {
      this.logger("messages -> fil introuvable, page vide");
      return { items: untrusted([]), nextCursor: null };
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = typeof raw?.messages === "function" ? ((await raw.messages()) as unknown[]) : [];
      const out: Message[] = [];
      for (const [i, m] of (Array.isArray(rows) ? rows : []).slice(0, DISCUSSION_MESSAGE_LIMIT).entries()) {
        const mapped = mapDiscussionMessage(target, m, i);
        if (mapped) out.push(mapped);
      }
      this.logger(`messages -> ok ${out.length}`);
      return { items: untrusted(out), nextCursor: null };
    } catch (err) {
      const mapped = toReadError(err, "messages");
      if (mapped.code === "session_expired") {
        this.logger(`messages -> error ${mapped.code}`);
        throw mapped;
      }
      this.logger(`messages -> illisibles (${mapped.code}), page vide`);
      return { items: untrusted([]), nextCursor: null };
    }
  }

  /** Destinataires proposables (nouvelle discussion). Onglet absent = page vide. */
  async getDiscussionRecipients(accountId: string): Promise<PronotePage<Recipient>> {
    const id = (accountId ?? "").trim();
    if (!id) throw new PronoteReadError("recipients session expired", "session_expired");
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "recipients");
      this.logger(`recipients -> error ${mapped.code}`);
      throw mapped;
    }
    if (typeof client?.getRecipients !== "function") {
      this.logger("recipients -> onglet absent, page vide");
      return { items: untrusted([]), nextCursor: null };
    }
    try {
      const raw = (await client.getRecipients()) as unknown[];
      const out: Recipient[] = [];
      const seen = new Set<string>();
      for (const r of (Array.isArray(raw) ? raw : []).slice(0, DISCUSSION_RECIPIENT_LIMIT)) {
        const mapped = mapRecipient(r);
        if (mapped && !seen.has(mapped.id)) {
          seen.add(mapped.id);
          out.push(mapped);
        }
      }
      this.logger(`recipients -> ok ${out.length}`);
      return { items: untrusted(out), nextCursor: null };
    } catch (err) {
      const mapped = toReadError(err, "recipients");
      if (mapped.code === "session_expired") {
        this.logger(`recipients -> error ${mapped.code}`);
        throw mapped;
      }
      this.logger(`recipients -> indisponible (${mapped.code}), page vide`);
      return { items: untrusted([]), nextCursor: null };
    }
  }

  /**
   * Nouvelle discussion — ÉCRITURE, action APP confirmée (I7).
   * Destinataires : ids résolus côté serveur via les RESSOURCES de l'établissement ; un id
   * demandé mais absent = 409 (jamais une discussion adressée à un id inventé).
   * ponytail: pronotets `newDiscussion` ne renvoie rien (pas d'id) : la réponse
   * API est un `ok` + invalidation de cache, l'app recharge la liste.
   */
  async createDiscussion(accountId: string, subject: string, body: string, recipientIds: string[]): Promise<void> {
    const id = this.resolveAccount(accountId);
    // Bornes appliquées ici aussi (défense en profondeur : l'appelant est la
    // route, mais rien ne doit envoyer un texte arbitrairement long à Pronote).
    const titre = bounded(subject ?? "", DISCUSSION_SUBJECT_MAX_CHARS);
    const text = bounded(body ?? "", MESSAGE_BODY_MAX_CHARS);
    const wanted = [
      ...new Set(
        (recipientIds ?? [])
          .map((r) => bounded(r ?? "", DISCUSSION_ID_MAX_CHARS))
          .filter((r) => r !== "" && r.length <= DISCUSSION_ID_MAX_CHARS),
      ),
    ];
    if (!id) throw new PronoteWriteError("discussion session expired", "session_expired");
    if (titre === "" || text === "" || wanted.length === 0) {
      throw new PronoteWriteError("discussion not found", "not_found");
    }
    try {
      const client = this.sessions.requireClient(id);
      if (
        typeof client?.discussions !== "function" ||
        typeof client?.newDiscussion !== "function" ||
        typeof client?.getRecipients !== "function"
      ) {
        throw new PronoteWriteError("discussion unsupported", "unsupported");
      }
      const raw = (await client.getRecipients()) as unknown[];
      const list = Array.isArray(raw) ? raw : [];
      const picked: unknown[] = [];
      for (const rid of wanted) {
        const hit = list.find((r) => (r as { id?: unknown })?.id === rid);
        if (!hit) throw new PronoteWriteError("discussion recipient not found", "not_found");
        picked.push(hit);
      }
      await client.newDiscussion(titre, text, picked);
      // Compteurs seuls dans les logs : ni sujet, ni corps, ni destinataires (PII).
      this.logger(`discussions -> create ok ${picked.length}`);
    } catch (err) {
      const mapped = toDiscussionWriteError(err, "discussion");
      this.logger(`discussions -> create error ${mapped.code}`);
      throw mapped;
    }
  }

  /** Réponse dans un fil — ÉCRITURE, action APP confirmée (I7). */
  async replyToDiscussion(accountId: string, discussionId: string, body: string): Promise<void> {
    const id = this.resolveAccount(accountId);
    const target = bounded(discussionId ?? "", DISCUSSION_ID_MAX_CHARS);
    const text = bounded(body ?? "", MESSAGE_BODY_MAX_CHARS);
    if (!id) throw new PronoteWriteError("reply session expired", "session_expired");
    if (target === "" || text === "") throw new PronoteWriteError("reply not found", "not_found");
    try {
      const client = this.sessions.requireClient(id);
      const found = await this.requireDiscussion(client, target, "reply");
      if (typeof found?.reply !== "function") throw new PronoteWriteError("reply unsupported", "unsupported");
      await found.reply(text);
      // Compteur seul dans les logs : jamais le contenu du message (I6/PII).
      this.logger("discussions -> reply ok");
    } catch (err) {
      const mapped = toDiscussionWriteError(err, "reply");
      this.logger(`discussions -> reply error ${mapped.code}`);
      throw mapped;
    }
  }

  /** Marquer lu / non-lu — ÉCRITURE, action APP confirmée (I7). */
  async setDiscussionRead(accountId: string, discussionId: string, read: boolean): Promise<void> {
    const id = this.resolveAccount(accountId);
    const target = bounded(discussionId ?? "", DISCUSSION_ID_MAX_CHARS);
    if (!id) throw new PronoteWriteError("read-state session expired", "session_expired");
    if (target === "") throw new PronoteWriteError("read-state not found", "not_found");
    try {
      const client = this.sessions.requireClient(id);
      const found = await this.requireDiscussion(client, target, "read-state");
      if (typeof found?.markAs !== "function") {
        throw new PronoteWriteError("read-state unsupported", "unsupported");
      }
      await found.markAs(read === true);
      this.logger("discussions -> read-state ok");
    } catch (err) {
      const mapped = toDiscussionWriteError(err, "read-state");
      this.logger(`discussions -> read-state error ${mapped.code}`);
      throw mapped;
    }
  }

  /** Suppression (corbeille) — ÉCRITURE, action APP confirmée (I7). */
  async deleteDiscussion(accountId: string, discussionId: string): Promise<void> {
    const id = this.resolveAccount(accountId);
    const target = bounded(discussionId ?? "", DISCUSSION_ID_MAX_CHARS);
    if (!id) throw new PronoteWriteError("delete session expired", "session_expired");
    if (target === "") throw new PronoteWriteError("delete not found", "not_found");
    try {
      const client = this.sessions.requireClient(id);
      const found = await this.requireDiscussion(client, target, "delete");
      if (typeof found?.delete !== "function") throw new PronoteWriteError("delete unsupported", "unsupported");
      await found.delete();
      this.logger("discussions -> delete ok");
    } catch (err) {
      const mapped = toDiscussionWriteError(err, "delete");
      this.logger(`discussions -> delete error ${mapped.code}`);
      throw mapped;
    }
  }
}

// --- #82 mappers profil ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapUserInfo(accountId: string, info: any, periods: Period[]): UserInfo | null {
  const displayName = typeof info?.name === "string" ? bounded(info.name, USER_NAME_MAX_CHARS) : "";
  // Nom non publié = pas de profil. Jamais de "Élève", jamais de chaîne vide
  // envoyée comme si c'était une identité.
  if (displayName === "") return null;
  const lastName = typeof info?.lastName === "string" ? bounded(info.lastName, USER_NAME_MAX_CHARS) : "";
  const firstName = typeof info?.firstName === "string" ? bounded(info.firstName, USER_NAME_MAX_CHARS) : "";
  const classLabel = typeof info?.className === "string" ? bounded(info.className, USER_CLASS_MAX_CHARS) : "";
  // Période courante = celle qui contient maintenant, sinon la 1re lisible.
  const now = Date.now();
  const current =
    periods.find((p) => Date.parse(p.start) <= now && now <= Date.parse(p.end)) ?? periods[0] ?? null;
  // Photo : RÈF OPAQUE `photo:<id>`, jamais l'URL de la pièce (qui est une
  // donnée externe Pronote et ne doit pas sortir du serveur).
  const rawPicId = typeof info?.profilePicture?.id === "string" ? bounded(info.profilePicture.id, 150) : "";
  const photoRef =
    rawPicId !== "" && isOpaquePhotoRef(`${PHOTO_REF_PREFIX}${rawPicId}`) ? `${PHOTO_REF_PREFIX}${rawPicId}` : undefined;
  const candidate: UserInfo = {
    accountId,
    displayName,
    ...(firstName !== "" ? { firstName } : {}),
    ...(lastName !== "" ? { lastName } : {}),
    ...(classLabel !== "" ? { classLabel } : {}),
    ...(current ? { periodId: current.id, periodName: current.name } : {}),
    ...(photoRef ? { photoRef } : {}),
  };
  return isUserInfo(candidate) ? candidate : null;
}

/** Enfants d'un compte parent (multi-compte #82), bornés et sans doublon. */
function mapKids(raw: unknown): ChildAccount[] {
  const out: ChildAccount[] = [];
  for (const c of (Array.isArray(raw) ? raw : []).slice(0, USER_MAX_KIDS)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = c as any;
    const id = typeof rec?.id === "string" ? bounded(rec.id, 64) : "";
    const name = typeof rec?.name === "string" ? bounded(rec.name, USER_NAME_MAX_CHARS) : "";
    // Enfant sans id ou sans nom = ignoré (jamais de ligne à moitié remplie).
    if (id === "" || name === "") continue;
    const klass = typeof rec?.className === "string" ? bounded(rec.className, USER_CLASS_MAX_CHARS) : "";
    const cand: ChildAccount = { accountId: id, displayName: name, ...(klass !== "" ? { classLabel: klass } : {}) };
    if (isChildAccount(cand) && !out.some((k) => k.accountId === cand.accountId)) out.push(cand);
  }
  return out;
}

// --- #80 mappers messagerie (défensifs, données bornées, I6) ---
// pronotets : `client.discussions()` → Discussion {id, objet, nbNonLus},
// `discussion.participants()` → string[], `discussion.messages()` → Message
// {id, contenu, public_gauche, date}, `client.getRecipients()` → Recipient
// {id, name, type}. Tout le texte est une DONNÉE : borné, jamais interprété.
// Champ illisible = champ OMIS (jamais de "" bidon, jamais de date devinée).
// ponytail: `participants()` et `messages()` coûtent 1 requête Pronote par fil,
// donc l'enrichissement est plafonné (DISCUSSION_ENRICH_LIMIT) ; au-delà, les
// participants restent vides et `updatedAt` vaut l'horodatage de lecture
// (comme les autres mappers quand la date n'est pas publiée).
const DISCUSSION_ENRICH_LIMIT = 12;
/** Messages affichés d'un fil (plafond d'affichage, pas de thread infini). */
const DISCUSSION_MESSAGE_LIMIT = 200;
/** Ressources de destinataires lues pour le sélecteur de l'app (plafond). */
const DISCUSSION_RECIPIENT_LIMIT = 40;

/**
 * Erreur d'écriture messagerie : fil FERMÉ ou fonctionnalité absente.
 * pronotets fixe `name = nomDuConstructeur` sur ses exceptions, donc on lit le
 * nom (`DiscussionClosed`, `UnsupportedOperation`) avant le message.
 * `DiscussionClosed` → 409 conflict (« pas d'action possible sur ce fil »),
 * `UnsupportedOperation` → 501 (jamais de faux succès).
 * ponytail: détection par nom/message plutôt que par import de la classe : le
 * reader reste dépendant des ports, pas des classes de la lib.
 */
function toDiscussionWriteError(err: unknown, what: string): PronoteWriteError {
  if (err instanceof PronoteWriteError) return err;
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";
  if (name === "DiscussionClosed" || /closed|ferme/i.test(message)) {
    return new PronoteWriteError(`${what} closed`, "not_found");
  }
  if (name === "UnsupportedOperation" || /unsupported|not.?implemented/i.test(message)) {
    return new PronoteWriteError(`${what} unsupported`, "unsupported");
  }
  return toWriteError(err, what);
}

/** Non-lus publiés : hors borne = compteur omis (jamais un nombre aberrant). */
function toUnreadCount(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return undefined;
  return raw >= 0 && raw <= DISCUSSION_MAX_UNREAD ? raw : undefined;
}

/** Noms de participants : bornés, dédupliqués, plafonnés (ordre published). */
function mapParticipantNames(raw: unknown): string[] {
  const out: string[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (typeof p !== "string") continue;
    const name = bounded(p, DISCUSSION_PARTICIPANT_MAX_CHARS);
    if (name === "" || out.includes(name)) continue;
    out.push(name);
    if (out.length >= DISCUSSION_MAX_PARTICIPANTS) break;
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRecipient(raw: any): Recipient | null {
  const id = typeof raw?.id === "string" ? bounded(raw.id, DISCUSSION_ID_MAX_CHARS) : "";
  const name = typeof raw?.name === "string" ? bounded(raw.name, RECIPIENT_NAME_MAX_CHARS) : "";
  // Destinataire sans id ni nom = ignoré (jamais une ligne à moitié remplie).
  if (id === "" || name === "") return null;
  // ponytail: pronotets ne distingue que `teacher` et `staff` ; `student` reste
  // une valeur de contrat (un établissement qui l'exposerait serait accepté),
  // on ne DEVINE jamais le reste : staff → administration.
  const kind: RecipientKind = raw?.type === "teacher" ? "teacher" : "administration";
  const cand: Recipient = { id, displayName: name, kind };
  return isRecipient(cand) ? cand : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDiscussionMessage(discussionId: string, raw: any, index: number): Message | null {
  const id = typeof raw?.id === "string" && raw.id ? bounded(raw.id, DISCUSSION_ID_MAX_CHARS) : `m-${index}`;
  const content = typeof raw?.content === "string" ? bounded(raw.content, MESSAGE_BODY_MAX_CHARS) : "";
  // Message sans texte lisible = ignoré (jamais de ligne vide affichée).
  if (content === "") return null;
  const author = typeof raw?.author === "string" ? bounded(raw.author, MESSAGE_AUTHOR_MAX_CHARS) : "";
  const cand: Message = {
    id,
    discussionId,
    // Auteur absent = message du compte appairé (Pronote ne le publie pas pour
    // ses propres messages) : champ OMIS, jamais un « Moi » inventé.
    ...(author !== "" ? { authorName: author } : {}),
    body: content,
    sentAt: toIso(raw?.created ?? raw?.date, new Date().toISOString()),
  };
  return isMessage(cand) ? cand : null;
}

/**
 * Fil de discussion. `enrich = false` = pas de requête participants/messages
 * (plafond de coût) : participants vides, `updatedAt` = heure de lecture.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mapDiscussion(index: number, raw: any, enrich: boolean): Promise<Discussion | null> {
  const subject = typeof raw?.subject === "string" ? bounded(raw.subject, DISCUSSION_SUBJECT_MAX_CHARS) : "";
  const id = typeof raw?.id === "string" && raw.id ? bounded(raw.id, DISCUSSION_ID_MAX_CHARS) : "";
  // Fil sans identifiant = ignoré (l'app ne peut ni l'ouvrir ni le supprimer).
  if (id === "") return null;
  let participants: string[] = [];
  let lastMessageAt: string | undefined;
  let updatedAt = new Date().toISOString();
  if (enrich) {
    try {
      participants = mapParticipantNames(typeof raw?.participants === "function" ? await raw.participants() : []);
    } catch {
      // Participants indisponibles = liste vide (add-only), jamais une erreur.
    }
    try {
      const list = typeof raw?.messages === "function" ? ((await raw.messages()) as unknown[]) : [];
      const rows = Array.isArray(list) ? list : [];
      const last = rows[rows.length - 1] as { created?: unknown; date?: unknown } | undefined;
      const first = rows[0] as { created?: unknown; date?: unknown } | undefined;
      const stamp = toIso(last?.created ?? last?.date, "");
      if (stamp !== "") lastMessageAt = stamp;
      updatedAt = stamp !== "" ? stamp : toIso(first?.created ?? first?.date, updatedAt);
    } catch {
      // Messages illisibles : on garde l'horodatage de lecture (jamais 1970).
    }
  }
  const unread = toUnreadCount(raw?.unread);
  const cand: Discussion = {
    id,
    // Sujet vide = libellé générique (comme « Devoir » / « Actualité »), jamais "".
    subject: subject || "Discussion",
    participants,
    updatedAt,
    ...(unread !== undefined ? { unreadCount: unread } : {}),
    ...(lastMessageAt !== undefined ? { lastMessageAt } : {}),
  };
  return isDiscussion(cand) ? cand : null;
}
