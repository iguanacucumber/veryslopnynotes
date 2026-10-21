// Logique affichable de la vie scolaire (miroir web de Attendance.kt,
// AttendanceFormat.kt et AttendanceRows.kt). Pure : aucun React, aucun réseau.
//
// Payloads du pont : `{"absences":[],"periods":[]}` et `{"punishments":[]}`.
// Le pont factice publie `{"items":[]}` : les deux formes sont lues.
import { cleanText, parseInstant } from "../../lib/format";

export const MAX_MOTIF_CHARS = 500;
export const MAX_SUBJECT_CHARS = 64;
export const MAX_NAME_CHARS = 100;
export const ABSENCE_KINDS = ["absence", "late"] as const;

export interface Absence {
  id: string;
  kind: string;
  date: string;
  dateEnd: string | null;
  subject: string | null;
  motif: string | null;
  minutes: number | null;
  justified: boolean | null;
  periodId: string | null;
}

export interface PeriodCount {
  periodId: string;
  name: string;
  absences: number;
  late: number;
  minutes: number;
}

export interface AttendanceData {
  absences: Absence[];
  periods: PeriodCount[];
}

export interface Punishment {
  id: string;
  date: string;
  type: string;
  motif: string;
  /** Durée de la sanction en minutes, telle que publiée par le natif. */
  durationMinutes: number | null;
}

/** État de l'assiduité : `clean` = tout est justifié, `unjustified` = des
 *  heures sans justificatif, `unverified` = l'établissement ne publie pas la
 *  justification (inconnue, jamais « justifiée » déduite). */
export type AttendanceState = "clean" | "unjustified" | "unverified";

export interface AttendanceStatus {
  state: AttendanceState;
  eventCount: number;
  absenceCount: number;
  lateCount: number;
  totalMinutes: number;
  justifiedCount: number;
  unjustifiedCount: number;
  unverifiedCount: number;
  unjustifiedMinutes: number;
  /** Heures manquées dont la justification n'est PAS publiée. */
  unverifiedMinutes: number;
  /** Événements dont la justification reste à obtenir (inconnue ou refusée). */
  pendingCount: number;
  title: string;
  detail: string;
}

