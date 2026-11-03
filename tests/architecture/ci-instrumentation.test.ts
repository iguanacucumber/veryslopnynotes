// #887 : les tests instrumentés n'ont pas d'exécution locale possible sans
// KVM/émulateur. On verrouille donc la DÉCLARATION qui les rend prouvables :
// les cinq scénarios existent, le runner est branché, et le job CI les exécute
// sur l'émulateur épinglé de #891 avec bornes et artefacts.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const CI = read(".github/workflows/ci.yml");
const APP_GRADLE = read("android/app/build.gradle.kts");
const CATALOG = read("android/gradle/libs.versions.toml");
const BUILD = read("docs/architecture/BUILD.md");
const CHANGELOG = read("CHANGELOG.md");
const TEST_DIR = join(ROOT, "android/app/src/androidTest/java/fr/veryslopnynotes");

function jobBlock(yaml: string, name: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^  ${name}:\\s*$`).test(line));
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && /^  [A-Za-z][\w-]*:\s*$/.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

function recipes(block: string): string {
  return block
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function step(block: string, name: string): string {
  const start = block.indexOf(`- name: ${name}`);
  if (start < 0) return "";
  const next = block.indexOf("\n      - name:", start + 1);
  return block.slice(start, next < 0 ? block.length : next);
}

function androidTests(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) androidTests(path, out);
    else if (entry.name.endsWith(".kt")) out.push(path);
  }
  return out;
}

const TESTS = androidTests(TEST_DIR);
const sources = TESTS.map((path) => ({ path, code: readFileSync(path, "utf8") }));

describe("tests instrumentés (#887) — déclaration", () => {
  const job = jobBlock(CI, "emulator-instrumentation");
  const body = recipes(job);

  test("le runner AndroidX est branché et les dépendances de test restent hors APK", () => {
    expect(APP_GRADLE).toContain(
      'testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"',
    );
    expect(APP_GRADLE).toContain("androidTestImplementation(libs.androidx.test.ext.junit)");
    expect(APP_GRADLE).toContain("androidTestImplementation(libs.androidx.test.runner)");
    expect(CATALOG).toMatch(/androidx-test-junit = "[\d.]+"/);
    expect(CATALOG).toMatch(/androidx-test-runner = "[\d.]+"/);
    expect(APP_GRADLE).not.toMatch(/^\s*implementation\(libs\.androidx\.test/m);
  });

  test("les cinq scénarios exigés ont une source instrumentée", () => {
    const all = sources.map((source) => source.code).join("\n");
    expect(TESTS.length).toBeGreaterThanOrEqual(5);
    for (const marker of [
      "EncryptedLlmKeyStore",
      "ResilientSessionStore",
      "AccountPurgeFactory",
      "DurableFile.read",
      "FLAG_SECURE",
    ]) {
      expect({ marker, present: all.includes(marker) }).toEqual({ marker, present: true });
    }
    // Les classes de test portent chacune leur scénario, pas un fourre-tout.
    for (const file of [
      "LlmKeyRoundtripInstrumentedTest.kt",
      "DegradedLogoutInstrumentedTest.kt",
      "AccountPurgeInstrumentedTest.kt",
      "CorruptFileInstrumentedTest.kt",
      "SecureWindowInstrumentedTest.kt",
    ]) {
      expect({ file, present: TESTS.some((path) => path.endsWith(file)) }).toEqual({
        file,
        present: true,
      });
    }
  });

  test("les scénarios vérifient le comportement, pas seulement l'existence", () => {
    const byName = new Map(
      sources.map((source) => [source.path.split("/").at(-1)!, source.code]),
    );
    expect(byName.get("LlmKeyRoundtripInstrumentedTest.kt")).toContain("sharedPrefsContain");
    expect(byName.get("DegradedLogoutInstrumentedTest.kt")).toContain("degraded.clear()");
    expect(byName.get("DegradedLogoutInstrumentedTest.kt")).toContain(
      "ResilientSessionStore(EncryptedSessionStore(context)",
    );
    expect(byName.get("AccountPurgeInstrumentedTest.kt")).toContain(
      "AccountPurgeMode.LOGOUT",
    );
    expect(byName.get("AccountPurgeInstrumentedTest.kt")).toContain(
      "AccountPurgeMode.DELETE_ALL",
    );
    expect(byName.get("AccountPurgeInstrumentedTest.kt")).toContain("result.purged");
    expect(byName.get("CorruptFileInstrumentedTest.kt")).toContain("LocalDataUnreadable");
    expect(byName.get("CorruptFileInstrumentedTest.kt")).toContain("quarantine");
    expect(byName.get("SecureWindowInstrumentedTest.kt")).toContain("ActivityScenario.launch");
  });

  test("aucune donnée scolaire réelle ni secret dans les fixtures", () => {
    for (const source of sources) {
      expect(source.code).not.toMatch(/index-education|pronotevs/i);
      expect(source.code).not.toMatch(/\bsk-or-v1-/);
      expect(source.code).not.toContain("demo.index-education.net");
    }
  });

  test("le job réutilise l'émulateur #891, borné et non bloquant", () => {
    expect(job).not.toBe("");
    expect(job).toMatch(/timeout-minutes:\s*\d+/);
    expect(job).toMatch(/^\s+continue-on-error: true$/m);
    expect(job).toContain(
      "ReactiveCircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d",
    );
    expect(job).not.toMatch(/android-emulator-runner@v\d/);
    expect(job).toMatch(/api-level:\s*35/);
    expect(job).toMatch(/target:\s*google_apis/);
    expect(job).toMatch(/arch:\s*x86_64/);
    expect(body).toContain(":app:connectedDebugAndroidTest");
    // Une seule invocation Gradle : pas de build séparé qui divergerait.
    expect(body.match(/connectedDebugAndroidTest/g)?.length).toBe(1);
  });

  test("il est hors du gate et n'ajoute ni secret ni reprise", () => {
    expect(body).not.toMatch(/\bmake check\b/);
    expect(recipes(jobBlock(CI, "check"))).not.toContain("emulator-instrumentation");
    expect(job).not.toMatch(/\$\{\{\s*secrets\./);
    expect(job).not.toMatch(/\b(?:retry|reprise)\b/i);
    expect(job).not.toMatch(/demo\.index-education\.net/);
  });

  test("les preuves (XML, rapport, logcat) partent en artefact même en échec", () => {
    const upload = step(job, "Résultats des tests instrumentés");
    expect(upload).toContain("if: always()");
    expect(upload).toContain("name: emulator-instrumentation");
    expect(upload).toContain("android/app/build/outputs/androidTest-results");
    expect(upload).toContain("android/app/build/reports/androidTests");
    expect(upload).toMatch(/path:\s*\|/);
    expect(upload).toMatch(/retention-days:\s*7/);
    expect(upload).toContain("if-no-files-found: ignore");
    expect(body).toContain("logcat.txt");
  });
});

describe("tests instrumentés (#887) — documentation", () => {
  test("BUILD.md explique le périmètre et le caractère non bloquant", () => {
    expect(BUILD).toContain("## Tests instrumentés Android");
    const section = BUILD.slice(BUILD.indexOf("## Tests instrumentés Android"));
    expect(section).toMatch(/non bloquant/i);
    expect(section).toContain("connectedDebugAndroidTest");
    expect(section).toContain("FLAG_SECURE");
  });

  test("le changelog annonce la couverture instrumentée", () => {
    expect(CHANGELOG).toMatch(/Tests instrumentés/i);
    expect(CHANGELOG).toMatch(/FLAG_SECURE|purge complète/i);
  });
});
