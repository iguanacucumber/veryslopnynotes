// #426 : le lockfile est une ENTRÉE de la tâche Gradle `buildWebUi`.
//
// Ce test éprouve le VRAI Gradle (pas une relecture du script) : une copie
// jetable du projet Android, avec un `package.json` de harnais dont le script
// `build:web` « construit » un bundle = une COPIE du lockfile. Le bundle
// produit porte donc l'état résolu des dépendances : son sha suit `bun.lock`.
//
// LE SCÉNARIO (le bug) : une mise à jour de dépendance TRANSITIVE change
// `bun.lock` et laisse `package.json` intact. Avant le correctif, Gradle
// disait « UP-TO-DATE » : le bundle restait celui d'avant, et l'APK
// embarquait une interface PÉRIMÉE, différente de celle que `make check`
// avait construite.
//
// LENT (trois invocations Gradle, daemon partagé avec `make android-compile`) :
// c'est le seul moyen de voir la décision « UP-TO-DATE » du vrai Gradle.
// Outillage absent (JDK 17-21, SDK Android, bun) = SKIP BRUYANT, jamais un
// faux vert.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const ANDROID = join(ROOT, "android");

interface Toolchain {
  jdk: string;
  sdk: string;
}

/**
 * JDK 17-21 + SDK Android, via la découverte du dépôt
 * (`agents/runtime/android-env.sh`) : une seule implémentation.
 */
function toolchain(): Toolchain | null {
  const p = Bun.spawnSync(
    ["sh", "-c", ". agents/runtime/android-env.sh; android_jdk; echo ---; android_sdk"],
    { cwd: ROOT },
  );
  if (p.exitCode !== 0) return null;
  const [jdk, sdk] = new TextDecoder()
    .decode(p.stdout)
    .split("---")
    .map((s) => s.trim());
  if (!jdk || !sdk) return null;
  if (!existsSync(join(jdk, "bin", "java")) || !existsSync(sdk)) return null;
  return { jdk, sdk };
}

const TOOLCHAIN = toolchain();
const SKIP =
  !TOOLCHAIN
    ? "JDK 17-21 ou SDK Android absent (voir `make android-compile` pour le diagnostic)."
    : !Bun.which("bun")
      ? "`bun` absent : la tâche `buildWebUi` en a besoin."
      : null;
if (SKIP) {
  console.warn(
    "\n" +
      "  SKIP BRUYANT — le lockfile n'a PAS été vérifié comme entrée de buildWebUi.\n" +
      `  ${SKIP}\n` +
      "  `make check` reste vert, mais il n'a PAS prouvé que le bundle suit bun.lock.\n",
  );
}

/**
 * Copie jetable du projet + des entrées de la tâche, factices mais RÉELLES
 * pour Gradle (le fichier de lockfile existe, il est modifié par le test).
 */
function harness(sdk: string): string {
  const dir = mkdtempSync(join(tmpdir(), "vsn-web-ui-"));
  // Le projet Android tel quel (le script sous test), SANS les artefacts.
  cpSync(ANDROID, join(dir, "android"), {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(ANDROID.length + 1);
      if (rel === "") return true;
      if (/(^|\/)(build|\.gradle)$/.test(rel)) return false; // artefacts
      if (rel.endsWith("src/main/assets/web")) return false; // bundle déjà construit
      return true;
    },
  });
  chmodSync(join(dir, "android", "gradlew"), 0o755);
  // Le SDK est celui découvert par le harnais (et non celui d'un
  // `local.properties` périmé copié depuis la machine).
  writeFileSync(join(dir, "android", "local.properties"), `sdk.dir=${sdk}\n`);
  // Les entrées de la tâche.
  mkdirSync(join(dir, "web", "src"), { recursive: true });
  writeFileSync(join(dir, "web", "src", "placeholder.ts"), "export const placeholder = 1;\n");
  writeFileSync(join(dir, "web", "vite.config.ts"), "export default {};\n");
  // Le « build » du harnais : le bundle produit = une COPIE du lockfile
  // (le bundle embarque l'état résolu des dépendances).
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "harnais-web-ui",
      private: true,
      scripts: {
        "build:web":
          "mkdir -p android/app/src/main/assets/web && cp bun.lock android/app/src/main/assets/web/bundle.lock",
      },
    }),
  );
  writeFileSync(join(dir, "bun.lock"), '{"lock":"v1"}\n');
  return dir;
}

