// check-licenses.ts — inventaire de licences des dépendances Bun et Gradle.
//
// Sources LOCALES uniquement : `bun.lock` (JSONC), le catalogue Gradle (TOML)
// et `licenses/inventory.json`. Aucun réseau, aucun `node_modules` : le verdict
// ne dépend pas de l'état d'installation.
//
// Une licence hors allowlist échoue, sauf MPL-2.0 déclarée build-only/test-only
// ET absente du graphe des dépendances de production (donc jamais distribuée).
// Une dépendance absente de l'inventaire échoue aussi : nouveau paquet = revue
// de licence explicite, jamais un vert par défaut.
//
// ponytail: SPDX simple (une chaîne), pas d'expression composée ; upgrade =
// parseur SPDX le jour où une dépendance publie « MIT OR Apache-2.0 ».
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const INVENTORY_PATH = "licenses/inventory.json";
const LOCK_PATH = "bun.lock";
const CATALOG_PATH = "android/gradle/libs.versions.toml";
const MPL = "MPL-2.0";

export type Scope = "build-only" | "test-only";

export interface LicenseEntry {
  license: string;
  scope?: Scope;
  reason?: string;
}

export interface LicenseFamily extends LicenseEntry {
  match: string;
}

export interface Inventory {
  allowed: string[];
  bun: Record<string, LicenseEntry>;
  bunFamilies?: LicenseFamily[];
  gradle: Record<string, LicenseEntry>;
}

interface PackageMeta {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface Lock {
  packages?: Record<string, unknown[]>;
  workspaces?: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
}

interface CatalogEntry {
  module?: string;
  id?: string;
}

interface Catalog {
  libraries?: Record<string, CatalogEntry>;
  plugins?: Record<string, CatalogEntry>;
}

export interface LicenseReport {
  errors: string[];
  bun: number;
  gradle: number;
}

/** « @scope/pkg@1.2.3 » → « @scope/pkg » (le dernier `@` sépare la version). */
export function packageName(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

function matches(pattern: string, name: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(name);
}

function bunEntry(inventory: Inventory, name: string): LicenseEntry | undefined {
  const exact = inventory.bun[name];
  if (exact !== undefined) return exact;
  return inventory.bunFamilies?.find((family) => matches(family.match, name));
}

/** Noms atteignables depuis les `dependencies` (pas `devDependencies`) de la
 *  racine. Le lock ne distingue pas prod/dev par paquet ; la racine, si. */
export function productionClosure(lock: Lock): Set<string> {
  const edges = new Map<string, string[]>();
  for (const value of Object.values(lock.packages ?? {})) {
    if (!Array.isArray(value) || typeof value[0] !== "string") continue;
    const name = packageName(value[0]);
    const meta = (value[2] ?? {}) as PackageMeta;
    const deps = edges.get(name) ?? [];
    deps.push(...Object.keys(meta.dependencies ?? {}), ...Object.keys(meta.optionalDependencies ?? {}));
    edges.set(name, deps);
  }

  const seen = new Set<string>();
  const pending = [...Object.keys(lock.workspaces?.[""]?.dependencies ?? {})];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    pending.push(...(edges.get(name) ?? []));
  }
  return seen;
}

function compatibilityError(name: string, entry: LicenseEntry, allowed: Set<string>): string | null {
  if (allowed.has(entry.license)) return null;
  const exception = entry.license === MPL && (entry.scope === "build-only" || entry.scope === "test-only");
  if (!exception) {
    return `${name} : licence ${entry.license} INCOMPATIBLE (allowlist : ${[...allowed].join(", ")})`;
  }
  if (entry.reason === undefined || entry.reason.trim() === "") {
    return `${name} : exception ${MPL} ${entry.scope} sans justification dans ${INVENTORY_PATH}`;
  }
  return null;
}

/** Vérifie l'inventaire complet. `root` surchargeable pour les fixtures. */
export function checkLicenses(root: string = ROOT): LicenseReport {
  const inventory = JSON.parse(readFileSync(join(root, INVENTORY_PATH), "utf8")) as Inventory;
  if (!Array.isArray(inventory.allowed) || inventory.allowed.length === 0) {
    throw new Error(`${INVENTORY_PATH} : allowlist vide ou absente`);
  }
  if (inventory.bun === undefined || inventory.gradle === undefined) {
    throw new Error(`${INVENTORY_PATH} : sections \`bun\` et \`gradle\` requises`);
  }

  const lock = Bun.JSONC.parse(readFileSync(join(root, LOCK_PATH), "utf8")) as Lock;
  const catalog = Bun.TOML.parse(readFileSync(join(root, CATALOG_PATH), "utf8")) as Catalog;

  const allowed = new Set(inventory.allowed);
  const errors: string[] = [];

  const bunNames = new Map<string, string[]>();
  for (const value of Object.values(lock.packages ?? {})) {
    if (!Array.isArray(value) || typeof value[0] !== "string") {
      errors.push(`${LOCK_PATH} : entrée de paquet malformée`);
      continue;
    }
    const name = packageName(value[0]);
    const specs = bunNames.get(name) ?? [];
    specs.push(value[0]);
    bunNames.set(name, specs);
  }

  const production = productionClosure(lock);
  for (const name of [...bunNames.keys()].sort()) {
    const versions = bunNames.get(name)!.sort().join(", ");
    const entry = bunEntry(inventory, name);
    if (entry === undefined) {
      errors.push(`bun: ${versions} — licence INCONNUE (absente de ${INVENTORY_PATH})`);
      continue;
    }
    const incompatible = compatibilityError(`bun: ${versions}`, entry, allowed);
    if (incompatible !== null) {
      errors.push(incompatible);
      continue;
    }
    if (entry.scope !== undefined && production.has(name)) {
      errors.push(
        `bun: ${versions} — exception ${entry.license} (${entry.scope}) mais ATTEIGNABLE depuis les dépendances de production`,
      );
    }
  }

  let gradle = 0;
  const checkGradle = (label: string, key: string | undefined, alias: string): void => {
    if (key === undefined) {
      errors.push(`gradle: ${alias} sans ${label}`);
      return;
    }
    gradle++;
    const entry = inventory.gradle[key];
    if (entry === undefined) {
      errors.push(`gradle: ${key} — licence INCONNUE (absente de ${INVENTORY_PATH})`);
      return;
    }
    const incompatible = compatibilityError(`gradle: ${key}`, entry, allowed);
    if (incompatible !== null) errors.push(incompatible);
  };

  for (const [alias, entry] of Object.entries(catalog.libraries ?? {})) checkGradle("module", entry.module, alias);
  for (const [alias, entry] of Object.entries(catalog.plugins ?? {})) checkGradle("id", entry.id, alias);

  return { errors, bun: bunNames.size, gradle };
}

if (import.meta.main) {
  try {
    const report = checkLicenses(process.argv[2] ? resolve(process.argv[2]) : ROOT);
    if (report.errors.length > 0) {
      console.error("check-licenses FAIL:");
      for (const error of report.errors) console.error(" - " + error);
      process.exit(1);
    }
    console.log(`check-licenses OK (${report.bun} dépendances Bun, ${report.gradle} entrées Gradle)`);
  } catch (error) {
    console.error(`check-licenses FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
