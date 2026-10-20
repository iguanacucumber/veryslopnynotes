// Le PORT DE PARITÉ tient dans UN SEUL jar (#444).
//
// AVANT : chaque test de parité compilait son propre programme Kotlin —
// 15 `kotlinc`, 15 JVM neuves, ~500 s de CPU et ~11 Go de pointe pour la
// seule suite unitaire. OR 15 de ces 15 programmes incluaient `Json.kt` : on
// recompilait le même code 15 fois.
//
// APRÈS : un jar pour le port entier, compilé UNE fois, et un verrou qui
// fait attendre les workers concurrents au lieu de les laisser compiler
// chacun de leur côté.
//
// Ce fichier prouve les DEUX invariants qui rendent ça vrai :
//
//   1. UN SEUL JAR — les 17 tests de parité visent le même, et le verrou à
//      jar ne compile qu'une fois.
//   2. CHAQUE PILOTE EST LANCABLE — le jar porte 17 `main()`, le harnais
//      lance le pilote par sa CLASSE. Un pilote mal déduit doit se voir
//      ICI, pas dans 17 tests rouges à la fois.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSingleJar, lockIsStale } from "./fixtures/jar-lock";
import { driverSources, mainClassOf, PARITY_SOURCES, PRODUCTION_SOURCES } from "./fixtures/parity-sources";
import { JVM_FLAGS, parityToolchain, ROOT } from "./fixtures/kotlin-harness";

const DRIVERS = driverSources();

