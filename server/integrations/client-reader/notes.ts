// Notes, périodes et moyennes RÉELLEMENT publiées par l'établissement
// (#74, #197). Déplacé depuis pronote-client-reader.ts tel quel : un
// displacement, pas une réécriture. La façade `PronoteClientReader` délègue ici.
import type { Grade, Period } from "../../../shared/contracts/models";
import { isGrade, isPeriod } from "../../../shared/contracts/models";
import type { PronotePage, PronotePageOptions } from "../../domain/ports";
import { PronoteReadError, untrusted } from "../../domain/ports";
import type { ProvidedAverages } from "../../domain/averages";
import { subjectKey } from "../../domain/averages";
import type { ReaderCtx } from "./primitives";
import {
  bounded,
  clampLimit,
  parseOffset,
  refreshSession,
  toIso,
  toNumber,
  toReadError,
} from "./primitives";

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
export function mapPeriods(raw: any[]): Period[] {
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

/** Longueur de matière au-delà de laquelle une moyenne publiée n'est pas lue. */
const PROVIDED_SUBJECT_MAX_CHARS = 100;

/**
 * Une moyenne PUBLIÉE par l'établissement (pronotets `Period.averages()`),
 * ramenée sur /20 : `student` + `outOf` + `subject.name`. Valeur ou matière
 * illisible (« N.Rendu », « Non renseigné », vide) = entrée ABSENTE, jamais un 0
 * ni une moyenne devinée (I6). Clé = `subjectKey` : même regroupement que
 * l'estimation, donc une matière fournie remplace la sienne estimée.
 * Matière hors borne = absente : la clé ne sert qu'à retrouver une matière
 * déjà bornée par le contrat, donc un nom trop long ne peut rien alimenter (et aucune
 * chaîne arbitraire ne vit dans l'instantané).
 */
function mapProvidedAverage(raw: unknown): { subjectKey: string; value: number } | null {
  const a = raw as { student?: unknown; outOf?: unknown; defaultOutOf?: unknown; subject?: unknown };
  const subject = a?.subject;
  const name = typeof subject === "object" && subject !== null ? (subject as { name?: unknown }).name : subject;
  const value = toNumber(a?.student, Number.NaN);
  if (typeof name !== "string" || name.trim() === "" || !Number.isFinite(value)) return null;
  if (name.length > PROVIDED_SUBJECT_MAX_CHARS) return null;
  // Barème de la matière différent de /20 : on ramène sur /20 (même règle que
  // `addWeighted`), sinon l'app afficherait une moyenne sur l'autre barème.
  const outOf = toNumber(a?.outOf ?? a?.defaultOutOf, 20);
  const sur20 = Number.isFinite(outOf) && outOf > 0 && outOf !== 20 ? (value / outOf) * 20 : value;
  return { subjectKey: subjectKey(name), value: sur20 };
}

export async function getGrades(ctx: ReaderCtx, accountId: string, page?: PronotePageOptions): Promise<PronotePage<Grade>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("grades session expired", "session_expired");
  const limit = clampLimit(page?.limit);
  const offset = parseOffset(page?.cursor);
  let client;
  try {
    await refreshSession(ctx, id);
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "grades");
    ctx.logger(`grades -> error ${mapped.code}`);
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
    ctx.logger(`grades -> ok ${slice.length}`);
    return { items: untrusted(slice), nextCursor };
  } catch (err) {
    const mapped = toReadError(err, "grades");
    ctx.logger(`grades -> error ${mapped.code}`);
    throw mapped;
  }
}

/** Périodes (#74) : libellés + bornes pour les onglets et le filtre periodId. */
export async function getPeriods(ctx: ReaderCtx, accountId: string): Promise<PronotePage<Period>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("periods session expired", "session_expired");
  let client;
  try {
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "periods");
    ctx.logger(`periods -> error ${mapped.code}`);
    throw mapped;
  }
  try {
    const items = mapPeriods((client.periods ?? []) as unknown[]);
    ctx.logger(`periods -> ok ${items.length}`);
    return { items: untrusted(items), nextCursor: null };
  } catch (err) {
    const mapped = toReadError(err, "periods");
    ctx.logger(`periods -> error ${mapped.code}`);
    throw mapped;
  }
}

/**
 * #74 (suite) : les moyennes RÉELLEMENT publiées par l'établissement, par
 * période — `Period.averages()` (moyenne élève par matière) et
 * `overallAverage()` (générale). C'est ce que l'app affiche en « moyenne
 * fournie » ; sans cette lecture, tout reste `estimated`.
 *
 * Une période qui ne publie rien (bulletin non publié, droits refusés) est
 * ABSENTE de la page : l'estimation prend le relais pour cette période.
 * ponytail: pas de `classOverallAverage()` (moyenne de classe générale, hors
 * contrat). Upgrade: rapport `Period.report()` si un jour l'app veut les
 * commentaires d'établissement.
 */
export async function getProvidedAverages(ctx: ReaderCtx, accountId: string): Promise<PronotePage<ProvidedAverages>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("providedAverages session expired", "session_expired");
  let client;
  try {
    await refreshSession(ctx, id);
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "providedAverages");
    ctx.logger(`providedAverages -> error ${mapped.code}`);
    throw mapped;
  }
  const out: ProvidedAverages[] = [];
  let muettes = 0;
  for (const raw of (client.periods ?? []) as unknown[]) {
    const p = raw as { id?: unknown; averages?: unknown; overallAverage?: unknown };
    // Clé = id de la période, celle que `mapGrade` porte sur les notes : sans
    // elle la moyenne ne serait jamais eligible au bon périmètre.
    const periodId = typeof p?.id === "string" ? p.id : null;
    if (!periodId) continue;
    try {
      // Sans prototype : la clé vient de Pronote, donc `__proto__` ne doit
      // JAMAIS toucher le prototype de la table (même garde que
      // `discussionMessages` du snapshot).
      const subjects: Record<string, number> = Object.create(null) as Record<string, number>;
      const rows = typeof p?.averages === "function"
        ? ((await (p.averages as () => Promise<unknown>)()) as unknown[])
        : [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const mapped = mapProvidedAverage(row);
        if (mapped) subjects[mapped.subjectKey] = mapped.value;
      }
      // Valeur non lisible = absente : `overallAverage()` renvoie "" quand
      // l'établissement n'a rien publié.
      const general =
        typeof p?.overallAverage === "function"
          ? toNumber(await (p.overallAverage as () => Promise<unknown>)(), Number.NaN)
          : Number.NaN;
      if (Object.keys(subjects).length === 0 && !Number.isFinite(general)) {
        muettes += 1;
        continue;
      }
      out.push({
        periodId,
        ...(Number.isFinite(general) ? { general } : {}),
        ...(Object.keys(subjects).length > 0 ? { subjects } : {}),
      });
    } catch (err) {
      // Session morte = l'app DOIT se ré-appairer : elle remonte, avalée elle
      // deviendrait un « établissement ne publie rien » silencieux.
      const mapped = toReadError(err, "providedAverages");
      if (mapped.code === "session_expired") throw mapped;
      muettes += 1;
      ctx.logger(`providedAverages -> periode indisponible (${mapped.code})`);
    }
  }
  // Compteurs seuls : aucun nom de matière, aucune valeur.
  ctx.logger(`providedAverages -> ok ${out.length} (muettes ${muettes})`);
  return { items: untrusted(out), nextCursor: null };
}
