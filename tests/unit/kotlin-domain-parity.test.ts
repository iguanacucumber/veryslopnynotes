// Parité TS <-> Kotlin du domaine pur (#202, #203).
//
// Les tests `android-*.test.ts` (miroirs Bun sur le source Kotlin) ne VOIENT pas
// les régressions de comportement : ils réécrivent la logique au lieu de
// l'exécuter. Ce fichier est le filet DIFFERENTIEL : les mêmes fixtures
// alimentent la référence TS (`server/domain/`) ET le port Kotlin
// (`android/core/`, compilé pour de vrai par `kotlinc` et piloté en JSON), et
// les sorties sont comparées canoniquement (clés triées, nombres au format JS).
// Toute divergence protocole = échec explicite (domaine + champ + valeurs).
//
// Chaîne requise : `kotlinc` + `java`. Absente = SKIP BRUYANT (jamais un faux
// vert) : la parité n'est alors PAS vérifiée sur cette machine — `make
// android-compile` dit la même chose pour la compilation. En revanche un ÉCHEC
// DE COMPILATION du port est un défaut : le test échoue (le code commité doit
// compiler ; `make android-compile` le redira aussi).
//
// Le binaire est mis en cache dans `node_modules/.cache` (clé = sha256 des 4
// sources) : ~6 s la première fois, ~0,3 s ensuite.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeAverages,
  providedAveragesFor,
} from "../../server/domain/averages";
import { attendancePeriods } from "../../server/domain/attendance";
import {
  capabilitiesFromProbe,
  disabledTabs,
  hasCapability,
} from "../../server/domain/capabilities";
import type { Grade } from "../../shared/contracts/models";
import type { AbsenceRecord, Period } from "../../shared/contracts/models";

const ROOT = join(import.meta.dir, "..", "..");
const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const PARITY = join(ROOT, "agents", "runtime", "kotlin-parity");
const SOURCES = ["Averages.kt", "Attendance.kt", "Capabilities.kt", "CapabilityProbe.kt"].map((f) => join(CORE, f));
// Doublure `org.json` (SDK Android) : signatures seules, test-only, jamais
// exécutée — voir l'en-tête du fichier.
const STUB = join(PARITY, "org", "json", "JsonStub.kt");
const DRIVER = join(PARITY, "ParityMain.kt");

// --- Chaîne Kotlin --------------------------------------------------------

const KOTLINC = Bun.which("kotlinc");
const JAVA = Bun.which("java");

let SKIP_REASON: string | null = null;
if (!KOTLINC) SKIP_REASON = "`kotlinc` absent : installez le compilateur Kotlin (ou lancez `make android-compile` pour le diagnostic).";
else if (!JAVA) SKIP_REASON = "`java` absent : la parité a besoin d'une JVM pour exécuter le port compilé.";

if (SKIP_REASON) {
  console.warn(
    "\n" +
      "  SKIP BRUYANT — parité TS <-> Kotlin non vérifiée (#202/#203).\n" +
      `  ${SKIP_REASON}\n` +
      "  `make check` reste vert, mais il n'a PAS prouvé que le port calcule comme la référence.\n",
  );
}

function sourceHash(): string {
  const h = createHash("sha256");
  for (const f of [...SOURCES, STUB, DRIVER]) h.update(readFileSync(f));
  return h.digest("hex").slice(0, 16);
}

