import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFiles, scanArchitecture } from "../../agents/runtime/check-architecture";

// agents/runtime/check-architecture.ts — le scan des invariants I1/I2/I3/I4/I5.
//
// #368 : deux défauts de parcours, tous deux des « faux verts » :
//   1. le scan parcourait `android/app/src/main/assets/web/assets/*.js`, le
//      bundle Vite GÉNÉRÉ (gitignoré, réécrit par `web-build`) → le verdict
//      de I1 dépendait de l'ordre d'exécution des étapes ;
//   2. le `catch` global autour du parcours avalait TOUT le répertoire (un
//      fichier supprimé entre `readdir` et `stat` → rien n'était scanné, en
//      vert). Erreur fichier par fichier maintenant, et un fichier ILLISIBLE
//      est signalé : un invariant non vérifiable n'est pas un invariant
//      respecté.
const ROOT = join(import.meta.dir, "..", "..");

describe("check-architecture : parcours des fichiers", () => {
  test("les artefacts GÉNÉRÉS (android/app/src/main/assets) ne sont jamais listés", () => {
    // Sur l'arbre réel : le bundle Vite vit sous app/src/main/assets/web/ et
    // n'est JAMAIS dans le plan de scan.
    const files = listFiles(join(ROOT, "android"));
    const generated = files.filter((f) => f.includes(`${join("app", "src", "main", "assets")}`));
    expect(generated).toEqual([]);

    // Et sur un fixture qui IMITE la forme exacte du bundle : le fichier
    // généré est ignoré, le source voisin est bien ramassé.
    const dir = mkdtempSync(join(tmpdir(), "check-arch-"));
    try {
      const assets = join(dir, "app", "src", "main", "assets", "web", "assets");
      mkdirSync(assets, { recursive: true });
      writeFileSync(join(assets, "index-DsryciEu.js"), "const pronote = 1;");
      const src = join(dir, "app", "src", "main", "java");
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "Main.kt"), "class Main");

      const found = listFiles(dir).map((f) => f.slice(dir.length + 1));
      expect(found).toEqual([join("app", "src", "main", "java", "Main.kt")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("une erreur de lecture d'un fichier n'interrompt pas le parcours du répertoire", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-arch-err-"));
    try {
      // `a-lien-mort.ts` : un lien pointant nowhere → `stat` échoue (ENOENT).
      // `b-ok.ts` : un vrai fichier, qui DOIT être ramassé malgré l'erreur.
      symlinkSync(join(dir, "cible-inexistante.ts"), join(dir, "a-lien-mort.ts"));
      writeFileSync(join(dir, "b-ok.ts"), "const a = 1;");

      const found = listFiles(dir).map((f) => f.slice(dir.length + 1));
      // Avant : le `catch` global faisait abandonner le répertoire entier.
      expect(found).toEqual(["b-ok.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un fichier ILLISIBLE est signalé : invariant non vérifiable ≠ respecté", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-arch-illisible-"));
    try {
      const src = join(dir, "android", "app", "src", "main", "java");
      mkdirSync(src, { recursive: true });
      // Les autres répertoires sont présents et peuplés : le test isole SON
      // intention (un fichier illisible), pas l'absence de #532.
      mkdirSync(join(dir, "android", "core"), { recursive: true });
      writeFileSync(join(dir, "android", "core", "Core.kt"), "class Core\n");
      mkdirSync(join(dir, "server"), { recursive: true });
      writeFileSync(join(dir, "server", "index.ts"), "export const a = 1;\n");
      const locked = join(src, "Secret.kt");
      writeFileSync(locked, "class Secret");
      // chmod 0 : la lecture échoue (EACCES). Root peut tout lire : dans ce
      // cas le fixture n'est pas illisible et le test n'a rien à constater.
      chmodSync(locked, 0o000);
      const illisible = (() => {
        try {
          readFileSync(locked, "utf8");
          return false;
        } catch {
          return true;
        }
      })();
      if (!illisible) return; // root : le chmod 0 ne verrouille rien

      const fails = scanArchitecture(dir);
      expect(fails.join("\n")).toContain("illisibles");
      expect(fails.join("\n")).toContain("Secret.kt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("l'arbre réel ne signale AUCUN fichier illisible (le scan est complet)", () => {
    expect(scanArchitecture(ROOT)).toEqual([]);
  });

  // #532 : un scanner sans fichiers à scanner n'a rien vérifié. Avant, une
  // racine vide (ou un répertoire renommé) rendait le verdict VIDE : I1, I2 et
  // I3 devenaient vacuously vrais, et le gate annonçait « OK » sans avoir lu
  // une seule ligne.
  test("une racine VIDE = ÉCHEC, pas un verdict vide", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-arch-vide-"));
    try {
      const fails = scanArchitecture(dir);
      expect(fails.length).toBeGreaterThan(0);
      expect(fails.join("\n")).toContain("invariant non vérifiable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un répertoire de sources RENOMMÉ est signalé (le nom de la cause)", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-arch-renomme-"));
    try {
      // `server/` existe mais `android/` a disparu : I1 et I3 ne sont plus
      // vérifiables, même si I2 l'est encore. Le verdict doit le dire.
      mkdirSync(join(dir, "server"), { recursive: true });
      writeFileSync(join(dir, "server", "index.ts"), "export const a = 1;\n");
      const fails = scanArchitecture(dir);
      expect(fails.join("\n")).toContain("android/");
      expect(fails.join("\n")).toContain("ABSENT");
      // Et `server/` seul ne suffit pas : android/core est absent lui aussi.
      expect(fails.join("\n")).toContain("android/core");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un répertoire de sources VIDE est signalé (pas confondu avec l'absence)", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-arch-dir-vide-"));
    try {
      mkdirSync(join(dir, "android", "core"), { recursive: true });
      mkdirSync(join(dir, "server"), { recursive: true });
      const fails = scanArchitecture(dir);
      expect(fails.join("\n")).toContain("aucun fichier à vérifier");
      // La cause est nommée : présent mais vide, PAS absent.
      expect(fails.join("\n")).not.toContain("ABSENT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Fixture minimale : quatre modules Android + une source, arêtes Gradle
   *  déclarées. `scanArchitecture` doit alors rendre un verdict vide. */
  function fixtureModules(dir: string): void {
    const edges: Record<string, string[]> = { core: [], pronote: [], data: ["core", "pronote"], app: ["core", "data"] };
    for (const [module, deps] of Object.entries(edges)) {
      const dirModule = join(dir, "android", module);
      mkdirSync(dirModule, { recursive: true });
      const bloc = deps.length
        ? `dependencies {\n${deps.map((d) => `    implementation(project(":${d}"))`).join("\n")}\n}\n`
        : "";
      writeFileSync(join(dirModule, "build.gradle.kts"), bloc);
    }
    mkdirSync(join(dir, "android", "core"), { recursive: true });
    writeFileSync(join(dir, "android", "core", "Core.kt"), "class Core\n");
    mkdirSync(join(dir, "server"), { recursive: true });
    writeFileSync(join(dir, "server", "index.ts"), "export const a = 1;\n");
  }

  test("une arête Gradle non déclarée est signalée (core -> pronote)", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-arch-gradle-"));
    try {
      fixtureModules(dir);
      expect(scanArchitecture(dir)).toEqual([]); // la frontière déclarée passe
      // La source reste valide : c'est l'ARÊTE qui viole la frontière.
      writeFileSync(
        join(dir, "android", "core", "build.gradle.kts"),
        'dependencies {\n    implementation(project(":pronote"))\n}\n',
      );
      const fails = scanArchitecture(dir).join("\n");
      expect(fails).toContain("frontière Gradle");
      expect(fails).toContain("core");
      expect(fails).toContain("pronote");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un type du port renommé ne fait pas échouer le scan", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-arch-port-"));
    try {
      fixtureModules(dir);
      // Un type du port au nom arbitraire (aucune liste recopiée) : seule
      // l'arête Gradle compte, le scan d'hôte ne voit aucune URL.
      const data = join(dir, "android", "data", "src", "main", "java");
      mkdirSync(data, { recursive: true });
      writeFileSync(
        join(data, "Data.kt"),
        "import fr.veryslopnynotes.pronote.SessionState\nclass Data(val state: SessionState)\n",
      );
      expect(scanArchitecture(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un import plateforme dans core est signalé (I3)", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-arch-platform-"));
    try {
      fixtureModules(dir);
      writeFileSync(join(dir, "android", "core", "Core.kt"), "import java.net.URL\nclass Core\n");
      expect(scanArchitecture(dir).join("\n")).toContain("I3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
