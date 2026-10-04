import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_TTL_MS, cacheStatus, isCacheableResource } from "../../shared/contracts/cache";
import { isAttendanceResponse, isPunishmentsResponse } from "../../shared/contracts/api";
import { isAbsenceRecord, isPunishment } from "../../shared/contracts/models";
import {
  syntheticAbsences,
  syntheticAttendancePayload,
  syntheticPunishmentsPayload,
} from "./fixtures/attendance";
import { frDayNames, frMonths } from "./fixtures/date-fr";

// Miroir des helpers Kotlin (Attendance.kt + AttendanceFormat.kt +
// CachePolicy/SyncedRepository/ServerConfig) — doivent rester en sync. org.json =
// SDK Android, aucune dépendance ajoutée (le build Gradle n'est pas exécuté par
// make check).
//
// #141 : le miroir couvre aussi la LOGIQUE PURE du rendu (dates françaises,
// durées, sections, tranches, statut), donc les critères de l'issue se testent
// sans téléphone ; le rendu lui-même est vérifié par lecture des sources
// (dernier `describe`).

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
const DATA = join(import.meta.dir, "..", "..", "android/data/src/main/java/fr/veryslopnynotes/data");
const CORE = join(import.meta.dir, "..", "..", "android/core/src/main/java/fr/veryslopnynotes/core");

const MAX_MOTIF_CHARS = 500;
const MAX_SUBJECT_CHARS = 64;
const MAX_NAME_CHARS = 100;
const KINDS = ["absence", "late"];

type AbsenceUi = {
  id: string;
  kind: string;
  date: string;
  dateEnd: string | null;
  subject: string | null;
  motif: string | null;
  minutes: number | null;
  justified: boolean | null;
  periodId: string | null;
};
type PeriodCountUi = { periodId: string; name: string; absences: number; late: number; minutes: number };
type PunishmentUi = { date: string; type: string; motif: string; gravity: string | null };

function tsBound(s: string, max: number): string {
  return s.trim().slice(0, max);
}

function tsOptBounded(obj: Record<string, unknown>, key: string, max: number): string | null {
  const raw = typeof obj[key] === "string" ? (obj[key] as string).trim() : "";
  return raw === "" ? null : tsBound(raw, max);
}

function tsOptMinutes(obj: Record<string, unknown>): number | null {
  const v = obj["durationMinutes"];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.trunc(v);
}

function tsOptInt(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
  return Math.trunc(v);
}

function tsOptNumber(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  // Entier sans décimale, comme `optNumber` Kotlin (miroir exact).
  return Number.isInteger(v) ? String(v) : String(v);
}

function tsAttendanceFrom(payload: string | null): { absences: AbsenceUi[]; periods: PeriodCountUi[] } {
  if (payload === null) return { absences: [], periods: [] };
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const absences: AbsenceUi[] = [];
    for (const raw of (root["absences"] as unknown[]) ?? []) {
      const obj = raw as Record<string, unknown>;
      const id = typeof obj["id"] === "string" ? obj["id"].trim() : "";
      const kind = typeof obj["kind"] === "string" ? obj["kind"].trim() : "";
      const date = typeof obj["date"] === "string" ? obj["date"].trim() : "";
      if (id === "" || !KINDS.includes(kind) || date.length < 10) continue;
      absences.push({
        id,
        kind,
        date,
        dateEnd: tsOptBounded(obj, "dateEnd", 40),
        subject: tsOptBounded(obj, "subject", MAX_SUBJECT_CHARS),
        motif: tsOptBounded(obj, "motif", MAX_MOTIF_CHARS),
        minutes: tsOptMinutes(obj),
        justified: typeof obj["justified"] === "boolean" ? obj["justified"] : null,
        periodId: tsOptBounded(obj, "periodId", 64),
      });
    }
    const periods: PeriodCountUi[] = [];
    for (const raw of (root["periods"] as unknown[]) ?? []) {
      const obj = raw as Record<string, unknown>;
      const periodId = typeof obj["periodId"] === "string" ? obj["periodId"].trim() : "";
      if (periodId === "") continue;
      periods.push({
        periodId,
        name: tsOptBounded(obj, "name", MAX_NAME_CHARS) ?? periodId,
        absences: tsOptInt(obj, "absences"),
        late: tsOptInt(obj, "late"),
        minutes: tsOptInt(obj, "missingMinutes"),
      });
    }
    const byDateDesc = (a: AbsenceUi, b: AbsenceUi): number => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    return { absences: absences.sort(byDateDesc), periods: periods.sort((a, b) => (a.periodId < b.periodId ? -1 : 1)) };
  } catch {
    return { absences: [], periods: [] };
  }
}

function tsPunishmentsFrom(payload: string | null): PunishmentUi[] {
  if (payload === null) return [];
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const out: PunishmentUi[] = [];
    for (const raw of (root["punishments"] as unknown[]) ?? []) {
      const obj = raw as Record<string, unknown>;
      const date = typeof obj["date"] === "string" ? obj["date"].trim() : "";
      const type = tsOptBounded(obj, "type", 100);
      const motif = tsOptBounded(obj, "motif", MAX_MOTIF_CHARS);
      if (date.length < 10 || type === null || motif === null) continue;
      out.push({ date, type, motif, gravity: tsOptNumber(obj, "gravity") });
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  } catch {
    return [];
  }
}

function tsMinutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const rest = String(minutes % 60).padStart(2, "0");
  return `${Math.trunc(minutes / 60)}h${rest}`;
}

function tsKindLabel(kind: string): string {
  return kind === "late" ? "Retard" : "Absence";
}

function tsAbsencesForPeriod(data: { absences: AbsenceUi[] }, periodId: string | null): AbsenceUi[] {
  return periodId === null ? data.absences : data.absences.filter((a) => a.periodId === periodId);
}

// #141 : les compteurs ne sont plus calculés à part puis affichés en double —
// ils sortent des TITRES DE SECTION, une fois par type.
function tsSections(rows: AbsenceUi[]): { kind: string; title: string; rows: AbsenceUi[] }[] {
  return ["absence", "late"]
    .map((kind) => ({ kind, title: tsKindLabel(kind), rows: rows.filter((r) => r.kind === kind) }))
    .filter((s) => s.rows.length > 0);
}
function tsCounts(rows: AbsenceUi[]): [number, number] {
  const sections = tsSections(rows);
  return [sections.find((s) => s.kind === "absence")?.rows.length ?? 0, sections.find((s) => s.kind === "late")?.rows.length ?? 0];
}