async function ensureJar(): Promise<string> {
  const dir = join(ROOT, "node_modules", ".cache", "kotlin-domain-parity", sourceHash());
  const jar = join(dir, "parity.jar");
  if (existsSync(jar)) return jar;
  mkdirSync(dir, { recursive: true });
  const compiled = Bun.spawnSync({
    cmd: [KOTLINC as string, ...SOURCES, STUB, DRIVER, "-include-runtime", "-d", jar],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (compiled.exitCode !== 0) {
    throw new Error(
      `le port Kotlin ne compile pas (défaut, pas un skip) :\n${compiled.stderr}\n${compiled.stdout}`,
    );
  }
  return jar;
}

// --- Protocole ligne à ligne -----------------------------------------------

interface ParityLink {
  ask(op: unknown): Promise<string>;
}

async function openLink(jar: string): Promise<ParityLink & { close(): void }> {
  const proc = Bun.spawn([JAVA as string, "-Dfile.encoding=UTF-8", "-jar", jar], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const sink = proc.stdin;
  const reader = proc.stdout.getReader();
  let pending = "";
  const decoder = new TextDecoder("utf-8");
  async function readLine(): Promise<string> {
    for (;;) {
      const nl = pending.indexOf("\n");
      if (nl >= 0) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        return line;
      }
      const { done, value } = await reader.read();
      if (done) throw new Error("le pilote Kotlin a fermé stdout au milieu d'une opération");
      pending += decoder.decode(value, { stream: true });
    }
  }
  // Drain stderr : une erreur pilote y est expliquée (jamais un résultat vide).
  const errors: string[] = [];
  (async () => {
    const errReader = proc.stderr.getReader();
    let buf = "";
    for (;;) {
      const { done, value } = await errReader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) errors.push(l.trim());
    }
  })();
  return {
    async ask(op: unknown): Promise<string> {
      sink.write(`${JSON.stringify(op)}\n`);
      await sink.flush();
      const line = await Promise.race([
        readLine(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pilote Kotlin sans réponse (30 s)")), 30000)),
      ]);
      if (line.startsWith('{"error":')) {
        throw new Error(`erreur pilote (entrée malformée ?) : ${line} — stderr: ${errors.join(" | ")}`);
      }
      return line;
    },
    close() {
      proc.kill();
    },
  };
}

let link: (ParityLink & { close(): void }) | null = null;
if (!SKIP_REASON) {
  const jar = await ensureJar();
  link = await openLink(jar);
  afterAll(() => link?.close());
}

// --- Canonique TS ------------------------------------------------------------

/** Même forme que le pilote : clés triées, `undefined` = clé omise. */
function canonTs(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonTs).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonTs(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function parityOf(op: unknown, tsValue: unknown): Promise<void> {
  const kt = await link!.ask(op);
  const ts = canonTs(tsValue);
  expect(`${kt}\n${ts}`).toBe(`${ts}\n${ts}`);
}

// --- Fixtures (mapper-shaped : clés omises, jamais `null` explicite) ---------

const ACC = "acc-fake-1";

const grade = (over: Partial<Grade> & Pick<Grade, "id" | "subject" | "value" | "scale">): Grade => ({
  accountId: ACC,
  date: "2026-09-20T10:00:00.000Z",
  coefficient: 1,
  ...over,
});

/** Référence Papillon : bonus, facultative, coef, /10 ramené, contexte classe. */
const GRADES: Grade[] = [
  grade({ id: "m1", subject: "Maths", value: 15, scale: 20, date: "2026-09-01T10:00:00.000Z" }),
  grade({ id: "m2", subject: "Maths", value: 10, scale: 20, date: "2026-09-10T10:00:00.000Z" }),
  grade({ id: "a1", subject: "Anglais", value: 12, scale: 20, coefficient: 2, date: "2026-09-05T10:00:00.000Z" }),
  grade({ id: "f1", subject: "EPS", value: 18, scale: 20, optional: true, date: "2026-09-12T10:00:00.000Z" }),
  grade({ id: "s1", subject: "SVT", value: 7, scale: 10, date: "2026-09-15T10:00:00.000Z" }),
  grade({ id: "b1", subject: "Arts", value: 20, scale: 20, bonus: true, date: "2026-09-20T10:00:00.000Z" }),
];

const skip = SKIP_REASON !== null;

describe("parité TS <-> Kotlin du domaine pur (#202/#203)", () => {
  test.skipIf(skip)("pilote : l'écho valide le parseur JSON sur des données réelles", async () => {
    await parityOf({ op: "echo", value: GRADES }, GRADES);
    await parityOf(
      { op: "echo", value: { accents: "Économie — Français « EPS »", fini: true, nul: null, liste: [1, "deux", null] } },
      { accents: "Économie — Français « EPS »", fini: true, nul: null, liste: [1, "deux", null] },
    );
  });

  test.skipIf(skip)("pilote : les nombres sont rendus à la JSON.stringify, même aux extrêmes", async () => {
    const values = [
      0, 1, -0, 20, 0.5, 15.135135135135137, 0.1 + 0.2, 2.675, -2.675, 1.005,
      0.0001, 0.000001, 0.0000001, 1.5e-7, 1e21, 123456789, 1e300, -1e300,
    ];
    for (const value of values) {
      await parityOf({ op: "num", value }, value);
    }
  });

  test.skipIf(skip)("moyennes : rapport complet sur la référence Papillon, 3 algorithmes", async () => {
    for (const algorithm of ["subject", "weighted", "median"]) {
      await parityOf(
        { op: "averages", grades: GRADES, options: { algorithm } },
        computeAverages(GRADES, { algorithm: algorithm as "subject" | "weighted" | "median" }),
      );
    }
  });

  test.skipIf(skip)("moyennes : fournies prioritaires, sinon estimation (périmètre strict)", async () => {
    const provided = {
      periodId: "p-1",
      general: 13.5,
      subjects: { maths: 12, anglais: 15 },
    };
    const grades = [
      grade({ id: "m1", subject: "Maths", value: 8, scale: 20, periodId: "p-1" }),
      grade({ id: "a1", subject: "Anglais", value: 9, scale: 20, periodId: "p-1" }),
      grade({ id: "m2", subject: "Maths", value: 4, scale: 20, periodId: "p-2" }),
    ];
    // Périmètre fourni == périmètre demandé : les fournies gagnent.
    await parityOf(
      { op: "averages", grades, options: { periodId: "p-1", provided } },
      computeAverages(grades, { periodId: "p-1", provided }),
    );
    // Périmètre différent : une moyenne d'année ne vaut pas pour un trimestre.
    await parityOf(
      { op: "averages", grades, options: { periodId: "p-2", provided } },
      computeAverages(grades, { periodId: "p-2", provided }),
    );
    // Sans filtre : les notes des deux périodes se poolent, les fournies p-1 ne s'appliquent pas.
    await parityOf(
      { op: "averages", grades, options: { provided } },
      computeAverages(grades, { provided }),
    );
  });

  test.skipIf(skip)("moyennes : notes inexploitables (coef 0/négatif, NaN, barème 0, liste vide)", async () => {
    const grades = [
      grade({ id: "z1", subject: "Maths", value: 2, scale: 20, coefficient: 0 }),
      grade({ id: "z2", subject: "Maths", value: 20, scale: 20, coefficient: -1 }),
      grade({ id: "z3", subject: "Maths", value: Number.NaN, scale: 20 }),
      grade({ id: "z4", subject: "Maths", value: -3, scale: 20 }),
      grade({ id: "z5", subject: "Maths", value: 10, scale: 0 }),
      grade({ id: "z6", subject: "Maths", value: 18, scale: 20, bonus: true }),
    ];
    await parityOf({ op: "averages", grades, options: {} }, computeAverages(grades));
    await parityOf({ op: "averages", grades: [], options: {} }, computeAverages([]));
    // `coefficient: null` (toléré à l'exécution) = note ignorée des deux côtés.
    const nulled = [grade({ id: "n1", subject: "Maths", value: 3, scale: 20, coefficient: null as unknown as number })];
    await parityOf({ op: "averages", grades: nulled, options: {} }, computeAverages(nulled));
  });

  test.skipIf(skip)("moyennes : arrondi des impacts, moitié au loin de zéro (égalité exacte -0.125)", async () => {
    const grades = [
      grade({ id: "t1", subject: "Maths", value: 10.5, scale: 20, date: "2026-09-01T10:00:00.000Z" }),
      grade({ id: "t2", subject: "Maths", value: 10.75, scale: 20, date: "2026-09-02T10:00:00.000Z" }),
    ];
    // Moyenne 10.625, sans t1 -> 10.75 : impact -0.125 pile, toFixed -> "-0.13".
    const report = computeAverages(grades);
    expect(report.influences.find((i) => i.gradeId === "t1")?.impact).toBe(-0.13);
    await parityOf({ op: "averages", grades, options: {} }, report);
  });

  test.skipIf(skip)("moyennes : accents (regroupement insensible) et tri collationné FR", async () => {
    const grades = [
      grade({ id: "e1", subject: "Économie", value: 14, scale: 20 }),
      grade({ id: "e2", subject: "economie", value: 10, scale: 20 }),
      grade({ id: "f1", subject: "Français", value: 12, scale: 20 }),
      grade({ id: "f2", subject: "FRANCAIS ", value: 16, scale: 20 }),
      grade({ id: "m1", subject: "Maths", value: 8, scale: 20 }),
    ];
    const report = computeAverages(grades);
    expect(report.subjects.map((s) => s.subject)).toEqual(["Économie", "Français", "Maths"]);
    await parityOf({ op: "averages", grades, options: {} }, report);
  });

  test.skipIf(skip)("moyennes : fuseaux horaires et date seule, ordre chronologique réel", async () => {
    const grades = [
      grade({ id: "o1", subject: "Maths", value: 10, scale: 20, date: "2026-09-02T00:30:00.000+02:00" }),
      grade({ id: "o2", subject: "Maths", value: 14, scale: 20, date: "2026-09-01T23:30:00.000Z" }),
      grade({ id: "o3", subject: "Maths", value: 12, scale: 20, date: "2026-09-01" }),
    ];
    // o3 (minuit UTC) < o1 (22:30 UTC le 01/09) < o2 (23:30 UTC) : l'ordre des
    // points d'historique prouve que les fuseaux sont vraiment interprétés.
    const report = computeAverages(grades);
    expect(report.history.map((h) => h.date)).toEqual(["2026-09-01", "2026-09-02T00:30:00.000+02:00", "2026-09-01T23:30:00.000Z"]);
    await parityOf({ op: "averages", grades, options: {} }, report);
  });

  test.skipIf(skip)("moyennes : 205 notes (fenêtre des 200 dernières, historique exact)", async () => {
    const subjects = ["Maths", "Anglais", "SVT"];
    const grades: Grade[] = [];
    for (let i = 0; i < 205; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      grades.push(
        grade({
          id: `v${i}`,
          subject: subjects[i % 3] as string,
          value: (i * 7) % 21,
          scale: 20,
          date: `2026-09-${day}T08:${String(i % 60).padStart(2, "0")}:00.000Z`,
          ...(i % 17 === 0 ? { coefficient: 0 } : {}),
        }),
      );
    }
    const report = computeAverages(grades);
    expect(report.history).toHaveLength(200);
    expect(report.influences).toHaveLength(200);
    expect(report.history[199]?.value).toBe(report.general.value);
    await parityOf({ op: "averages", grades, options: {} }, report);
  });

  test.skipIf(skip)("providedAveragesFor : périmètre exact, et `__proto__` ne résout jamais", async () => {
    const byPeriod = {
      "p-1": { periodId: "p-1", general: 12, subjects: {} },
      __proto__: { periodId: "__proto__", general: 20, subjects: {} },
    };
    await parityOf(
      { op: "providedFor", byPeriod, periodId: "p-1" },
      providedAveragesFor(byPeriod as never, "p-1"),
    );
    await parityOf(
      { op: "providedFor", byPeriod, periodId: "absente" },
      providedAveragesFor(byPeriod as never, "absente"),
    );
  });

  test.skipIf(skip)("vie scolaire : compteurs par période, minutes, invalides écartés", async () => {
    const rec = (over: Partial<AbsenceRecord> & Pick<AbsenceRecord, "id" | "kind" | "date">): AbsenceRecord => ({
      accountId: ACC,
      ...over,
    });
    const records: AbsenceRecord[] = [
      rec({ id: "a1", kind: "absence", date: "2026-09-01T08:00:00.000Z", periodId: "p-1", durationMinutes: 120 }),
      rec({ id: "a2", kind: "absence", date: "2026-09-02T08:00:00.000Z", periodId: "p-1" }),
      rec({ id: "l1", kind: "late", date: "2026-09-03T08:00:00.000Z", periodId: "p-1", durationMinutes: 15.5 }),
      rec({ id: "a3", kind: "absence", date: "2026-09-04T08:00:00.000Z", periodId: "p-2", durationMinutes: 60 }),
      // Invalides : écartés des compteurs des deux côtés (jamais inventés).
      rec({ id: "x1", kind: "exclusion" as unknown as "absence", date: "2026-09-05T08:00:00.000Z", periodId: "p-1" }),
      rec({ id: "x2", kind: "absence", date: "2026-09-06T08:00:00.000Z", dateEnd: "2026-09-05T08:00:00.000Z", periodId: "p-1" }),
      rec({ id: "", kind: "absence", date: "2026-09-07T08:00:00.000Z", periodId: "p-1" }),
      rec({ id: "x4", kind: "absence", date: "2026-09-08T08:00:00.000Z", periodId: "p-1", durationMinutes: -5 }),
      rec({ id: "x5", kind: "absence", date: "n importe quoi", periodId: "p-1" }),
      rec({ id: "x6", kind: "absence", date: "2026-09-09T08:00:00.000Z" }),
    ];
    const periods: Period[] = [
      { id: "p-1", name: "Trimestre 1", start: "2026-09-01T00:00:00.000Z", end: "2026-12-20T00:00:00.000Z" },
      { id: "p-2", name: "Trimestre 2", start: "2027-01-05T00:00:00.000Z", end: "2027-03-28T00:00:00.000Z" },
    ];
    await parityOf({ op: "attendance", records, periods }, attendancePeriods(records, periods));
    await parityOf({ op: "attendance", records: [], periods: [] }, attendancePeriods([], []));
  });

  test.skipIf(skip)("capacités : sonde, masquage, et `null` = rien d'affirmé", async () => {
    const at = "2026-10-05T00:00:00.000Z";
    const probe = { grades: true, homework: true, news: false, menus: true };
    await parityOf(
      { op: "probe", accountId: ACC, probe, at },
      capabilitiesFromProbe(ACC, probe, at),
    );
    // Vide = aucun onglet actif ; inconnu ignoré ; compte/date invalides = rien d'affirmé.
    await parityOf({ op: "probe", accountId: ACC, probe: {}, at }, capabilitiesFromProbe(ACC, {}, at));
    await parityOf(
      { op: "probe", accountId: ACC, probe: { grades: true, inconnu: true }, at },
      capabilitiesFromProbe(ACC, { grades: true, inconnu: true } as never, at),
    );
    await parityOf({ op: "probe", accountId: "  ", probe, at }, capabilitiesFromProbe("  ", probe, at));
    await parityOf({ op: "probe", accountId: ACC, probe, at: "pas une date" }, capabilitiesFromProbe(ACC, probe, "pas une date"));
    const caps = capabilitiesFromProbe(ACC, probe, at);
    await parityOf({ op: "disabled", caps }, disabledTabs(caps));
    await parityOf({ op: "disabled", caps: null }, disabledTabs(null));
    await parityOf({ op: "enabled", caps, tab: "menus" }, hasCapability(caps, "menus"));
    await parityOf({ op: "enabled", caps, tab: "news" }, hasCapability(caps, "news"));
    await parityOf({ op: "enabled", caps: null, tab: "menus" }, hasCapability(null, "menus"));
  });
});
