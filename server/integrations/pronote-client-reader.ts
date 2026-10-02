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
import type { Assignment, Grade, NewsItem, Period, TimetableEntry } from "../../shared/contracts/models";
import {
  isAssignment,
  isGrade,
  isNewsItem,
  isPeriod,
  isTimetableEntry,
  NEWS_BODY_MAX_CHARS,
  NEWS_META_MAX_CHARS,
  NEWS_TITLE_MAX_CHARS,
} from "../../shared/contracts/models";
import type {
  PedagogicResource,
  PronotePage,
  PronotePageOptions,
  PronoteReader,
  PronoteTimetableOptions,
} from "../domain/ports";
import { isPedagogicResource, PronoteAuthError, PronoteReadError, untrusted } from "../domain/ports";

export interface PronoteClientReaderOptions {
  /** Résolveur session injecté (PronoteSessionStore.requireClient). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly sessions: { requireClient(accountId: string): any };
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
function mapAssignment(accountId: string, h: any, index: number): Assignment | null {
  const fallback = `a-${index}`;
  const candidate = {
    id: typeof h?.id === "string" && h.id ? h.id : fallback,
    accountId,
    subject: h?.subject?.name ?? h?.subject ?? "Matière",
    title: typeof h?.description === "string" && h.description.trim() ? h.description.trim().slice(0, 200) : "Devoir",
    dueDate: toIso(h?.date, new Date().toISOString()),
    done: h?.done === true,
  };
  return isAssignment(candidate) ? candidate : null;
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

export class PronoteClientReader implements PronoteReader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly sessions: { requireClient(accountId: string): any };
  private readonly logger: (message: string) => void;

  constructor(options: PronoteClientReaderOptions) {
    if (!options.sessions) throw new Error("sessions requises (PronoteSessionStore injecté)");
    this.sessions = options.sessions;
    this.logger = options.logger ?? (() => {});
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
      const later = new Date(now.getTime() + 21 * 86400000);
      const raw = (await client.homework(new Date(now.getTime() - 7 * 86400000), later)) as unknown[];
      const all: Assignment[] = [];
      raw.forEach((h, i) => {
        const m = mapAssignment(id, h, i);
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
}
