// coverage.ts — rapports et seuils de couverture (#895).
//
// DEUX mesures, UNE seule exécution des tests :
// - Bun (`bun test --coverage`) : lignes de `server/`, `shared/`, `web/` et
//   `agents/` touchées par `tests/unit`, `tests/web` et `tests/contracts` ;
// - Kotlin (agent JaCoCo) : lignes du PORT DE PARITÉ réellement exécutées par
//   les pilotes. Les modules Android n'ont pas de `test/` Gradle : le code
//   Kotlin exécuté en CI est celui de la parité, instrumenté ici.
//
// Le seuil n'est pas une aspiration : `coverage-baseline.json` porte la
// MESURE, et le seuil vaut `plancher(mesure - marge)` (marge documentée dans
// BUILD.md). Une baisse passe donc par un diff explicite du fichier de base,
// jamais par un seuil « qui suit » la régression.
//
// JaCoCo est épinglé (version + sha256) : deux runs rejouent les mêmes jars.
// Reports : `coverage/bun/lcov.info`, `coverage/kotlin/html/` et
// `coverage/kotlin/jacoco.xml`.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const COVERAGE_DIR = join(ROOT, "coverage");
const BASELINE = join(ROOT, "coverage-baseline.json");

export const JACOCO_VERSION = "0.8.13";
export const JACOCO_AGENT_SHA256 =
  "47e700ccb0fdb9e27c5241353f8161938f4e53c3561dd35e063c5fe88dc3349b";
export const JACOCO_CLI_SHA256 =
  "8f748683833d4dc4d72cea5d6b43f49344687b831e0582c97bcb9b984e3de0a3";

const JACOCO_CACHE = join(ROOT, "node_modules", ".cache", "jacoco", JACOCO_VERSION);
const AGENT_JAR = join(JACOCO_CACHE, "agent.jar");
const CLI_JAR = join(JACOCO_CACHE, "cli.jar");
const MAVEN = "https://repo1.maven.org/maven2/org/jacoco";

/** Sources Kotlin du port de parité : les seules que JaCoCo peut rattacher. */
const KOTLIN_SOURCE_ROOTS = [
  join(ROOT, "android", "core", "src", "main", "java"),
  join(ROOT, "android", "data", "src", "main", "java"),
  join(ROOT, "android", "pronote", "src", "main", "java"),
];

interface Baseline {
  headroomPoints: number;
  bun: { lines: number };
  kotlin: { lines: number };
}

export interface Verdict {
  name: string;
  baseline: number;
  headroom: number;
  threshold: number;
  measured: number;
  ok: boolean;
}

/** Seuil = plancher à 0,1 point de `mesure - marge`, jamais négatif. */
export function thresholdFor(baseline: number, headroom: number): number {
  return Math.max(0, Math.floor((baseline - headroom) * 10) / 10);
}

export function verdict(name: "bun" | "kotlin", measured: number, baseline: Baseline): Verdict {
  const base = baseline[name].lines;
  const threshold = thresholdFor(base, baseline.headroomPoints);
  return {
    name,
    baseline: base,
    headroom: baseline.headroomPoints,
    threshold,
    measured,
    ok: measured >= threshold,
  };
}

/** Lignes couvertes / lignes trouvées, en pourcentage. `null` = rien mesuré. */
export function lineCoverageFromLcov(lcov: string): number | null {
  let found = 0;
  let hit = 0;
  for (const line of lcov.split("\n")) {
    const lf = /^LF:(\d+)$/.exec(line);
    if (lf) found += Number(lf[1]);
    const lh = /^LH:(\d+)$/.exec(line);
    if (lh) hit += Number(lh[1]);
  }
  return found > 0 ? (hit / found) * 100 : null;
}

/** Compteur `LINE` RACINE du rapport JaCoCo XML (le dernier est le total). */
export function lineCoverageFromJacocoXml(xml: string): number | null {
  const counters = [...xml.matchAll(/<counter type="LINE" missed="(\d+)" covered="(\d+)"\/>/g)];
  const last = counters.at(-1);
  if (!last) return null;
  const missed = Number(last[1]);
  const covered = Number(last[2]);
  const total = missed + covered;
  return total > 0 ? (covered / total) * 100 : null;
}

