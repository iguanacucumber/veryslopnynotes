// Budget de taille de l'APK release (#974) : le plafond est versionné, la
// mesure vient de l'artefact CI. Un dépassement échoue ; la taille et le
// verdict restent dans le résumé et un artefact pour suivre la release.
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SCHEMA_VERSION = 1;
export const BASELINE_PATH = join(import.meta.dir, "..", "..", "apk-size-baseline.json");

export interface ApkSizeBaseline {
  schema: 1;
  unit: "bytes";
  apk: string;
  measuredAt: string;
  measuredOn: string;
  measuredBytes: number;
  budgetBytes: number;
}

export interface ApkSizeVerdict {
  sizeBytes: number;
  budgetBytes: number;
  headroomBytes: number;
  ok: boolean;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} invalide : entier > 0 attendu`);
  }
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} invalide : chaîne non vide attendue`);
  }
  return value;
}

/** Lit et valide la baseline : une unité fausse ou un plafond sous la mesure est refusé. */
export function parseBaseline(raw: string, source = BASELINE_PATH): ApkSizeBaseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source} : JSON invalide`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${source} : objet JSON attendu`);
  }
  const record = parsed as Record<string, unknown>;
  if (record["schema"] !== SCHEMA_VERSION) {
    throw new Error(`${source} : schéma ${String(record["schema"])} refusé (attendu ${SCHEMA_VERSION})`);
  }
  if (record["unit"] !== "bytes") {
    throw new Error(`${source} : unité « ${String(record["unit"])} » refusée (attendu « bytes »)`);
  }
  const measuredAt = nonEmptyString(record["measuredAt"], `${source} : measuredAt`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredAt)) {
    throw new Error(`${source} : measuredAt doit être AAAA-MM-JJ`);
  }
  const measuredBytes = positiveInteger(record["measuredBytes"], `${source} : measuredBytes`);
  const budgetBytes = positiveInteger(record["budgetBytes"], `${source} : budgetBytes`);
  if (budgetBytes < measuredBytes) {
    throw new Error(
      `${source} : budgetBytes ${budgetBytes} < measuredBytes ${measuredBytes} — plafond incohérent`,
    );
  }
  return {
    schema: SCHEMA_VERSION,
    unit: "bytes",
    apk: nonEmptyString(record["apk"], `${source} : apk`),
    measuredAt,
    measuredOn: nonEmptyString(record["measuredOn"], `${source} : measuredOn`),
    measuredBytes,
    budgetBytes,
  };
}

export function readBaseline(path = BASELINE_PATH): ApkSizeBaseline {
  return parseBaseline(readFileSync(path, "utf8"), path);
}

/** Compare une taille mesurée au plafond ; égalité = encore dans le budget. */
export function checkApkSize(sizeBytes: number, budgetBytes: number): ApkSizeVerdict {
  positiveInteger(sizeBytes, "taille APK");
  positiveInteger(budgetBytes, "plafond APK");
  return {
    sizeBytes,
    budgetBytes,
    headroomBytes: budgetBytes - sizeBytes,
    ok: sizeBytes <= budgetBytes,
  };
}

function octets(bytes: number): string {
  return `${bytes} o (${(bytes / (1024 * 1024)).toFixed(2)} Mio)`;
}

function ecart(verdict: ApkSizeVerdict): string {
  return verdict.ok
    ? `${verdict.headroomBytes} o sous le plafond`
    : `${-verdict.headroomBytes} o AU-DESSUS du plafond`;
}

export function summaryMarkdown(verdict: ApkSizeVerdict): string {
  return [
    "### Budget de taille APK (#974)",
    "",
    `- APK : ${octets(verdict.sizeBytes)}`,
    `- Plafond : ${octets(verdict.budgetBytes)}`,
    `- Écart : ${ecart(verdict)}`,
    `- Verdict : ${verdict.ok ? "✔ sous le plafond" : "✘ régression de taille"}`,
    "",
  ].join("\n");
}

interface Options {
  apk?: string;
  size?: number;
  baseline: string;
  record?: string;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { baseline: BASELINE_PATH };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]!;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`valeur manquante pour ${flag}`);
    }
    index++;
    switch (flag) {
      case "--apk":
        options.apk = value;
        break;
      case "--size":
        options.size = positiveInteger(Number(value), "--size");
        break;
      case "--baseline":
        options.baseline = value;
        break;
      case "--record":
        options.record = value;
        break;
      default:
        throw new Error(`argument inconnu « ${flag} »`);
    }
  }
  if ((options.apk === undefined) === (options.size === undefined)) {
    throw new Error("fournir exactement --apk <fichier> ou --size <octets>");
  }
  return options;
}

function apkSize(path: string): number {
  const info = statSync(path, { throwIfNoEntry: false });
  if (info === undefined || !info.isFile()) {
    throw new Error(`APK introuvable : ${path}`);
  }
  return info.size;
}

function main(argv: readonly string[]): number {
  const options = parseArgs(argv);
  const baseline = readBaseline(options.baseline);
  const size = options.size ?? apkSize(options.apk!);
  const verdict = checkApkSize(size, baseline.budgetBytes);

  if (options.record !== undefined) {
    mkdirSync(dirname(options.record), { recursive: true });
    writeFileSync(
      options.record,
      `${JSON.stringify(
        {
          ...verdict,
          apk: options.apk ?? null,
          baseline: options.baseline,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  }

  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) appendFileSync(summary, summaryMarkdown(verdict));

  console.log(
    `apk-size : ${octets(verdict.sizeBytes)} / plafond ${octets(verdict.budgetBytes)} — ${ecart(verdict)}`,
  );
  if (!verdict.ok) {
    console.error(
      `apk-size : ÉCHEC — l'APK dépasse le budget de ${-verdict.headroomBytes} o. ` +
        "Réduire la taille, ou mettre à jour apk-size-baseline.json dans une PR qui justifie la hausse.",
    );
  }
  return verdict.ok ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`apk-size : ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
