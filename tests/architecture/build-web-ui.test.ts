// La tâche Gradle `buildWebUi` (android/app/build.gradle.kts) décide ce que l'APK
// embarque : ses ENTRÉES doivent couvrir tout ce qui change le bundle, sinon
// Gradle dit « UP-TO-DATE » et l'APK part avec un bundle PÉRIMÉ. `bun.lock` en
// particulier : une dépendance transitive change le lock sans `package.json`.
//
// Test d'ARCHITECTURE sur la déclaration ; le comportement est éprouvé par le
// VRAI Gradle dans `gradle-web-ui.test.ts`, à côté (il exige JDK + SDK, il n'a
// rien à faire dans la suite unitaire).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");

/** Le script de build SANS commentaires : on teste le CODE, pas la prose. */
const SRC = codeOnly(readFileSync(join(ROOT, "android", "app", "build.gradle.kts"), "utf8"));

/**
 * Corps d'une tâche enregistrée. Accolades comptées : le corps peut contenir
 * des `{}` (configurations).
 */
function taskBlock(name: string): string {
  const start = SRC.indexOf(`tasks.register<Exec>("${name}")`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = SRC.indexOf("{", start); i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) return SRC.slice(start, i + 1);
  }
  return "";
}

/**
 * Chemins déclarés en ENTRÉE, relatifs à la racine du dépôt
 * (`rootProject.projectDir.parentFile`, cf. le gradle).
 */
function declaredInputs(block: string): string[] {
  const re = /inputs\.(?:file|dir)\((?:rootProject\.projectDir\.parentFile\.)?resolve\("([^"]+)"\)/g;
  return [...block.matchAll(re)].map((m) => m[1]!);
}

/**
 * Ce qui change le bundle. Une entrée absente = Gradle dit UP-TO-DATE et l'APK
 * garde un bundle périmé.
 */
const WEB_INPUTS = [
  "web/src",
  "web/index.html",
  "web/public",
  "shared",
  "web/vite.config.ts",
  "web/tsconfig.json",
  "package.json",
  "bun.lock",
  "THIRD_PARTY_NOTICES.md",
] as const;

/** Entrées attendues absentes de la déclaration : vide = Gradle voit le bundle. */
function missingInputs(block: string): string[] {
  const declared = new Set(declaredInputs(block));
  return WEB_INPUTS.filter((path) => !declared.has(path));
}

/** Le corps amputé de la ligne qui déclare `path`. */
function withoutInput(block: string, path: string): string {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.replace(
    new RegExp(`\\n[ \\t]*inputs\\.(?:file|dir)\\([^\\n]*?"${escaped}"\\)\\)`),
    "",
  );
}

describe("buildWebUi : les entrées de la tâche couvrent le bundle (#426)", () => {
  test("toutes les entrées du bundle sont déclarées", () => {
    const block = taskBlock("buildWebUi");
    expect(block).not.toBe("");
    // `bun.lockb` (ancien format binaire) n'est plus le fichier du dépôt.
    expect(block).not.toContain("bun.lockb");
    expect(missingInputs(block)).toEqual([]);
  });

  test("sabotage : retirer une entrée la rend manquante", () => {
    const block = taskBlock("buildWebUi");
    for (const path of WEB_INPUTS) {
      const amputé = withoutInput(block, path);
      // Sans ce contrôle, un sabotage qui ne coupe rien passerait pour vert.
      expect(amputé).not.toBe(block);
      expect(missingInputs(amputé)).toEqual([path]);
    }
  });

  test("aucune entrée web de premier niveau n'est oubliée", () => {
    const declared = declaredInputs(taskBlock("buildWebUi"));
    // Documentation seule : elle ne change pas le bundle.
    const horsBuild = new Set(["web/README.md"]);
    const orphelins = readdirSync(join(ROOT, "web"))
      .map((name) => `web/${name}`)
      .filter((path) => !horsBuild.has(path))
      .filter((path) => !declared.some((input) => path === input || path.startsWith(`${input}/`)));
    expect(orphelins).toEqual([]);
  });

  test("chaque entrée déclarée existe (un chemin faux = build Gradle cassé)", () => {
    const inputs = declaredInputs(taskBlock("buildWebUi"));
    expect(inputs.length).toBeGreaterThan(0);
    for (const path of inputs) {
      expect({ path, exists: existsSync(join(ROOT, path)) }).toEqual({ path, exists: true });
    }
  });

  test("preBuild dépend toujours de buildWebUi (pas de régression)", () => {
    // L'APK ne peut pas être construit sans `web/index.html` : le bundle est
    // produit par `preBuild`, pas par une étape optionnelle.
    expect(SRC).toMatch(/tasks\.named\("preBuild"\)\s*\{\s*dependsOn\(buildWebUi\)\s*\}/);
  });
});
