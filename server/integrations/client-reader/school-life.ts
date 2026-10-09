// Vie scolaire : absences, retards, sanctions, et menus de cantine
// (#77, #81, #197). Déplacé tel quel depuis pronote-client-reader.ts.
import type { AbsenceRecord, CanteenMeal, CanteenMenu, Punishment } from "../../../shared/contracts/models";
import {
  ABSENCE_MOTIF_MAX_CHARS,
  ABSENCE_SUBJECT_MAX_CHARS,
  CANTEEN_MAX_ALLERGEN_CHARS,
  CANTEEN_MAX_ALLERGENS,
  CANTEEN_MAX_DISH_CHARS,
  CANTEEN_MAX_DISHES,
  isAbsenceRecord,
  isCanteenMenu,
  isPunishment,
  PUNISHMENT_MOTIF_MAX_CHARS,
  PUNISHMENT_TYPE_MAX_CHARS,
} from "../../../shared/contracts/models";
import type { PronotePage, PronotePageOptions, PronoteTimetableOptions } from "../../domain/ports";
import { PronoteReadError, untrusted } from "../../domain/ports";
import type { ReaderCtx } from "./primitives";
import {
  bounded,
  clampLimit,
  parseOffset,
  toIso,
  toNumber,
  toReadError,
} from "./primitives";

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
export async function getMenus(ctx: ReaderCtx, accountId: string, options?: PronoteTimetableOptions): Promise<PronotePage<CanteenMenu>> {
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
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "menus");
    ctx.logger(`menus -> error ${mapped.code}`);
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
    ctx.logger(`menus -> ok ${slice.length}`);
    return { items: untrusted(slice), nextCursor };
  } catch (err) {
    const mapped = toReadError(err, "menus");
    // Session morte = re-authentification requise, jamais "aucun menu" : sinon
    // l'app afficherait un onglet vide au lieu de proposer le re-login.
    if (mapped.code === "session_expired") {
      ctx.logger(`menus -> error ${mapped.code}`);
      throw mapped;
    }
    // Cantine indisponible = absence de donnée, pas une panne de sync.
    ctx.logger(`menus -> indisponible ${mapped.code}`);
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
export async function getAttendance(ctx: ReaderCtx, accountId: string, page?: PronotePageOptions): Promise<PronotePage<AbsenceRecord>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("attendance session expired", "session_expired");
  const limit = clampLimit(page?.limit);
  const offset = parseOffset(page?.cursor);
  let client;
  try {
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "attendance");
    ctx.logger(`attendance -> error ${mapped.code}`);
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
    ctx.logger(`attendance -> ok ${slice.length}`);
    return { items: untrusted(slice), nextCursor };
  } catch (err) {
    const mapped = toReadError(err, "attendance");
    // Session morte = re-appairage demandé par l'app. Une page vide ici
    // EFFACERAIT les absences déjà synchronisées (I6) au lieu de les
    // mettre en attente : getMenus/getNews font déjà ce tri.
    if (mapped.code === "session_expired") {
      ctx.logger(`attendance -> error ${mapped.code}`);
      throw mapped;
    }
    ctx.logger(`attendance -> indisponible ${mapped.code}`);
    return { items: untrusted([]), nextCursor: null };
  }
}

/** Sanctions vie scolaire (#77). Onglet absent/KO = page vide, jamais d'erreur. */
export async function getPunishments(ctx: ReaderCtx, accountId: string, page?: PronotePageOptions): Promise<PronotePage<Punishment>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("punishments session expired", "session_expired");
  const limit = clampLimit(page?.limit);
  const offset = parseOffset(page?.cursor);
  let client;
  try {
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "punishments");
    ctx.logger(`punishments -> error ${mapped.code}`);
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
    ctx.logger(`punishments -> ok ${slice.length}`);
    return { items: untrusted(slice), nextCursor };
  } catch (err) {
    const mapped = toReadError(err, "punishments");
    // Session morte = re-appairage (I6), jamais une page vide qui purge les
    // sanctions déjà synchronisées.
    if (mapped.code === "session_expired") {
      ctx.logger(`punishments -> error ${mapped.code}`);
      throw mapped;
    }
    ctx.logger(`punishments -> indisponible ${mapped.code}`);
    return { items: untrusted([]), nextCursor: null };
  }
}