describe("port de parité : un jar pour tous les pilotes", () => {
  test("l'union contient TOUS les pilotes et toutes les sources de production", () => {
    // Un pilote laissé de côté = un test qui ne compile plus rien (ou qui
    // compile son propre jar : exactement le défaut qu'on vient de supprimer).
    for (const driver of DRIVERS) {
      expect(PARITY_SOURCES).toContain(driver);
    }
    // Les sources de production : la liste est EXPLICITE (le port Android ne
    // se compile pas hors Gradle), donc elle est vérifiable à l'œil ET ici.
    expect(PRODUCTION_SOURCES.length).toBeGreaterThan(0);
    for (const src of PRODUCTION_SOURCES) {
      expect(PARITY_SOURCES).toContain(src);
      expect(readFileSync(src, "utf8").length).toBeGreaterThan(0);
    }
  });

  test("aucun test de parité ne compile son propre jar", () => {
    // Un test qui ouvre le port partagé ET compile un jar à côté = une
    // compilation de plus, et le retour de la compilation en double (15 JVM
    // d'un coup sur 16 cœurs). Les tests du HARNIS (faux compilateur) sont
    // exclus : ils ne compilent pas le port, ils testent le harnais.
    // Ce fichier-ci est exclu : il parle forcément des deux (c'est le test
    // qui les oppose).
    const offenders: string[] = [];
    for (const file of readdirSync(join(ROOT, "tests", "unit"))) {
      if (!file.endsWith(".test.ts")) continue;
      if (file === "kotlin-parity-union.test.ts") continue;
      const src = readFileSync(join(ROOT, "tests", "unit", file), "utf8");
      if (!src.includes("openParityLink")) continue; // pas un test de parité
      if (/\bensureJar\s*\(/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("la classe principale de chaque pilote est déductible et unique", () => {
    const classes = new Map<string, string>();
    for (const driver of DRIVERS) {
      const cls = mainClassOf(driver);
      // `<package>.<Fichier>Kt` : le `main` de niveau fichier.
      expect(cls).toMatch(/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+Kt$/);
      expect(cls.endsWith(`${driver.split("/").pop()!.replace(/\.kt$/, "")}Kt`)).toBe(true);
      // Deux pilotes ne peuvent pas partager une classe : le jar ne pourrait
      // pas les lancer tous les deux.
      expect(classes.has(cls)).toBe(false);
      classes.set(cls, driver);
    }
    expect(classes.size).toBe(DRIVERS.length);
  });

  test("un pilote sans package ni main est refusé bruyamment", () => {
    const dir = mkdtempSync(join(tmpdir(), "parity-driver-"));
    try {
      const noPkg = join(dir, "SansPackage.kt");
      writeFileSync(noPkg, "fun main() {}\n");
      expect(() => mainClassOf(noPkg)).toThrow(/package/);

      const noMain = join(dir, "SansMain.kt");
      writeFileSync(noMain, "package p\nfun pasMain() {}\n");
      expect(() => mainClassOf(noMain)).toThrow(/main/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tout pilote de l'union est utilisé par un test", () => {
    // Un pilote compilé mais jamais lancé = du code mort qui grossit le
    // jar et le temps de compilation sans rien prouver. Chaque pilote doit
    // être piloté par au moins un test.
    const sources = readdirSync(join(ROOT, "tests", "unit"))
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => readFileSync(join(ROOT, "tests", "unit", f), "utf8"))
      .join("\n");
    const orphans = DRIVERS.filter((d) => !sources.includes(d.split("/").pop()!));
    expect(orphans).toEqual([]);
  });
});

describe("verrou à jar : une seule compilation, même en concurrence", () => {
  test("deux demandes concurrentes ne compilent qu'une fois", async () => {
    const dir = mkdtempSync(join(tmpdir(), "parity-lock-"));
    const jar = join(dir, "parity.jar");
    let compiles = 0;
    const compile = async (): Promise<void> => {
      compiles++;
      await Bun.sleep(50); // le temps d'une vraie compilation
      writeFileSync(jar, "binaire");
    };
    try {
      const [a, b] = await Promise.all([ensureSingleJar(jar, compile), ensureSingleJar(jar, compile)]);
      expect(a).toBe(jar);
      expect(b).toBe(jar);
      // LE point : une seule compilation, pas deux.
      expect(compiles).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un jar déjà produit n'est jamais recompilé", async () => {
    const dir = mkdtempSync(join(tmpdir(), "parity-lock-"));
    const jar = join(dir, "parity.jar");
    writeFileSync(jar, "binaire");
    let compiles = 0;
    try {
      await ensureSingleJar(jar, () => {
        compiles++;
      });
      expect(compiles).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un verrou laissé par un worker mort est récupéré", async () => {
    const dir = mkdtempSync(join(tmpdir(), "parity-lock-"));
    const jar = join(dir, "parity.jar");
    // Le pid d'un processus déjà terminé : le verrou est périmé.
    const dead = Bun.spawnSync(["true"]);
    const lock = `${jar}.lock`;
    writeFileSync(lock, String(dead.pid));
    try {
      expect(lockIsStale(lock)).toBe(true);
      let compiles = 0;
      await ensureSingleJar(jar, () => {
        compiles++;
        writeFileSync(jar, "binaire");
      });
      expect(compiles).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un échec de compilation est propagé, sans recompiler en série", async () => {
    const dir = mkdtempSync(join(tmpdir(), "parity-lock-"));
    const jar = join(dir, "parity.jar");
    let compiles = 0;
    const compile = async (): Promise<void> => {
      compiles++;
      await Bun.sleep(50);
      throw new Error("le port Kotlin ne compile pas (défaut, pas un skip)");
    };
    try {
      const results = await Promise.allSettled([
        ensureSingleJar(jar, compile),
        ensureSingleJar(jar, compile),
      ]);
      // Les DEUX demandes échouent, avec le message de la compilation.
      for (const r of results) {
        expect(r.status).toBe("rejected");
        expect((r as PromiseRejectedResult).reason.message).toContain("ne compile pas");
      }
      // Et surtout : UNE seule compilation. Sans ça, un port cassé coûtait
      // 17 compilations séquentielles.
      expect(compiles).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("le jar de l'union expose le main de chaque pilote", () => {
  const skip = parityToolchain.skipReason !== null;

  test.skipIf(skip)(
    "chaque pilote se lance depuis le jar partagé",
    async () => {
      const jar = await parityToolchain.ensureJar("kotlin-parity", PARITY_SOURCES);
      // Les 17 pilotes sont lancés PAR PAQUETS (4 à la fois) : 17 JVM d'un
      // coup, c'est 700 Mo de plus au pic — exactement ce qu'on supprime.
      const queue = [...DRIVERS];
      const failures: string[] = [];
      const worker = async (): Promise<void> => {
        for (let driver = queue.pop(); driver !== undefined; driver = queue.pop()) {
          const cls = mainClassOf(driver);
          // Le pilote lit stdin : on le ferme. Il doit mourir sur une erreur
          // d'OPÉRATION (unknown op), jamais sur un « classe introuvable ».
          // Mêmes drapeaux que les pilotes du harnais (C1 seul, GC sériel) :
          // une JVM qui fait une opération et meurt n'a rien à optimiser.
          const proc = Bun.spawn(["java", ...JVM_FLAGS, "-cp", jar, cls], {
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          });
          const stderr = await new Response(proc.stderr).text();
          await proc.exited;
          if (stderr.includes("ClassNotFoundException") || stderr.includes("Could not find or load main class")) {
            failures.push(`${driver} → ${cls} : ${stderr.split("\n")[0]}`);
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      expect(failures).toEqual([]);
    },
    // Le délai par défaut (5 s) ne suffit pas : à froid, ce test ATTEND la
    // compilation du port (~15 s) avant de lancer les pilotes.
    180_000,
  );
});