interface Run {
  code: number;
  out: string;
}

/** Lance `:app:buildWebUi` dans le harnais. */
function gradle(dir: string, tc: Toolchain): Run {
  const env = { ...process.env, JAVA_HOME: tc.jdk, ANDROID_HOME: tc.sdk, ANDROID_SDK_ROOT: tc.sdk };
  const args = ["--console=plain", ":app:buildWebUi"];
  const dec = new TextDecoder();
  const run = (extra: string[]) => {
    const p = Bun.spawnSync(["./gradlew", ...extra, ...args], {
      cwd: join(dir, "android"),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: p.exitCode ?? -1, out: dec.decode(p.stdout) + dec.decode(p.stderr) };
  };
  // Hors ligne d'abord (cache local) ; le repli EN LIGNE couvre un cache
  // Gradle incomplet — même séquence que `make android-compile`.
  const off = run(["--offline"]);
  if (off.code === 0) return off;
  const on = run([]);
  return { code: on.code, out: `${off.out}\n--- repli en ligne ---\n${on.out}` };
}

/** Ce que Gradle a décidé de la tâche : EXECUTEE, UP-TO-DATE, … */
function outcome(out: string): string {
  const line = out.split("\n").find((l) => l.includes("Task") && l.includes(":app:buildWebUi"));
  if (!line) return "ABSENTE";
  if (line.includes("UP-TO-DATE")) return "UP-TO-DATE";
  if (line.includes("FROM-CACHE")) return "FROM-CACHE";
  if (line.includes("SKIPPED")) return "SKIPPED";
  return "EXECUTEE";
}

/** Gradle a réussi ? Sinon on sort avec SON journal, pas un code nu. */
function assertOk(r: Run): void {
  if (r.code !== 0) throw new Error(`le build Gradle a échoué :\n${r.out}`);
}

function sha(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("buildWebUi : le bundle suit bun.lock (#426)", () => {
  test.skipIf(SKIP !== null)(
    "un lockfile modifié rebuild le bundle (une mise à jour transitive change bun.lock, pas package.json)",
    () => {      const dir = harness(TOOLCHAIN!.sdk);
      try {
        const lock = join(dir, "bun.lock");
        const pkg = join(dir, "package.json");
        const bundle = join(dir, "android", "app", "src", "main", "assets", "web", "bundle.lock");

        // 1. Premier build : la tâche s'exécute.
        const r1 = gradle(dir, TOOLCHAIN!);
        assertOk(r1);
        expect(outcome(r1.out)).toBe("EXECUTEE");

        // 2. Rien ne change : Gradle dit UP-TO-DATE. Sans ce contrôle,
        //    « la tâche s'exécute » ne prouverait rien (elle s'exécuterait
        //    toujours, fix ou pas).
        const r2 = gradle(dir, TOOLCHAIN!);
        assertOk(r2);
        expect(outcome(r2.out)).toBe("UP-TO-DATE");
        const shaAvant = sha(bundle);
        const shaPkg = sha(pkg);

        // 3. Bump TRANSITIF : `bun.lock` change, `package.json` non.
        writeFileSync(lock, '{"lock":"v2"}\n');
        expect(sha(pkg)).toBe(shaPkg);

        // 4. Le build refait le bundle : le sha du bundle produit suit le
        //    lockfile. Avant le correctif : UP-TO-DATE, bundle périmé.
        const r3 = gradle(dir, TOOLCHAIN!);
        assertOk(r3);
        expect(outcome(r3.out)).toBe("EXECUTEE");
        expect(sha(bundle)).not.toBe(shaAvant);
        expect(sha(bundle)).toBe(sha(lock));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    // LENT : trois builds Gradle. Le daemon froid (première machine) prend
    // quelques dizaines de secondes — le défaut de 5 s serait un faux rouge.
    300_000,
  );
});
