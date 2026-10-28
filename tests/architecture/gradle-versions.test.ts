// tests/architecture/gradle-versions.test.ts — #624 : une seule version Kotlin.
//
// `android/gradle/libs.versions.toml` est la source unique des versions Gradle.
// Trois endroits peuvent la contredire : un littéral de dépendance dans un
// build.gradle.kts, un classpath Kotlin qui réintroduit sa propre version, ou la
// CI qui télécharge un `kotlinc` d'une autre version. Chacun fait échouer ce
// test en nommant le fichier et la valeur fautive : une version changée à UN
// seul endroit ne peut pas passer le gate en silence.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const CATALOG = "android/gradle/libs.versions.toml";
const ROOT_BUILD = "android/build.gradle.kts";
const CI = ".github/workflows/ci.yml";
const MODULE_BUILDS = ["app", "core", "data", "pronote"].map((m) => `android/${m}/build.gradle.kts`);

interface CatalogEntry {
  module?: string;
  version?: string | { ref?: string };
}

interface Catalog {
  versions: Record<string, string>;
  libraries?: Record<string, CatalogEntry>;
  plugins?: Record<string, CatalogEntry>;
}

const catalog = Bun.TOML.parse(read(CATALOG)) as Catalog;

/** Dépendances `group:artifact:version` écrites en dur dans un build script. */
function hardcodedDependencies(script: string): string[] {
  // La version doit être un LITTÉRAL : `:${libs.versions.x.get()}` n'a pas de
  // chiffre après le dernier `:` et ne matche donc pas.
  return [...script.matchAll(/["']([\w.-]+:[\w.-]+):([\d][^"']*)["']/g)].map((m) => `${m[1]}:${m[2]}`);
}

/** Versions de plugins écrites en dur (`id("…") version "1.2.3"`). */
function hardcodedPluginVersions(script: string): string[] {
  return [...script.matchAll(/\bversion\s+"([\d][^"]*)"/g)].map((m) => m[1]!);
}

/** Version Kotlin que le classpath racine met sur le chemin de compilation. */
function rootKotlinVersion(script: string): string | undefined {
  // Le classpath lit le catalogue ; un littéral serait une seconde source et
  // est déjà refusé par le test « aucun en dur ».
  const lit = /kotlin-gradle-plugin:\$\{libs\.versions\.kotlin\.get\(\)\}/.test(script);
  return lit ? catalog.versions.kotlin : undefined;
}

/** Version Kotlin que la CI télécharge (`env.KOTLIN_VERSION`). */
function ciKotlinVersion(ci: string): string | undefined {
  return /^\s*KOTLIN_VERSION:\s*"?([\d][^"'\s]*)"?\s*$/m.exec(ci)?.[1];
}

describe("versions Gradle : catalogue seul (#624)", () => {
  test("le catalogue déclare Kotlin et AGP, et chaque alias résout", () => {
    expect(catalog.versions.kotlin).toBeTruthy();
    expect(catalog.versions.agp).toBeTruthy();
    const nonResolus: string[] = [];
    for (const [alias, entree] of Object.entries({ ...catalog.libraries, ...catalog.plugins })) {
      const version = entree.version;
      const ref = typeof version === "object" ? version.ref : undefined;
      const ok = typeof version === "string" || (ref !== undefined && Boolean(catalog.versions[ref]));
      if (!ok) nonResolus.push(alias);
    }
    // Un `version.ref` mort fait échouer Gradle avec un message obscur :
    // on le nomme ici.
    expect(nonResolus).toEqual([]);
  });

  test("aucune version de dépendance en dur dans les build.gradle.kts", () => {
    for (const path of [ROOT_BUILD, ...MODULE_BUILDS]) {
      const script = read(path);
      expect({
        fichier: path,
        "dépendances en dur": hardcodedDependencies(script),
        "plugins en dur": hardcodedPluginVersions(script),
      }).toEqual({ fichier: path, "dépendances en dur": [], "plugins en dur": [] });
    }
  });

  test("la version Kotlin est la MÊME au catalogue, au classpath racine et en CI", () => {
    const catalogue = catalog.versions.kotlin;
    const racine = rootKotlinVersion(read(ROOT_BUILD));
    const ci = ciKotlinVersion(read(CI));
    expect({
      "catalogue (android/gradle/libs.versions.toml)": catalogue,
      "classpath (android/build.gradle.kts)": racine ?? "ABSENT : doit lire libs.versions.kotlin",
      "CI (.github/workflows/ci.yml KOTLIN_VERSION)": ci ?? "ABSENT : env KOTLIN_VERSION manquant",
    }).toEqual({
      "catalogue (android/gradle/libs.versions.toml)": catalogue,
      "classpath (android/build.gradle.kts)": catalogue,
      "CI (.github/workflows/ci.yml KOTLIN_VERSION)": catalogue,
    });
  });

  test("la CI consomme KOTLIN_VERSION au lieu d'un littéral recopié", () => {
    const ci = read(CI);
    expect(ci).toContain("kotlinc-${{ env.KOTLIN_VERSION }}");
    expect(ci).toContain('version="$KOTLIN_VERSION"');
    // Un littéral recopié (2.4.21) ne suivrait plus le catalogue.
    expect(ci).not.toMatch(/kotlinc-\d/);
    expect(ci).not.toMatch(/^\s*version=\d/m);
  });
});
