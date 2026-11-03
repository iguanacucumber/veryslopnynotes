// Le smoke émulateur (#891) n'a pas de comportement exécutable en local sans
// Docker/KVM : on verrouille donc la DÉCLARATION qui le rend prouvable — job
// épinglé, non bloquant, APK debug, appairage démo, accueil, preuves en
// artefact, et aucun identifiant/hôte scolaire dans le chemin CI.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const CI = read(".github/workflows/ci.yml");
const SCRIPT = read("agents/runtime/emulator-smoke.ts");
const BUILD = read("docs/architecture/BUILD.md");
const CHANGELOG = read("CHANGELOG.md");

/** Lignes d'un job YAML, jusqu'au job suivant (clé à l'indentation 2). */
function jobBlock(yaml: string, name: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^  ${name}:\\s*$`).test(line));
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && /^  [A-Za-z][\w-]*:\s*$/.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

/** Recette YAML sans ses commentaires : on teste l'exécution, pas la prose. */
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

describe("CI : smoke émulateur (#891)", () => {
  const job = jobBlock(CI, "emulator-smoke");
  const body = recipes(job);

  test("le job existe, hors du gate, avec une borne de temps", () => {
    expect(job).not.toBe("");
    expect(job).toMatch(/timeout-minutes:\s*\d+/);
    // Ce n'est ni un second gate ni une dépendance du gate.
    expect(body).not.toMatch(/\bmake check\b/);
    expect(recipes(jobBlock(CI, "check"))).not.toContain("emulator-smoke");
  });

  test("il est NON BLOQUANT tant qu'il n'est pas stable, et documenté comme tel", () => {
    expect(job).toMatch(/^\s+continue-on-error: true$/m);
    expect(BUILD).toContain("## Smoke émulateur");
    const section = BUILD.slice(BUILD.indexOf("## Smoke émulateur"));
    expect(section).toMatch(/non bloquant/i);
    expect(section).toMatch(/continue-on-error/);
    // Une promotion se décide sur des runs réels, jamais dans cette PR.
    expect(section).toMatch(/runs réels/i);
  });

  test("l'action émulateur est épinglée par SHA, jamais par tag", () => {
    expect(job).toContain(
      "ReactiveCircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d",
    );
    expect(job).not.toMatch(/android-emulator-runner@v\d/);
    expect(job).toMatch(/api-level:\s*35/);
    expect(job).toMatch(/target:\s*google_apis/);
    expect(job).toMatch(/arch:\s*x86_64/);
  });

  test("il construit l'APK debug et lance le MÊME script que le poste", () => {
    expect(body).toContain("make buildDebugApk");
    expect(body).toContain("bun run agents/runtime/emulator-smoke.ts");
    expect(body).toMatch(/EMULATOR_SMOKE_DIR:\s*\$\{\{\s*runner\.temp\s*\}\}\/emulator-smoke/);
  });

  test("aucun secret, aucun identifiant, aucune donnée scolaire dans le job", () => {
    expect(job).not.toMatch(/\$\{\{\s*secrets\./);
    expect(job).not.toMatch(/\b(?:password|mot de passe|token|api[_-]?key)\b/i);
    // Le job ne peut pas inventer d'école : il n'a que le bouton démo public.
    expect(job).not.toMatch(/demo\.index-education\.net/);
  });

  test("les preuves partent en artefact, même en échec", () => {
    const upload = step(job, "Preuves du smoke émulateur");
    expect(upload).toContain("if: always()");
    expect(upload).toContain("name: emulator-smoke");
    expect(upload).toMatch(/path:\s*\$\{\{\s*runner\.temp\s*\}\}\/emulator-smoke/);
    expect(upload).toMatch(/retention-days:\s*7/);
    expect(upload).toContain("if-no-files-found: ignore");
  });

  test("aucune reprise : seul web-smoke en a une (#924)", () => {
    expect(body).not.toMatch(/retry|reprise/i);
  });
});

describe("script du smoke émulateur", () => {
  test("installe l'APK debug, clique la démo et exige l'accueil", () => {
    expect(SCRIPT).toContain('adb(["install", "-r", APK]');
    expect(SCRIPT).toContain('getByRole("button", { name: "Connexion démo"');
    expect(SCRIPT).toContain('getByRole("heading", { name: "Accueil"');
    expect(SCRIPT).toContain('hash === "#/"');
    expect(SCRIPT).toContain("Navigation principale");
  });

  test("garde captures, DOM et logcat comme preuve", () => {
    expect(SCRIPT).toContain("page.screenshot");
    expect(SCRIPT).toContain('capture(page, "01-pairing")');
    expect(SCRIPT).toContain('capture(page, "02-accueil")');
    expect(SCRIPT).toContain("page.content()");
    expect(SCRIPT).toContain("logcat");
    expect(SCRIPT).toContain("99-echec");
  });

  test("chaque attente est bornée par une échéance nommée", () => {
    for (const nom of [
      "DELAI_ADB_MS",
      "DELAI_BOOT_MS",
      "DELAI_INSTALL_MS",
      "DELAI_APP_MS",
      "DELAI_CDP_MS",
      "DELAI_PAIRING_MS",
      "DELAI_HOME_MS",
      "INTERVALLE_SONDE_MS",
    ]) {
      expect(SCRIPT).toMatch(new RegExp(`const ${nom} = [\\d_]+;`));
    }
    expect(SCRIPT).not.toMatch(/waitForTimeout\s*\(/);
    const sleeps = [...SCRIPT.matchAll(/Bun\.sleep\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(sleeps).toEqual(["INTERVALLE_SONDE_MS"]);
  });

  test("ne connaît ni hôte ni identifiant de l'établissement", () => {
    expect(SCRIPT).not.toContain("demo.index-education.net");
    expect(SCRIPT).not.toContain("pronotevs");
    expect(SCRIPT).not.toContain('"demonstration"');
  });
});

describe("changelog", () => {
  test("la PR annonce le smoke émulateur", () => {
    expect(CHANGELOG).toMatch(/[ÉE]mulateur/i);
    expect(CHANGELOG).toMatch(/non bloquant/i);
  });
});