function readBaseline(): Baseline {
  const raw = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
  for (const key of ["bun", "kotlin"] as const) {
    const value = raw[key]?.lines;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`${BASELINE} : ${key}.lines doit être un pourcentage mesuré (0-100)`);
    }
  }
  if (
    typeof raw.headroomPoints !== "number" ||
    !Number.isFinite(raw.headroomPoints) ||
    raw.headroomPoints < 0 ||
    raw.headroomPoints > 10
  ) {
    throw new Error(`${BASELINE} : headroomPoints doit être une marge de 0 à 10 points`);
  }
  return raw;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function download(url: string, dest: string, expected: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`téléchargement JaCoCo refusé (${response.status}) : ${url}`);
  writeFileSync(dest, new Uint8Array(await response.arrayBuffer()));
  const actual = sha256(dest);
  if (actual !== expected) {
    rmSync(dest, { force: true });
    throw new Error(`empreinte JaCoCo INVALIDE pour ${dest} : ${actual} ≠ ${expected}`);
  }
  chmodSync(dest, 0o644);
}

async function prepare(): Promise<void> {
  mkdirSync(JACOCO_CACHE, { recursive: true });
  const jars = [
    {
      path: AGENT_JAR,
      url: `${MAVEN}/org.jacoco.agent/${JACOCO_VERSION}/org.jacoco.agent-${JACOCO_VERSION}-runtime.jar`,
      sha: JACOCO_AGENT_SHA256,
    },
    {
      path: CLI_JAR,
      url: `${MAVEN}/org.jacoco.cli/${JACOCO_VERSION}/org.jacoco.cli-${JACOCO_VERSION}-nodeps.jar`,
      sha: JACOCO_CLI_SHA256,
    },
  ];
  for (const jar of jars) {
    if (existsSync(jar.path) && sha256(jar.path) === jar.sha) continue;
    rmSync(jar.path, { force: true });
    await download(jar.url, jar.path, jar.sha);
  }
  console.log(`coverage : JaCoCo ${JACOCO_VERSION} prêt (${JACOCO_CACHE})`);
}

function agent(): string {
  if (!existsSync(AGENT_JAR)) throw new Error(`agent JaCoCo absent : lancez « bun run agents/runtime/coverage.ts prepare »`);
  return AGENT_JAR;
}

function run(cmd: string[], label: string): string {
  const p = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const out = `${p.stdout.toString()}${p.stderr.toString()}`;
  if (p.exitCode !== 0) throw new Error(`${label} a échoué (${p.exitCode}) :\n${out}`);
  return out;
}

/** Dernier `port.jar` du harnais : le run de couverture vient de le compiler. */
function newestPortJar(dir: string): string | null {
  let newest: { path: string; mtime: number } | null = null;
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = newestPortJar(path);
      if (found) {
        const mtime = statSync(found).mtimeMs;
        if (!newest || mtime > newest.mtime) newest = { path: found, mtime };
      }
    } else if (entry.name === "port.jar") {
      const mtime = statSync(path).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { path, mtime };
    }
  }
  return newest?.path ?? null;
}

