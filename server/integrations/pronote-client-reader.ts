// Lectures via Client pronotets (session SSO Ninegate).
// Hiérarchie : Domain → PronoteReader → PronoteClientReader → pronotets → HTTP (I2).
// Sorties marquées Untrusted (I6). Erreurs typées sans secret.
// Pagination : limit clampée 1..100 (défaut 50), cursor = offset opaque, nextCursor null = fin.
// Mappers : Grade pronotets (grade/outOf strings) → contrat (value/scale numbers).
// ponytail: mappers purs minimaux, pas de lib date.
// Upgrade: moyennes fournies (#74), contenus (#75), semaine (#76) enrichiront ces mappers.
import type { Assignment, Grade, TimetableEntry } from "../../shared/contracts/models";
import { isAssignment, isGrade, isTimetableEntry } from "../../shared/contracts/models";
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

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGrade(accountId: string, g: any, index: number): Grade | null {
  const fallback = `g-${index}`;
  const candidate = {
    id: typeof g?.id === "string" && g.id ? g.id : fallback,
    accountId,
    subject: g?.subject?.name ?? g?.subject ?? "Matière",
    value: toNumber(g?.grade, Number.NaN),
    scale: toNumber(g?.outOf ?? g?.defaultOutOf, 20),
    coefficient: g?.coefficient !== undefined ? toNumber(g.coefficient, 1) : undefined,
    date: toIso(g?.date, new Date().toISOString()),
  };
  if (!Number.isFinite(candidate.value)) return null;
  return isGrade(candidate) ? candidate : null;
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
        grades.forEach((g, i) => {
          const m = mapGrade(id, g, all.length + i);
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
}
