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

// Miroir des helpers Kotlin (Attendance.kt + CachePolicy/SyncedRepository/
// ServerConfig) — doivent rester en sync. org.json = SDK Android, aucune
// dépendance ajoutée (le build Gradle n'est pas exécuté par make check).

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

function tsTotals(rows: AbsenceUi[]): [number, number] {
  return [rows.filter((r) => r.kind === "absence").length, rows.filter((r) => r.kind === "late").length];
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
    expect(tsTotals(tsAbsencesForPeriod(data, "p-1"))).toEqual([2, 1]);
    expect(tsTotals(tsAbsencesForPeriod(data, null))).toEqual([3, 1]);
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
      const totals = tsTotals(rows);
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
    expect(readFileSync(join(UI, "ProfileScreen.kt"), "utf8")).toContain(
      'Button(onClick = { goAttendance() }) { Text("Vie scolaire") }',
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