function report(): void {
  if (!existsSync(CLI_JAR)) throw new Error("CLI JaCoCo absente : lancez « bun run agents/runtime/coverage.ts prepare »");
  const raw = process.env["JACOCO_DIR"] ?? join(COVERAGE_DIR, "jacoco-raw");
  const execFiles = existsSync(raw)
    ? readdirSync(raw)
        .filter((name) => name.endsWith(".exec"))
        .map((name) => join(raw, name))
    : [];
  if (execFiles.length === 0) {
    throw new Error(
      `aucune donnée JaCoCo dans ${raw} : la parité Kotlin n'a pas tourné (outillage absent ?). ` +
        "Un rapport vide n'est pas une mesure : échec.",
    );
  }
  const port = newestPortJar(join(ROOT, "node_modules", ".cache", "kotlin-parity"));
  if (!port) {
    throw new Error("port.jar introuvable : la parité n'a pas compilé le port, aucun rapport Kotlin possible.");
  }

  const kotlinDir = join(COVERAGE_DIR, "kotlin");
  const classes = join(kotlinDir, "classes");
  rmSync(kotlinDir, { recursive: true, force: true });
  mkdirSync(classes, { recursive: true });
  // `port.jar` embarque la runtime Kotlin (`-include-runtime`) : JaCoCo refuse
  // deux fois la même classe. On n'extrait que le paquet du produit.
  run(["unzip", "-q", port, "fr/*", "-d", classes], "extraction des classes Kotlin");

  const merged = join(kotlinDir, "merged.exec");
  run(["java", "-jar", CLI_JAR, "merge", ...execFiles, "--destfile", merged], "fusion JaCoCo");
  run(
    [
      "java",
      "-jar",
      CLI_JAR,
      "report",
      merged,
      "--classfiles",
      classes,
      ...KOTLIN_SOURCE_ROOTS.flatMap((root) => ["--sourcefiles", root]),
      "--html",
      join(kotlinDir, "html"),
      "--xml",
      join(kotlinDir, "jacoco.xml"),
      "--csv",
      join(kotlinDir, "jacoco.csv"),
    ],
    "rapport JaCoCo",
  );
  console.log(`coverage : rapport Kotlin — ${join(kotlinDir, "html")}`);
}

function check(): void {
  const baseline = readBaseline();
  const lcov = join(COVERAGE_DIR, "bun", "lcov.info");
  const xml = join(COVERAGE_DIR, "kotlin", "jacoco.xml");
  if (!existsSync(lcov)) throw new Error(`couverture Bun absente : ${lcov}`);
  if (!existsSync(xml)) throw new Error(`couverture Kotlin absente : ${xml}`);

  const bun = lineCoverageFromLcov(readFileSync(lcov, "utf8"));
  const kotlin = lineCoverageFromJacocoXml(readFileSync(xml, "utf8"));
  if (bun === null) throw new Error("lcov Bun sans lignes mesurées (LF/LH) : mesure invalide");
  if (kotlin === null) throw new Error("rapport JaCoCo sans compteur LINE : mesure invalide");

  const verdicts = [verdict("bun", bun, baseline), verdict("kotlin", kotlin, baseline)];
  const lines = verdicts.map(
    (v) =>
      `${v.ok ? "✔" : "✘"} ${v.name.padEnd(6, " ")} ${v.measured.toFixed(2)} % ` +
      `(seuil ${v.threshold.toFixed(1)} %, base ${v.baseline.toFixed(2)} %, marge ${v.headroom.toFixed(1)} pts)`,
  );
  for (const line of lines) console.log(`coverage : ${line}`);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) {
    writeFileSync(
      summary,
      `### Couverture\n\n${lines.map((line) => `- ${line}`).join("\n")}\n`,
      { flag: "a" },
    );
  }
  const failed = verdicts.filter((v) => !v.ok);
  if (failed.length > 0) {
    throw new Error(
      `couverture SOUS LE SEUIL : ${failed.map((v) => `${v.name} ${v.measured.toFixed(2)} % < ${v.threshold.toFixed(1)} %`).join(", ")} — ` +
        "ajouter des tests, ou assumer la baisse en modifiant coverage-baseline.json dans la PR.",
    );
  }
}

const COMMANDS = { prepare, agent, report, check } as const;

async function main(): Promise<void> {
  const command = process.argv[2] as keyof typeof COMMANDS | undefined;
  if (!command || !(command in COMMANDS)) {
    console.error("coverage : usage — prepare | agent | report | check");
    process.exitCode = 2;
    return;
  }
  try {
    const result = await COMMANDS[command]();
    if (typeof result === "string") console.log(result);
  } catch (error) {
    console.error(`coverage : ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