export interface AttendanceSection {
  kind: string;
  title: string;
  rows: Absence[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function bound(value: unknown, max: number): string {
  const raw = cleanText(value);
  if (!raw) return "";
  const points = Array.from(raw);
  return points.length <= max ? raw : points.slice(0, max).join("");
}

function optBounded(obj: Record<string, unknown>, key: string, max: number): string | null {
  return bound(obj[key], max) || null;
}

function optMinutes(obj: Record<string, unknown>): number | null {
  const v = obj["durationMinutes"];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.trunc(v);
}

function optInt(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
  return Math.trunc(v);
}

/** Instant d'une date ISO du contrat, ou null. Instant complet et date seule
 *  (minuit local) : l'analyseur est partagé avec le reste du web. */
export { parseInstant };

function arrayOf(root: Record<string, unknown>, canonicalKey: string): unknown[] {
  const canonical = root[canonicalKey];
  if (Array.isArray(canonical)) return canonical;
  const items = root["items"];
  return Array.isArray(items) ? items : [];
}

function payloadRoot(payload: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    return record(JSON.parse(payload) as unknown);
  } catch {
    return null;
  }
}

export function parseAttendance(payload: string | null): AttendanceData {
  const root = payloadRoot(payload);
  if (!root) return { absences: [], periods: [] };
  const absences: Absence[] = [];
  // #570 : un événement = UNE ligne. Le même identifiant publié deux fois
  // (la même absence, vue par deux périodes) n'est compté qu'une fois.
  //
  // L'identité est (kind, id), JAMAIS id seul : les absences et les retards
  // sont numérotés par DEUX TABLEES indépendantes — une absence `12` et un
  // retard `12` sont deux événements DIFFÉRENTS. Un ensemble partagé les
  // confondrait : le second disparaîtrait de l'écran.
  const seen = new Set<string>();
  for (const raw of arrayOf(root, "absences")) {
    const obj = record(raw);
    if (!obj) continue;
    const id = bound(obj["id"], 64);
    const rawKind = bound(obj["kind"], 16);
    // « delay » est la forme du pont factice ; le contrat dit « late ».
    const kind = rawKind === "delay" ? "late" : rawKind;
    const date = bound(obj["date"], 40);
    if (!id || !(ABSENCE_KINDS as readonly string[]).includes(kind)) continue;
    if (date.length < 10 || parseInstant(date) === null) continue;
    // La clé porte le KIND : deux événements de kinds DIFFÉRENTS qui
    // partagent un identifiant sont deux événements, pas un doublon.
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    const dateEnd = optBounded(obj, "dateEnd", 40);
    // Plage inversée = bruit, pas un événement.
    const start = parseInstant(date);
    const end = dateEnd ? parseInstant(dateEnd) : null;
    if (start !== null && end !== null && end < start) continue;
    // L'identifiant n'est marqué vu qu'une fois la ligne retenue : une ligne
    // hors contrat ne fait pas d'ombre à une ligne valide de même identifiant.
    seen.add(key);
    absences.push({
      id,
      kind,
      date,
      dateEnd,
      subject: optBounded(obj, "subject", MAX_SUBJECT_CHARS),
      motif: optBounded(obj, "motif", MAX_MOTIF_CHARS),
      minutes: optMinutes(obj),
      justified: typeof obj["justified"] === "boolean" ? obj["justified"] : null,
      periodId: optBounded(obj, "periodId", 64),
    });
  }
  absences.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const periods: PeriodCount[] = [];
  for (const raw of arrayOf(root, "periods")) {
    const obj = record(raw);
    if (!obj) continue;
    const periodId = bound(obj["periodId"], 64);
    if (!periodId) continue;
    periods.push({
      periodId,
      name: optBounded(obj, "name", MAX_NAME_CHARS) ?? periodId,
      absences: optInt(obj, "absences"),
      late: optInt(obj, "late"),
      minutes: optInt(obj, "missingMinutes"),
    });
  }
  periods.sort((a, b) => a.periodId.localeCompare(b.periodId));
  return { absences, periods };
}

export function parsePunishments(payload: string | null): Punishment[] {
  const root = payloadRoot(payload);
  if (!root) return [];
  const out: Punishment[] = [];
  for (const raw of arrayOf(root, "punishments")) {
    const obj = record(raw);
    if (!obj) continue;
    const date = bound(obj["date"], 40);
    const type = bound(obj["type"], 100);
    const motif = bound(obj["motif"], MAX_MOTIF_CHARS);
    if (date.length < 10 || parseInstant(date) === null || !type || !motif) continue;
    out.push({
      id: bound(obj["id"], 64),
      date,
      type,
      motif,
      durationMinutes: optMinutes(obj),
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

/**
 * Capacités du payload `capabilities` : `{capabilities:{tabs}}` (contrat),
 * `{items:{tabs}}` (pont factice) ou `{tabs}`.
 *
 * `null` = INCONNU (payload absent, illisible, ou contrat invalide publié
 * comme `capabilities: null`) : rien n'est affirmé, donc RIEN n'est masqué.
 * `[]` = liste AFFIRMÉE (contrat valide qui n'expose aucun onglet) : elle dit
 * le contraire de `null`, qui dit « je ne sais pas » (#413). Confondre les
 * deux, c'est blackpointer la navigation sur une panne.
 */
export function parseCapabilities(payload: string | null): string[] | null {
  const root = payloadRoot(payload);
  if (!root) return null;
  const candidates = [root["tabs"], record(root["capabilities"])?.["tabs"], record(root["items"])?.["tabs"]];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
    }
  }
  return null;
}

/**
 * La sanction est visible si les capacités sont INCONNUES (`null` : rien
 * n'est affirmé, donc rien n'est masqué) ou si l'onglet EST affirmé. Seule
 * une liste AFFIRMÉE qui n'a pas l'onglet le masque (#413).
 */
export function sanctionsVisible(capabilities: string[] | null): boolean {
  return capabilities === null || capabilities.includes("punishments");
}

export function absencesForPeriod(data: AttendanceData, periodId: string | null): Absence[] {
  return periodId === null ? data.absences : data.absences.filter((a) => a.periodId === periodId);
}

const LONG_DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const TIME = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function formatLongDate(value: string | number | null | undefined): string {
  const ms = typeof value === "number" ? value : parseInstant(value);
  if (ms === null || !Number.isFinite(ms)) return "";
  try {
    return LONG_DATE.format(new Date(ms));
  } catch {
    return "";
  }
}

export function formatTime(value: string | number): string {
  const ms = typeof value === "number" ? value : parseInstant(value);
  if (ms === null || !Number.isFinite(ms)) return "";
  try {
    return TIME.format(new Date(ms));
  } catch {
    return "";
  }
}

function hasTime(iso: string): boolean {
  return iso.includes("T") || iso.includes(" ");
}

/** Étendue d'un événement : une date, ou début → fin sur plusieurs jours.
 *  Même jour avec heures : « 12 octobre 2026 · 08:00 – 12:00 ». */
export function formatDateSpan(row: Absence): string {
  const start = parseInstant(row.date);
  if (start === null) return "";
  const head = formatLongDate(start);
  const end = row.dateEnd ? parseInstant(row.dateEnd) : null;
  if (end === null) return head;
  const startDay = new Date(start).toDateString();
  const endDay = new Date(end).toDateString();
  if (startDay === endDay) {
    if (!hasTime(row.date) || !row.dateEnd || !hasTime(row.dateEnd)) return head;
    return `${head} · ${formatTime(start)} – ${formatTime(end)}`;
  }
  return `${head} → ${formatLongDate(end)}`;
}

export function durationLongFr(minutes: number): string {
  const safe = Number.isFinite(minutes) && minutes > 0 ? Math.trunc(minutes) : 0;
  if (safe < 60) return `${safe} min`;
  const rest = safe % 60;
  const hours = Math.floor(safe / 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function absenceKindLabel(kind: string): string {
  if (kind === "absence") return "Absence";
  if (kind === "late") return "Retard";
  return "Événement";
}

export function absenceTitle(row: Absence): string {
  return row.motif?.trim() || row.subject?.trim() || absenceKindLabel(row.kind);
}

/** Aucune pastille inventée quand l'établissement n'affirme rien. */
export function justifiedLabel(justified: boolean | null): string {
  if (justified === true) return "justifiée";
  if (justified === false) return "non justifiée";
  return "";
}

/** Justification REFUSÉE par l'établissement (rare : le natif ne publie
 *  `false` que si Pronote l'affirme). */
export function isUnjustified(row: Absence): boolean {
  return row.justified === false;
}

/** Justification INCONNUE : le natif ne publie `justified` que si
 *  l'établissement l'affirme — son absence ne veut pas dire « justifiée ». */
export function isUnverified(row: Absence): boolean {
  return row.justified === null;
}

/** Événement dont la justification reste à obtenir : inconnue ou refusée. */
export function needsJustification(row: Absence): boolean {
  return row.justified !== true;
}

function minutesOf(rows: Absence[]): number {
  return rows.reduce((sum, r) => sum + (r.minutes !== null && r.minutes > 0 ? r.minutes : 0), 0);
}

/**
 * État de l'assiduité, sans jamais nier ce que l'établissement ne publie pas.
 *
 * Le natif ne publie `justified` que pour les événements JUSTIFIÉS : une
 * absence de ce champ est une information INCONNUE, pas une absence de
 * sanction. L'écran affiche donc les heures non vérifiées au lieu
 * d'affirmer que tout est justifié.
 */
export function attendanceStatus(rows: Absence[]): AttendanceStatus {
  const unjustified = rows.filter(isUnjustified);
  const unverified = rows.filter(isUnverified);
  const total = minutesOf(rows);
  const pending = minutesOf(unjustified);
  const unknown = minutesOf(unverified);
  const state: AttendanceState =
    unjustified.length > 0 ? "unjustified" : unverified.length > 0 ? "unverified" : "clean";
  const events = unjustified.length;
  const unjustifiedText = `${durationLongFr(pending)} sur ${durationLongFr(total)} manquées · ${events} ${
    events <= 1 ? "événement" : "événements"
  } sans justificatif`;
  const unverifiedText = `${durationLongFr(unknown)} sur ${durationLongFr(
    total,
  )} manquées · justification non publiée par l'établissement`;
  return {
    state,
    eventCount: rows.length,
    absenceCount: rows.filter((r) => r.kind === "absence").length,
    lateCount: rows.filter((r) => r.kind === "late").length,
    totalMinutes: total,
    justifiedCount: rows.filter((r) => r.justified === true).length,
    unjustifiedCount: unjustified.length,
    unverifiedCount: unverified.length,
    unjustifiedMinutes: pending,
    unverifiedMinutes: unknown,
    pendingCount: unjustified.length + unverified.length,
    title:
      state === "unjustified"
        ? "Des heures injustifiées"
        : state === "unverified"
          ? "Des heures non vérifiées"
          : "Aucune heure injustifiée",
    detail:
      state === "clean"
        ? "Toutes les absences et tous les retards publiés sont justifiés."
        : state === "unjustified"
          ? // Les heures sans information de justification sont dites à part :
            // sinon « 20 min sur 4 h manquées » laisserait croire que le reste
            // est justifié.
            unverified.length > 0
            ? `${unjustifiedText} · ${unverified.length} sans information de justification`
            : unjustifiedText
          : unverifiedText,
  };
}

/** Sections fixes : absences puis retards ; une section vide n'est pas rendue. */
export function attendanceSections(rows: Absence[]): AttendanceSection[] {
  const out: AttendanceSection[] = [];
  for (const kind of ["absence", "late"] as const) {
    const group = rows.filter((r) => r.kind === kind);
    if (group.length > 0) out.push({ kind, title: `${absenceKindLabel(kind)}s`, rows: group });
  }
  return out;
}