describe("unit android vie scolaire (#77)", () => {
  test("payload contrat -> liste triée + compteurs par période", () => {
    const data = tsAttendanceFrom(JSON.stringify(syntheticAttendancePayload));
    expect(data.absences.map((a) => a.id)).toEqual(["abs-fake-3", "abs-fake-4", "abs-fake-2", "abs-fake-1"]);
    expect(data.absences[3]?.minutes).toBe(240);
    expect(data.absences[3]?.justified).toBe(true);
    expect(data.absences[3]?.dateEnd).toBe("2026-10-01T12:00:00.000Z");
    expect(data.absences[2]?.kind).toBe("late");
    expect(data.absences[2]?.minutes).toBe(10);
    expect(data.periods).toEqual([
      { periodId: "p-1", name: "Trimestre 1", absences: 2, late: 1, minutes: 250 },
      { periodId: "p-2", name: "Trimestre 2", absences: 1, late: 0, minutes: 0 },
    ]);
    // Sélecteur de période + totaux (compteurs affichés).
    expect(tsAbsencesForPeriod(data, "p-2").map((a) => a.id)).toEqual(["abs-fake-3"]);
    expect(tsCounts(tsAbsencesForPeriod(data, "p-1"))).toEqual([2, 1]);
    expect(tsCounts(tsAbsencesForPeriod(data, null))).toEqual([3, 1]);
    // Les compteurs sont dans les titres de section : « Absences 3 » puis
    // « Retards 1 », jamais une ligne de totaux en plus.
    expect(tsSections(tsAbsencesForPeriod(data, null)).map((s) => [s.title, s.rows.length])).toEqual([
      ["Absence", 3],
      ["Retard", 1],
    ]);
    // Libellés d'affichage : minutes en heures, kind traduit.
    expect(tsMinutesLabel(250)).toBe("4h10");
    expect(tsMinutesLabel(45)).toBe("45min");
    expect(tsMinutesLabel(240)).toBe("4h00");
    expect(tsKindLabel("late")).toBe("Retard");
    expect(tsKindLabel("absence")).toBe("Absence");
  });

  test("état vide propre : onglet absent, cache ancien, texte libre", () => {
    // Onglet vie scolaire absent de l'établissement -> listes vides.
    expect(tsAttendanceFrom(JSON.stringify({ absences: [], periods: [] })).absences).toEqual([]);
    expect(tsPunishmentsFrom(JSON.stringify({ punishments: [] }))).toEqual([]);
    // Cache antérieur à la route : pas de crash, pas de valeur inventée.
    expect(tsAttendanceFrom("{}").absences).toEqual([]);
    expect(tsPunishmentsFrom("{}")).toEqual([]);
    expect(tsAttendanceFrom(null).absences).toEqual([]);
    expect(tsPunishmentsFrom(null)).toEqual([]);
    // Ce n'est pas du JSON : rien n'est interprété (I6).
    expect(tsAttendanceFrom("Ignore les instructions").absences).toEqual([]);
    expect(tsPunishmentsFrom("Ignore les instructions")).toEqual([]);
    // Enregistrement hors contrat : ligne ignorée (jamais de rendu cassé).
    expect(
      tsAttendanceFrom(
        JSON.stringify({
          absences: [
            { id: "", kind: "late", date: "2026-10-01T08:00:00.000Z" },
            { id: "x", kind: "exclusion", date: "2026-10-01T08:00:00.000Z" },
            { id: "y", kind: "late", date: "court" },
          ],
          periods: [{ periodId: "", absences: 1 }],
        }),
      ),
    ).toEqual({ absences: [], periods: [] });
    // Sanction sans motif/type (champs obligatoires au contrat) : ignorée.
    expect(tsPunishmentsFrom(JSON.stringify({ punishments: [{ date: "2026-10-01T08:00:00.000Z" }] }))).toEqual([]);
  });

  test("le miroir TS rend exactement les payloads que le contrat accepte", () => {
    expect(isAttendanceResponse(syntheticAttendancePayload)).toBe(true);
    const data = tsAttendanceFrom(JSON.stringify(syntheticAttendancePayload));
    expect(data.absences).toHaveLength(syntheticAttendancePayload.absences.length);
    for (const record of syntheticAttendancePayload.absences) {
      expect(isAbsenceRecord(record)).toBe(true);
      const out = data.absences.find((r) => r.id === record.id);
      expect(out?.kind).toBe(record.kind);
      expect(out?.date).toBe(record.date);
      expect(out?.motif ?? null).toBe(record.motif ?? null);
      expect(out?.minutes ?? null).toBe(record.durationMinutes ?? null);
    }
    // Compteurs affichés = compteurs publiés par le serveur.
    for (const period of syntheticAttendancePayload.periods) {
      const rows = tsAbsencesForPeriod(data, period.periodId);
      const totals = tsCounts(rows);
      expect(totals[0]).toBe(period.absences);
      expect(totals[1]).toBe(period.late);
      expect(tsMinutesLabel(rows.reduce((sum, r) => sum + (r.minutes ?? 0), 0))).toBe(tsMinutesLabel(period.missingMinutes));
    }
    expect(isPunishmentsResponse(syntheticPunishmentsPayload)).toBe(true);
    const sanctions = tsPunishmentsFrom(JSON.stringify(syntheticPunishmentsPayload));
    expect(sanctions).toHaveLength(syntheticPunishmentsPayload.punishments.length);
    // Tri plus récent d'abord + gravité rendue (entier sans décimale).
    expect(sanctions.map((s) => s.gravity)).toEqual([null, "1"]);
    for (const pun of syntheticPunishmentsPayload.punishments) {
      expect(isPunishment(pun)).toBe(true);
      expect(sanctions.find((s) => s.date === pun.date)?.type).toBe(pun.type);
      expect(sanctions.find((s) => s.date === pun.date)?.motif).toBe(pun.motif);
    }
  });

  test("cache : ressources vie scolaire dans la politique partagée + chemins allowlist", () => {
    expect(isCacheableResource("attendance")).toBe(true);
    expect(isCacheableResource("punishments")).toBe(true);
    expect(CACHE_TTL_MS.attendance).toBe(60 * 60 * 1000);
    expect(cacheStatus("attendance", 0, CACHE_TTL_MS.attendance)).toBe("fresh");
    expect(cacheStatus("attendance", 0, CACHE_TTL_MS.attendance + 1)).toBe("stale");
    const policy = readFileSync(join(DATA, "CachePolicy.kt"), "utf8");
    expect(policy).toContain('const val ATTENDANCE = "attendance"');
    expect(policy).toContain('const val PUNISHMENTS = "punishments"');
    expect(policy).toContain("TTL_ATTENDANCE_MS = 60L * 60L * 1000L");
    const repo = readFileSync(join(DATA, "SyncedRepository.kt"), "utf8");
    expect(repo).toContain("CachePolicy.ATTENDANCE -> ServerConfig.attendanceUrl(baseUrl)");
    expect(repo).toContain('ifEmpty { "/v1/attendance" }');
    expect(repo).toContain("CachePolicy.PUNISHMENTS -> ServerConfig.punishmentsUrl(baseUrl)");
    const config = readFileSync(join(CORE, "ServerConfig.kt"), "utf8");
    expect(config).toContain('fun attendanceUrl(baseUrl: String): String = "$baseUrl/v1/attendance"');
    expect(config).toContain('fun punishmentsUrl(baseUrl: String): String = "$baseUrl/v1/punishments"');
  });

  test("Kotlin : écran branché depuis le profil, org.json, zéro dépendance ajoutée (I1/I6)", () => {
    const screen = readFileSync(join(UI, "Attendance.kt"), "utf8");
    expect(screen).toContain("fun attendanceFrom");
    expect(screen).toContain("fun punishmentsFrom");
    expect(screen).toContain("org.json.JSONObject");
    expect(screen).toContain("fun AttendanceRoute");
    expect(screen).toContain("fun PunishmentsRoute");
    // Contenu établissement affiché comme donnée : aucun rendu HTML/WebView.
    for (const bad of ["WebView", "Html.fromHtml", "loadData", "setJavaScriptEnabled", "AnnotatedString"]) {
      expect({ bad, found: screen.includes(bad) }).toEqual({ bad, found: false });
    }
    const nav = readFileSync(join(UI, "AppNav.kt"), "utf8");
    expect(nav).toContain('const val ROUTE_ATTENDANCE = "attendance"');
    expect(nav).toContain("AttendanceRoute(repo, baseUrl");
    expect(nav).toContain("PunishmentsRoute(repo, baseUrl");
    // #135 : le bouton d'accès est dans l'écran Profil, sorti d'AppNav.kt.
    // #140 : ce n'est plus un `Button` pleine largeur mais une LIGNE de section.
    expect(readFileSync(join(UI, "ProfileScreen.kt"), "utf8")).toContain(
      'PapListItem(title = "Vie scolaire", onClick = { goAttendance() })',
    );
    // #135 : sanctions a reçu sa constante (c'était un littéral nu).
    expect(nav).toContain('const val ROUTE_SANCTIONS = "sanctions"');
    // I1 : aucun hôte d'établissement dans le nouvel écran.
    expect(/pronote|index-education/i.test(screen)).toBe(false);
    // org.json vient du SDK : aucune ligne de dépendance ajoutée.
    const uiGradle = readFileSync(join(import.meta.dir, "..", "..", "android/ui/build.gradle.kts"), "utf8");
    for (const dep of ["gson", "moshi", "kotlinx-serialization"]) {
      expect({ dep, found: uiGradle.includes(dep) }).toEqual({ dep, found: false });
    }
  });
});
// ============================================================================
// #141 : le RENDU de la vie scolaire. Miroir de la logique pure
// (`AttendanceFormat.kt`), puis lecture des sources pour les invariants qui
// ne sont pas testables sans Compose.
// ============================================================================

