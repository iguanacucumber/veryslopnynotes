// Lectures via Client pronotets (session SSO Ninegate).
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
import type { AbsenceRecord, Assignment, AssignmentLessonContent, AttachmentRef, CanteenMeal, CanteenMenu, ChildAccount, Evaluation, Grade, NewsItem, Period, Punishment, TimetableEntry, UserInfo } from "../../shared/contracts/models";
import { ABSENCE_MOTIF_MAX_CHARS, ABSENCE_SUBJECT_MAX_CHARS, ASSIGNMENT_ATTACHMENT_LABEL_MAX_CHARS, ASSIGNMENT_DESCRIPTION_MAX_CHARS, ASSIGNMENT_LESSON_EXCERPT_MAX_CHARS, ASSIGNMENT_LESSON_TITLE_MAX_CHARS, ASSIGNMENT_MAX_ATTACHMENTS, ASSIGNMENT_REF_MAX_CHARS, CANTEEN_MAX_ALLERGEN_CHARS, CANTEEN_MAX_ALLERGENS, CANTEEN_MAX_DISH_CHARS, CANTEEN_MAX_DISHES, EVALUATION_LABEL_MAX_CHARS, isAbsenceRecord, isAssignment, isAttachmentRef, isCanteenMenu, isChildAccount, isEvaluation, isGrade, isNewsItem, isOpaquePhotoRef, isPeriod, isPunishment, isTimetableEntry, isUserInfo, NEWS_BODY_MAX_CHARS, NEWS_META_MAX_CHARS, NEWS_TITLE_MAX_CHARS, PHOTO_REF_PREFIX, PUNISHMENT_MOTIF_MAX_CHARS, PUNISHMENT_TYPE_MAX_CHARS, USER_CLASS_MAX_CHARS, USER_MAX_KIDS, USER_NAME_MAX_CHARS } from "../../shared/contracts/models";
import type { PedagogicResource, PronotePage, PronotePageOptions, PronoteReader, PronoteTimetableOptions } from "../domain/ports";
import { isPedagogicResource, PronoteAuthError, PronoteReadError, PronoteWriteError, untrusted } from "../domain/ports";