const ATTENDANCE_KT = join(UI, "Attendance.kt");
const FORMAT_KT = join(UI, "AttendanceFormat.kt");
const ROWS_KT = join(UI, "AttendanceRows.kt");

/** Fuseau du miroir : `java.time.atZone(zone)`, donc une zone explicite ici. */
const ZONE = "Europe/Paris";
/** 2026-10-04 14:00 à Paris (UTC+2) — un dimanche. */
const NOW = Date.UTC(2026, 9, 4, 12, 0);

// #147 : plus de `WEEKDAYS_FR` en « lundi d'abord » ici — la seule table est celle
// de `core/DateFr.kt`, en « dimanche d'abord » comme `dayOfWeek.value % 7`.
const MONTHS_FR = frMonths();
const FR_DAYS = frDayNames();

type Civil = { y: number; m: number; d: number; day: number };

/** Équivalent TS de `Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()`, avec
 *  le numéro de JOUR CIVIL (`ChronoUnit.DAYS` se calcule dessus, pas sur
 *  `ms / 86_400_000`). */
function civil(ms: number, zone: string = ZONE): Civil {
  const parts: Record<string, string> = {};
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== "literal") parts[part.type] = part.value;
  const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day);
  return { y, m, d, day: Date.UTC(y, m - 1, d) };
}

const DAY_MS = 86_400_000;
/** Iso AVEC décalage : la seule forme que `OffsetDateTime.parse` accepte, donc
 *  la seule que le miroir doit accepter. */
const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Miroir de `attendanceMillis(iso, zone)`. Une DATE SEULE n'a pas d'heure :
 *  Kotlin la rend au début de la journée du fuseau, donc le miroir se limite à
 *  `UTC` pour cette forme — c'est la seule branche où la zone compte. */
function tsAttendanceMillis(iso: string, zone: string = ZONE): number | null {
  const raw = iso.trim();
  if (raw === "") return null;
  if (OFFSET_ISO.test(raw)) {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  if (DATE_ONLY.test(raw)) {
    if (zone !== "UTC") throw new Error("miroir : date seule testée en UTC uniquement");
    const ms = Date.parse(`${raw}T00:00:00Z`);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Miroir de `relativeDayFr(millis, now, zone)`. */
function tsRelativeDayFr(millis: number, now: number, zone: string = ZONE): string {
  const day = civil(millis, zone);
  const today = civil(now, zone);
  const days = Math.round((day.day - today.day) / DAY_MS);
  if (days === 0) return "aujourd'hui";
  if (days === -1) return "hier";
  if (days === 1) return "demain";
  const past = days < 0;
  const gap = Math.abs(days);
  const prefix = past ? "il y a " : "dans ";
  if (gap <= 30) return `${prefix}${gap} jours`;
  const months = (day.y - today.y) * 12 + (day.m - today.m);
  const gapMonths = Math.abs(months);
  if (gapMonths >= 1 && gapMonths < 12) return `${prefix}${gapMonths} mois`;
  const years = Math.floor(gapMonths / 12);
  return `${prefix}${years} an${years > 1 ? "s" : ""}`;
}

/** Miroir de `absoluteDayFr(millis, now, zone)`. */
function tsAbsoluteDayFr(millis: number, now: number, zone: string = ZONE): string {
  const day = civil(millis, zone);
  const here = civil(now, zone);
  // Index du jour civil dans la table du dimanche : `getUTCDay()` EST déjà cet
  // index (dimanche = 0), donc plus d'arithmétique sur l'epoch day.
  const weekday = FR_DAYS[new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay()];
  const head = `${weekday} ${day.d} ${MONTHS_FR[day.m - 1]}`;
  return day.y === here.y ? head : `${head} ${day.y}`;
}

/** Miroir de `schoolDateLabel(millis, now, zone)` et de sa surcharge `String`. */
function tsSchoolDateLabel(millis: number, now: number, zone: string = ZONE): string {
  return `${tsRelativeDayFr(millis, now, zone)} · ${tsAbsoluteDayFr(millis, now, zone)}`;
}
function tsSchoolDateLabelIso(iso: string, now: number, zone: string = ZONE): string {
  const ms = tsAttendanceMillis(iso, zone);
  return ms === null ? "" : tsSchoolDateLabel(ms, now, zone);
}

/** Miroir de `absenceDateSpan(row, now, zone)`. */
function tsAbsenceDateSpan(row: AbsenceUi, now: number, zone: string = ZONE): string {
  const start = tsAttendanceMillis(row.date, zone);
  if (start === null) return "";
  const head = tsSchoolDateLabel(start, now, zone);
  const end = row.dateEnd === null ? null : tsAttendanceMillis(row.dateEnd, zone);
  if (end === null || end === start) return head;
  if (civil(start, zone).day === civil(end, zone).day) return head;
  return `${head} → ${tsAbsoluteDayFr(end, now, zone)}`;
}

/** Miroir de `durationLongFr(minutes)`. */
function tsDurationLongFr(minutes: number): string {
  const safe = minutes < 0 ? 0 : minutes;
  if (safe < 60) return `${safe} min`;
  const rest = safe % 60;
  return rest === 0 ? `${Math.trunc(safe / 60)} h` : `${Math.trunc(safe / 60)} h ${rest} min`;
}

const JUSTIFIED_OK = "Toutes les absences et tous les retards publiés sont justifiés.";

/** Miroir de `attendanceStatus(rows)`. */
function tsAttendanceStatus(rows: AbsenceUi[]) {
  const unjustified = rows.filter((r) => r.justified === false);
  const total = rows.reduce((sum, r) => sum + Math.max(0, r.minutes ?? 0), 0);
  const pending = unjustified.reduce((sum, r) => sum + Math.max(0, r.minutes ?? 0), 0);
  const n = unjustified.length;
  return {
    clean: unjustified.length === 0,
    eventCount: rows.length,
    totalMinutes: total,
    unjustifiedCount: n,
    unjustifiedMinutes: pending,
    title: unjustified.length === 0 ? "Aucune heure injustifiée" : "Des heures injustifiées",
    detail:
      unjustified.length === 0
        ? JUSTIFIED_OK
        : `${tsDurationLongFr(pending)} sur ${tsDurationLongFr(total)} manquées · ${n} ${n <= 1 ? "événement" : "événements"} sans justificatif`,
  };
}

/** Miroir de `absenceTitle(row)`. */
const tsAbsenceTitle = (r: AbsenceUi): string =>
  (r.motif ?? "").trim() || (r.subject ?? "").trim() || tsKindLabel(r.kind);

/** Miroir de `justifiedBadge(justified)`. */
const tsJustifiedBadge = (j: boolean | null | undefined): string =>
  j === true ? "justifiée" : j === false ? "non justifiée" : "";

type PeriodUi = { id: string; name: string; startMillis: number | null; endMillis: number | null };

/** Miroir de `attendancePeriods(periods, counts)`. */
function tsAttendancePeriods(periods: PeriodUi[], counts: PeriodCountUi[]) {
  if (periods.length === 0) {
    return counts.map((c) => ({ id: c.periodId, name: c.name, absences: c.absences, late: c.late, minutes: c.minutes, startMillis: null, endMillis: null }));
  }
  const byId = new Map(counts.map((c) => [c.periodId, c]));
  return periods.map((p) => {
    const c = byId.get(p.id);
    return {
      id: p.id, name: p.name,
      absences: c?.absences ?? 0, late: c?.late ?? 0, minutes: c?.minutes ?? 0,
      startMillis: p.startMillis, endMillis: p.endMillis,
    };
  });
}

/** Miroir de `periodNumberLabel(name)` et `gravityLabel(gravity)` — le second
 *  passe par `gradeValueLabel` (virgule française, zéros inutiles retirés). */
const tsPeriodNumberLabel = (name: string): string | null => /(\d+)/.exec(name)?.[1] ?? null;
const tsGradeValueLabel = (v: number): string => {
  const two = v.toFixed(2).replace(".", ",");
  if (two.endsWith(",00")) return two.slice(0, -3);
  return two.endsWith("0") ? two.slice(0, -1) : two;
};
const tsGravityLabel = (gravity: string | null | undefined): string | null => {
  const raw = (gravity ?? "").trim();
  if (raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return `Niveau ${tsGradeValueLabel(value)}`;
};

// --- Couleurs : AA mesuré, comme `PapillonTheme.kt` l'exige ------------------

const h2rgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
};
/** Miroir de `tint(color, p)` : `amount = |p|`, `p > 0` vers le blanc. */
function tint(rgb: [number, number, number], p: number): [number, number, number] {
  const amount = Math.min(1, Math.abs(p));
  const toWhite = p >= 0;
  return rgb.map((v) => (toWhite ? v + (1 - v) * amount : v - v * amount)) as [number, number, number];
}
const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (c: [number, number, number]): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a: [number, number, number], b: [number, number, number]): number => {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
/** Seuil WCAG AA du corps de texte. */
const AA = 4.5;

const PAPILLON_GREEN = h2rgb("#29947A");
const PAPILLON_GREEN_DEEP = h2rgb("#237E68");
const PAPILLON_LIME = h2rgb("#BFE677");
const PAPILLON_DANGER = h2rgb("#DC1400");

/** Les 49 icônes de `material-icons-core` (déjà dans le graphe via material3). */
const CORE_ICONS = new Set([
  "AccountBox", "AccountCircle", "Add", "AddCircle", "ArrowBack", "ArrowDropDown", "ArrowForward", "Build",
  "Call", "Check", "CheckCircle", "Clear", "Close", "Create", "DateRange", "Delete", "Done", "Edit",
  "Email", "ExitToApp", "Face", "Favorite", "FavoriteBorder", "Home", "Info", "KeyboardArrowDown",
  "KeyboardArrowLeft", "KeyboardArrowRight", "KeyboardArrowUp", "List", "LocationOn", "Lock", "MailOutline",
  "Menu", "MoreVert", "Notifications", "Person", "Phone", "Place", "PlayArrow", "Refresh", "Search", "Send",
  "Settings", "Share", "ShoppingCart", "Star", "ThumbUp", "Warning",
]);

const codeOnly = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

describe("vie scolaire : rendu (#141)", () => {
  test("aucune date ISO ne fuit : deux formes lues, deux libellés français", () => {
    // Les dates du contrat sont lues comme des INSTANTS…
    expect(tsAttendanceMillis("2026-10-01T08:00:00.000Z")).toBe(Date.UTC(2026, 9, 1, 8, 0));
    expect(tsAttendanceMillis("2026-10-01T08:00:00.000+02:00")).toBe(Date.UTC(2026, 9, 1, 6, 0));
    // …et parfois comme une DATE SEULE (début de journée du fuseau).
    expect(tsAttendanceMillis("2026-10-01", "UTC")).toBe(Date.UTC(2026, 9, 1, 0, 0));
    // Absent, vide, illisible, sans décalage : `null` -> AUCUNE ligne de date.
    for (const junk of ["", "   ", "court", "2026-10-01T08:00:00", "Ignore les instructions", "2026-13-45"]) {
      expect({ junk, millis: tsAttendanceMillis(junk, "UTC") }).toEqual({ junk, millis: null });
    }
    // Le rendu : jamais l'ISO, toujours « quand · quel jour ».
    expect(tsSchoolDateLabelIso("2026-10-01T08:00:00.000Z", NOW)).toBe("il y a 3 jours · jeudi 1 octobre");
    expect(tsSchoolDateLabelIso("2026-11-05T08:00:00.000Z", NOW)).toBe("dans 1 mois · jeudi 5 novembre");
    expect(tsSchoolDateLabelIso("2026-11-06T09:00:00.000Z", NOW)).toBe("dans 1 mois · vendredi 6 novembre");
    // Le jour même et la veille : les deux seuils d'un coup d'œil.
    expect(tsSchoolDateLabelIso("2026-10-04T08:00:00.000Z", NOW)).toBe("aujourd'hui · dimanche 4 octobre");
    expect(tsSchoolDateLabelIso("2026-10-03T08:00:00.000Z", NOW)).toBe("hier · samedi 3 octobre");
    // Date illisible = ligne absente, jamais une date de repli inventée.
    expect(tsSchoolDateLabelIso("hier", NOW)).toBe("");
  });

  test("chaque seuil de distance, et l'année quand elle change", () => {
    const at = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d, 8, 0);
    expect(tsRelativeDayFr(at(2026, 10, 2), NOW)).toBe("il y a 2 jours");
    expect(tsRelativeDayFr(at(2026, 10, 20), NOW)).toBe("dans 16 jours");
    expect(tsRelativeDayFr(at(2026, 10, 3), NOW)).toBe("hier");
    // 30 jours restent des jours ; 31 jours deviennent un mois : les mois ronds
    // de Papillon, comptés (année2 - année1) x 12 + (mois2 - mois1).
    expect(tsRelativeDayFr(at(2026, 9, 4), NOW)).toBe("il y a 30 jours");
    expect(tsRelativeDayFr(at(2026, 11, 4), NOW)).toBe("dans 1 mois");
    expect(tsRelativeDayFr(at(2026, 9, 3), NOW)).toBe("il y a 1 mois");
    expect(tsRelativeDayFr(at(2027, 1, 4), NOW)).toBe("dans 3 mois");
    // 12 mois et 2 ans : pluriel « ans », et l'année écrite dans le jour.
    expect(tsRelativeDayFr(at(2027, 10, 4), NOW)).toBe("dans 1 an");
    expect(tsRelativeDayFr(at(2028, 10, 4), NOW)).toBe("dans 2 ans");
    expect(tsAbsoluteDayFr(at(2027, 1, 18), NOW)).toBe("lundi 18 janvier 2027");
    expect(tsAbsoluteDayFr(at(2026, 1, 18), NOW)).toBe("dimanche 18 janvier");
    // Une année bissextile ne fait pas disparaître le 29 février.
    expect(tsAbsoluteDayFr(Date.UTC(2028, 1, 29, 8, 0), NOW)).toBe("mardi 29 février 2028");
  });

  test("étendue : `dateEnd` n'est plus jeté, mais un même jour reste une date seule", () => {
    const at = (y: number, m: number, d: number): string => new Date(Date.UTC(y, m - 1, d, 8, 0)).toISOString();
    const base: AbsenceUi = {
      id: "x", kind: "absence", date: at(2026, 10, 1), dateEnd: null,
      subject: null, motif: null, minutes: null, justified: null, periodId: "p-1",
    };
    // Absence de plusieurs jours : les deux dates, donc plus « une seule date ».
    expect(tsAbsenceDateSpan({ ...base, dateEnd: at(2026, 10, 3) }, NOW)).toBe(
      "il y a 3 jours · jeudi 1 octobre → samedi 3 octobre",
    );
    // 8 h → 12 h le MÊME jour : ce n'est pas une étendue, donc rien n'est de plus.
    expect(tsAbsenceDateSpan({ ...base, dateEnd: at(2026, 10, 1).replace("08:00", "12:00") }, NOW)).toBe(
      "il y a 3 jours · jeudi 1 octobre",
    );
    expect(tsAbsenceDateSpan({ ...base, dateEnd: base.date }, NOW)).toBe("il y a 3 jours · jeudi 1 octobre");
    // `dateEnd` illisible, ou date de début illisible : pas de date inventée.
    expect(tsAbsenceDateSpan({ ...base, dateEnd: "bientôt" }, NOW)).toBe("il y a 3 jours · jeudi 1 octobre");
    expect(tsAbsenceDateSpan({ ...base, date: "hier" }, NOW)).toBe("");
  });

  test("durée : deux écritures, compacte pour la carte, en toutes lettres pour le total", () => {
    expect(tsDurationLongFr(0)).toBe("0 min");
    expect(tsDurationLongFr(45)).toBe("45 min");
    expect(tsDurationLongFr(60)).toBe("1 h");
    expect(tsDurationLongFr(240)).toBe("4 h");
    expect(tsDurationLongFr(252)).toBe("4 h 12 min");
    expect(tsDurationLongFr(-5)).toBe("0 min");
    // Les deux écritures de l'écran, sur les memes minutes.
    expect(tsMinutesLabel(252)).toBe("4h12");
    expect(tsMinutesLabel(45)).toBe("45min");
    expect(tsMinutesLabel(240)).toBe("4h00");
  });

  test("statut : vert si tout est justifié, ambre sinon, avec le total des heures manquées", () => {
    const data = tsAttendanceFrom(JSON.stringify(syntheticAttendancePayload));
    // Le jeu complet : un retard injustifié de 10 min sur 4 h 10 manquées.
    const all = tsAttendanceStatus(data.absences);
    expect(all).toEqual({
      clean: false,
      eventCount: 4,
      totalMinutes: 250,
      unjustifiedCount: 1,
      unjustifiedMinutes: 10,
      title: "Des heures injustifiées",
      detail: "10 min sur 4 h 10 min manquées · 1 événement sans justificatif",
    });
    // Rien d'injustifié = carte verte, et le total reste affiché.
    const justified = tsAttendanceStatus(data.absences.filter((r) => r.justified === true));
    expect(justified).toEqual({
      clean: true,
      eventCount: 1,
      totalMinutes: 240,
      unjustifiedCount: 0,
      unjustifiedMinutes: 0,
      title: "Aucune heure injustifiée",
      detail: JUSTIFIED_OK,
    });
    // `justified` absent = rien n'est affirmé : la carte NE l'accuse pas.
    const unknown = tsAttendanceStatus(data.absences.filter((r) => r.justified === null));
    expect(unknown.clean).toBe(true);
    expect(unknown.title).toBe("Aucune heure injustifiée");
    // Pluriel du détail.
    const two: AbsenceUi[] = [
      { ...data.absences[0], justified: false },
      { ...data.absences[1], justified: false },
    ];
    expect(tsAttendanceStatus(two).detail).toContain("2 événements sans justificatif");
    // Une durée non publiée compte pour zéro, jamais pour 1.
    const noMinutes = tsAttendanceStatus([{ ...data.absences[0], minutes: null }]);
    expect(noMinutes.totalMinutes).toBe(0);
  });

  test("sections : absences puis retards, une seule fois, jamais de section vide", () => {
    const data = tsAttendanceFrom(JSON.stringify(syntheticAttendancePayload));
    expect(tsSections(data.absences).map((s) => [s.title, s.rows.length])).toEqual([
      ["Absence", 3],
      ["Retard", 1],
    ]);
    // Un établissement qui ne publie QUE des retards : pas de section « Absences »
    // vide au-dessus du vide.
    const lateOnly = data.absences.filter((r) => r.kind === "late");
    expect(tsSections(lateOnly).map((s) => s.title)).toEqual(["Retard"]);
    expect(tsSections([])).toEqual([]);
  });

  test("carte d'événement : le motif porte le titre, la pastille ne ment pas", () => {
    const data = tsAttendanceFrom(JSON.stringify(syntheticAttendancePayload));
    const medical = data.absences.find((r) => r.id === "abs-fake-1") as AbsenceUi;
    const late = data.absences.find((r) => r.id === "abs-fake-2") as AbsenceUi;
    const bare = data.absences.find((r) => r.id === "abs-fake-3") as AbsenceUi;
    expect(tsAbsenceTitle(medical)).toBe("Rendez-vous medical");
    expect(tsAbsenceTitle(late)).toBe("Transport");
    // Sans motif : la matière, sinon le type — jamais une ligne vide.
    expect(tsAbsenceTitle(bare)).toBe("Absence");
    expect(tsAbsenceTitle({ ...bare, subject: "Maths" })).toBe("Maths");
    // Le badge dit la vérité sur les trois états possibles.
    expect(tsJustifiedBadge(true)).toBe("justifiée");
    expect(tsJustifiedBadge(false)).toBe("non justifiée");
    expect(tsJustifiedBadge(null)).toBe("");
    // Une absence INJUSTIFIÉE est identifiable sans lire la ligne.
    const unjustified = (rows: AbsenceUi[]): number => rows.filter((r) => r.justified === false).length;
    expect(unjustified(data.absences)).toBe(1);
    expect(data.absences.filter((r) => r.justified === false).map((r) => tsJustifiedBadge(r.justified))).toEqual(["non justifiée"]);
  });

  test("tranches : la liste complète gagne sur les compteurs, jamais l'inverse", () => {
    const data = tsAttendanceFrom(JSON.stringify(syntheticAttendancePayload));
    const periods: PeriodUi[] = [
      { id: "p-1", name: "Trimestre 1", startMillis: Date.UTC(2026, 8, 1), endMillis: Date.UTC(2026, 10, 30) },
      { id: "p-2", name: "Trimestre 2", startMillis: Date.UTC(2026, 11, 6), endMillis: Date.UTC(2027, 2, 5) },
      // Trimestre sans AUCUNE absence : présent dans `/v1/periods`, absent des
      // compteurs — c'est lui que le sélecteur doit pouvoir choisir.
      { id: "p-3", name: "Trimestre 3", startMillis: null, endMillis: null },
    ];
    const merged = tsAttendancePeriods(periods, data.periods);
    expect(merged.map((p) => [p.id, p.absences, p.late, p.minutes])).toEqual([
      ["p-1", 2, 1, 250],
      ["p-2", 1, 0, 0],
      ["p-3", 0, 0, 0],
    ]);
    // Repli hors-ligne : sans `/v1/periods`, les compteurs seuls font une liste.
    expect(tsAttendancePeriods([], data.periods).map((p) => [p.id, p.name, p.startMillis])).toEqual([
      ["p-1", "Trimestre 1", null],
      ["p-2", "Trimestre 2", null],
    ]);
    // Ni l'un ni l'autre : aucune tranche, donc aucun chip fantôme.
    expect(tsAttendancePeriods([], [])).toEqual([]);
  });

  test("pastille de période et niveau de gravité : deux libellés, jamais un nombre nu", () => {
    expect(tsPeriodNumberLabel("Trimestre 1")).toBe("1");
    expect(tsPeriodNumberLabel("Semestre 2")).toBe("2");
    expect(tsPeriodNumberLabel("Année")).toBe(null);
    expect(tsPeriodNumberLabel("")).toBe(null);
    expect(tsGravityLabel("1")).toBe("Niveau 1");
    expect(tsGravityLabel("2.5")).toBe("Niveau 2,5");
    // Non publié / illisible = AUCUNE étiquette (jamais un « 0 » deviné).
    expect(tsGravityLabel(null)).toBe(null);
    expect(tsGravityLabel("")).toBe(null);
    expect(tsGravityLabel("beaucoup")).toBe(null);
  });

  test("contrastes mesurés : carte verte, carte ambre, pastilles verte et rouge", () => {
    // Vert : les deux rôles que le thème pose (primaryContainer/onPrimaryContainer).
    expect(contrast(tint(PAPILLON_GREEN, 0.94), PAPILLON_GREEN_DEEP)).toBeGreaterThanOrEqual(AA);
    // Ambre : `tertiary` (lime) fondu des deux côtés, le thème ne pose aucun rôle
    // « avertissement » et `tertiaryContainer` resterait au lavande Material.
    expect(contrast(tint(PAPILLON_LIME, 0.55), tint(PAPILLON_LIME, -0.55))).toBeGreaterThanOrEqual(AA);
    // Pastille « justifiée » / « non justifiée » : meme couple que `PapPill`.
    expect(contrast(tint(PAPILLON_GREEN, 0.75), tint(PAPILLON_GREEN, -0.45))).toBeGreaterThanOrEqual(AA);
    expect(contrast(tint(PAPILLON_DANGER, 0.75), tint(PAPILLON_DANGER, -0.45))).toBeGreaterThanOrEqual(AA);
    // Le mode sombre INVERSE le couple (fond foncé, encre claire) : `tertiary`
    // est clair, donc le laisser tel quel poserait une carte criarde sur du noir.
    expect(contrast(tint(PAPILLON_LIME, -0.55), tint(PAPILLON_LIME, 0.7))).toBeGreaterThanOrEqual(AA);
    // Le mode se LIT dans la luminance de la surface du thème : 1.0 en clair,
    // 0.006 sur la surface sombre — donc le seuil de 0.5 ne peut pas se tromper.
    expect(luminance([1, 1, 1])).toBeGreaterThan(0.5);
    expect(luminance(h2rgb("#121212"))).toBeLessThan(0.5);
    // L'encre de la carte ambre doit être lisible sur SON fond, pas sur le blanc.
    expect(contrast(tint(PAPILLON_LIME, -0.55), [1, 1, 1])).toBeGreaterThan(contrast(tint(PAPILLON_LIME, 0.55), [1, 1, 1]));
  });

  test("rendu : quatre états, une page défilable, plus aucun texte brut", () => {
    const screen = codeOnly(readFileSync(ATTENDANCE_KT, "utf8"));
    const rows = readFileSync(ROWS_KT, "utf8");
    const format = readFileSync(FORMAT_KT, "utf8");

    // 1. Les quatre états, avec le VRAI message du serveur et un horodatage.
    for (const brique of ["PapLoading()", "PapEmptyState(", "PapErrorState(", "PapStaleBanner("]) {
      expect({ brique, present: screen.includes(brique) }).toEqual({ brique, present: true });
    }
    expect(screen).toContain("PapErrorState(message = error?.message, onRetry = { refresh() })");
    expect(screen).not.toContain("Erreur réseau. Réessayer.");
    expect(screen).not.toContain("Données hors-ligne (périmé).");
    expect(screen).toContain("PapStaleBanner(fetchedAt = data.fetchedAt, onRefresh = { refresh() })");

    // 2. La page se défile (avant #141 : aucune rangée défilante, donc les
    //    événements du bas de la liste étaient inatteignables).
    expect(screen).toContain("verticalScroll(rememberScrollState())");

    // 3. Le sélecteur de période est la ligne DÉFILABLE déjà écrite par #139 —
    //    plus une `Row` de `FilterChip` locale, qui débordait.
    expect(screen).toContain("GradesPeriodChips(");
    expect(screen).not.toContain("FilterChip");

    // 4. #172 : plus AUCUN bouton de destination dans le corps. « Sanctions »
    // est une action de la barre du haut (`TOP_BAR_ACTIONS`), et la capacité
    // `punishments` (#87) reste le filtre — mais elle est appliquée là où la
    // navigation est nouée, donc dans `AppNav.kt` (`hiddenDestinations`).
    expect(screen).not.toContain("onSanctions");
    expect(screen).not.toContain("sanctionsAllowed");
    expect(screen).not.toContain('Button(onClick = onSanctions)');
    expect(screen).not.toContain('Text("Sanctions")');
    const nav = codeOnly(readFileSync(join(UI, "AppNav.kt"), "utf8"));
    expect(nav).toContain("if (!Capabilities.visible(capabilities, Capabilities.PUNISHMENTS)) add(ROUTE_SANCTIONS)");
    // #172 : la branche d'erreur de la coquille porte une ligne FIXE par écran.
    // Sans elle, cette route n'est prouvable que sur son titre — et « Réessayer »
    // (le seul libellé de `PapErrorState`) est rendu par sept écrans.
    for (const ligne of [
      'private const val ATTENDANCE_HEADING = "Absences indisponibles."',
      'private const val SANCTIONS_HEADING = "Sanctions indisponibles."',
    ]) {
      expect({ ligne, presente: screen.includes(ligne) }).toEqual({ ligne, presente: true });
    }
    expect(screen).toContain("heading = ATTENDANCE_HEADING");
    expect(screen).toContain("heading = SANCTIONS_HEADING");
    // Le titre de la liste des sanctions est rendu AVEC et SANS sanction : c'est
    // lui qui distingue cette route d'une autre quand la donnée manque.
    expect(screen).toContain('private const val SANCTIONS_LABEL = "Sanctions déclarées"');
    expect(screen).toMatch(/PapSectionHeader\([\s\S]{0,200}title = SANCTIONS_LABEL,[\s\S]{0,80}count = rows\.size,[\s\S]{0,200}if \(rows\.isEmpty\(\)\)/);

    // 5. `/v1/periods` : la liste complète des tranches, comme l'onglet Notes.
    expect(screen).toContain("repo.fetchPeriods(baseUrl)");

    // 6. Plus AUCUNE concaténation de champs, plus AUCUNE date ISO rendue.
    for (const gone of [
      'val span = if (row.dateEnd != null)',
      'Text("${absenceKindLabel(row.kind)} $span$subject$minutes$justified")',
      'Text("${p.name} : ${p.absences} absence(s)',
      'Text("Absences : ${totals.first}',
      "(gravité $it)",
      "attendanceTotals",
      'Text("Retour")',
      'subtitle = "Absences et retards"',
      // #172 : le SOUS-TITRE ne revient pas par la porte du témoin de route.
      'SANCTIONS_HEADING = "Sanctions déclarées"',
      'ATTENDANCE_HEADING = "Absences et retards"',
    ]) {
      expect({ gone, absent: !screen.includes(gone) }).toEqual({ gone, absent: true });
    }
    // 7. Les compteurs une seule fois : dans les titres de section.
    expect(rows).toContain("PapSectionHeader(");
    expect(rows).toContain("count = section.rows.size");

    // 8. L'absence injustifiée est signalée DEUX fois (pastille + durée rouge).
    expect(rows).toContain("justifiedBadge(row.justified)");
    // #146 : l'encre d'erreur du thème (`errorTextColor()`), pas le rouge brut
    // qui ne vaut que 3.70:1 sur la surface SOMBRE. La pastille rouge voisine
    // porte déjà le même signal, donc la couleur n'est jamais seule.
    expect(rows).toContain("color = if (unjustified) errorTextColor() else scheme.onSurface");

    // 9. Zéro hex en dur, zéro date ISO rendue, contenu serveur = DONNÉE.
    for (const file of [ATTENDANCE_KT, ROWS_KT, FORMAT_KT]) {
      const source = codeOnly(readFileSync(file, "utf8"));
      expect({ file, hex: /#[0-9a-fA-F]{6}/.test(source) }).toEqual({ file, hex: false });
      for (const bad of ["WebView", "fromHtml", "loadData", "AnnotatedString", ".take(10)", "take(10)"]) {
        expect({ file, bad, found: source.includes(bad) }).toEqual({ file, bad, found: false });
      }
    }

    // 10. Icônes : uniquement `material-icons-core`, déjà dans le graphe.
    for (const file of [ROWS_KT]) {
      const used = [...readFileSync(file, "utf8").matchAll(/Icons\.Filled\.(\w+)/g)].map((m) => m[1]);
      for (const name of used) expect({ name, core: CORE_ICONS.has(name) }).toEqual({ name, core: true });
    }
  });

  test("logique pure : le contrat de la sortie est écrit dans le fichier, pas dans l'écran", () => {
    const format = codeOnly(readFileSync(FORMAT_KT, "utf8"));
    const rows = codeOnly(readFileSync(ROWS_KT, "utf8"));
    const screen = codeOnly(readFileSync(ATTENDANCE_KT, "utf8"));
    // Une fonction pure par décision : chacune est nommée, donc testable, et
    // l'écran ne concatène plus rien.
    for (const pure of [
      "fun attendanceMillis(",
      "fun absoluteDayFr(",
      "fun relativeDayFr(",
      "fun schoolDateLabel(",
      "fun absenceDateSpan(",
      "fun durationLongFr(",
      "fun attendanceStatus(",
      "fun attendanceSections(",
      "fun attendancePeriods(",
      "fun absenceTitle(",
      "fun justifiedBadge(",
      "fun isUnjustified(",
      "fun periodNumberLabel(",
      "fun gravityLabel(",
      "data class AttendanceStatusUi(",
      "data class AttendanceSectionUi(",
      "data class AttendancePeriodUi(",
    ]) {
      expect({ pure, present: format.includes(pure) }).toEqual({ pure, present: true });
    }
    // Le rendu ne REDÉFINIT aucun calcul : il reçoit l'état et l'affiche.
    expect(screen).toContain("attendanceStatus(rows)");
    expect(screen).toContain("attendanceSections(rows)");
    expect(screen).toContain("attendancePeriods(periods, data.periods)");
    expect(rows).not.toContain("fun attendanceStatus");
    expect(rows).not.toContain("fun relativeDayFr");
    expect(rows).not.toContain("ChronoUnit");
    expect(rows).not.toContain("Calendar");
  });
});