export interface PronoteClientReaderOptions {
  /** Résolveur session injecté (PronoteSessionStore.requireClient). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly sessions: { requireClient(accountId: string): any; currentAccountId?(): string | null };
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
    return new PronoteReadError(`${what} ent unavailable`, "ent_unavailable");
  }
  const msg = err instanceof Error ? err.message : "";
  if (/session|expired|expir/i.test(msg)) return new PronoteReadError(`${what} session expired`, "session_expired");
  if (/timeout|timed out/i.test(msg)) return new PronoteReadError(`${what} timeout`, "timeout");
  if (/network|fetch failed|injoignable/i.test(msg)) return new PronoteReadError(`${what} network`, "network");
  return new PronoteReadError(`${what} ent unavailable`, "ent_unavailable");
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

/** Trim + borne dure. Vide après trim = "" (l'appelant le transforme en undefined). */
function bounded(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t;
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

function lessonKey(subject: unknown, date: unknown): string | null {
  const name = typeof subject === "string" ? subject : (subject as { name?: unknown })?.name;
  if (typeof name !== "string" || name === "") return null;
  const iso = toIso(date, "");
  return iso === "" ? null : `${name}|${iso.slice(0, 10)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLesson(accountId: string, l: any, index: number): TimetableEntry | null {
  const fallback = `t-${index}`;
  const start = toIso(l?.start, "");
  const end = toIso(l?.end, "");
  if (!start || !end) return null;
  const candidate = {
    id: typeof l?.id === "string" && l.id ? l.id : fallback,
    accountId,
    subject: l?.subject?.name ?? l?.subject ?? "Cours",
    room: typeof l?.classroom === "string" ? l.classroom : Array.isArray(l?.classrooms) ? l.classrooms[0] : undefined,
    start,
    end,
  };
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
// plat structuré {label, allergens, composition} si l'ENT publie la composition.
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

/** Liste d'une période : [] si l'appel n'existe pas ou échoue (onglet inactif). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function periodList(period: any, method: string): Promise<unknown[]> {
  if (typeof period?.[method] !== "function") return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await period[method]()) as any;
    return Array.isArray(raw) ? raw : [];
  } catch {
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
    // calendrier de sanctions). Upgrade: lire `schedule` si l'ENT publie une plage.
    motif: joinReasons(p?.reasons, PUNISHMENT_MOTIF_MAX_CHARS) ?? "Sanction",
    type: nature || "Sanction",
    gravity: Number.isFinite(gravity) && gravity >= 0 ? gravity : undefined,
    periodId,
  };
  return isPunishment(cand) ? cand : null;
}

export class PronoteClientReader implements PronoteReader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly sessions: { requireClient(accountId: string): any; currentAccountId?(): string | null };
  private readonly logger: (message: string) => void;

  constructor(options: PronoteClientReaderOptions) {
    if (!options.sessions) throw new Error("sessions requises (PronoteSessionStore injecté)");
    this.sessions = options.sessions;
    this.logger = options.logger ?? (() => {});
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
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "grades");
      this.logger(`grades -> error ${mapped.code}`);
      throw mapped;
    }
    try {
      const periods = client.periods ?? [];
      const all: Grade[] = [];
      for (const p of periods) {
        const grades = (await p.grades()) as unknown[];
        // #74 : periodId porte le regroupement des moyennes, il vient de la
        // période Pronote qui porte ces notes (jamais deviné).
        const periodId = typeof p?.id === "string" && p.id ? p.id : undefined;
        grades.forEach((g, i) => {
          const m = mapGrade(id, g, all.length + i, periodId);
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
        throw new PronoteReadError("timetable ent unavailable", "ent_unavailable");
      }
      from = new Date(options.from);
    }
    if (options?.to !== undefined) {
      if (typeof options.to !== "string" || Number.isNaN(Date.parse(options.to))) {
        throw new PronoteReadError("timetable ent unavailable", "ent_unavailable");
      }
      to = new Date(options.to);
    }
    const limit = clampLimit(options?.limit);
    const offset = parseOffset(options?.cursor);
    let client;
    try {
      client = this.sessions.requireClient(id);
    } catch (err) {
      const mapped = toReadError(err, "timetable");
      this.logger(`timetable -> error ${mapped.code}`);
      throw mapped;
    }
    try {
      const raw = (await client.lessons(from, to)) as unknown[];
      const all: TimetableEntry[] = [];
      raw.forEach((l, i) => {
        const m = mapLesson(id, l, i);
        if (m) all.push(m);
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
      for (const p of periods) {
        // Établissement sans évaluations par compétences : pas d'appel, pas d'erreur.
        if (typeof p?.evaluations !== "function") continue;
        let raw: unknown[] = [];
        try {
          raw = (await p.evaluations()) as unknown[];
        } catch {
          continue;
        }
        const periodId = typeof p?.id === "string" && p.id ? p.id : undefined;
        (raw ?? []).forEach((e, i) => {
          const m = mapEvaluation(id, e, all.length + i, periodId);
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
        throw new PronoteReadError("menus ent unavailable", "ent_unavailable");
      }
      from = new Date(options.from);
    }
    if (options?.to !== undefined) {
      if (typeof options.to !== "string" || Number.isNaN(Date.parse(options.to))) {
        throw new PronoteReadError("menus ent unavailable", "ent_unavailable");
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
      (Array.isArray(raw) ? raw : []).forEach((m, i) => {
        const mapped = mapCanteenMenu(id, m, all.length + i);
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
      // Panne de lecture du profil = donnée absente, jamais une 500.
      this.logger(`me -> indisponible (${toReadError(err, "me").code}), page vide`);
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
        for (const a of await periodList(p, "absences")) {
          const m = mapAbsence(id, a, all.length, periodId);
          if (m) all.push(m);
        }
        for (const d of await periodList(p, "delays")) {
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
      this.logger(`attendance -> indisponible ${toReadError(err, "attendance").code}`);
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
        for (const s of await periodList(p, "punishments")) {
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
      this.logger(`punishments -> indisponible ${toReadError(err, "punishments").code}`);
      return { items: untrusted([]), nextCursor: null };
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
