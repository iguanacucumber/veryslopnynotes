import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_TARGETS } from "../../agents/runtime/check";
import { digestOf, PARITY_SOURCES, parityDigest } from "./fixtures/parity-sources";

// agents/runtime/check.ts — le pilote de `make check` : 11 étapes lancées en
// même temps, une sortie par étape, un code de sortie global.
//
// Deux chemins à prouver, parce qu'un pilote qui rend toujours vert ne sert à
// rien :
//   1. cible verte → ✔ + résumé + code 0 ;
//   2. cible cassée → ✘ + log de l'étape AFFICHÉ EN ENTIER + code 1.
// Le 2e est le défaut que ce script est censé attraper : un recipe cassé ne doit
// jamais se terminer par « check : OK ».
//
// #368 : la LISTE des étapes est fixe. `CHECK_TARGETS` ne la remplace qu'avec
// l'opt-in `CHECK_HARNESS=1` (usage interne du harnais) — sinon un
// `CHECK_TARGETS=lint` glissé dans l'environnement réduirait le gate à un
// scan de secrets, et `agents/ship.sh` (qui hérite de l'env) annoncerait
// « make check : OK » sans avoir compilé une ligne de Kotlin.
const ROOT = join(import.meta.dir, "..", "..");
const DRIVER = join(ROOT, "agents", "runtime", "check.ts");

function drive(targets: string): { code: number; out: string } {
  const p = Bun.spawnSync(["bun", DRIVER], {
    cwd: ROOT,
    env: { ...process.env, CHECK_HARNESS: "1", CHECK_TARGETS: targets },
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = new TextDecoder();
  return {
    code: p.exitCode ?? -1,
    out: text.decode(p.stdout) + text.decode(p.stderr),
  };
}

/** Plan résolu (`--plan` : n'exécute rien, affiche ce qui tournerait).
 *  `CHECK_HARNESS` est TOUJOURS posé explicitement : un `make check-fast`
 *  parent l'exporte, et l'opt-in ne doit pas fuir d'un test à l'autre. */
function plan(env: Record<string, string>): { code: number; out: string } {
  const p = Bun.spawnSync(["bun", DRIVER, "--plan"], {
    cwd: ROOT,
    env: { ...process.env, CHECK_HARNESS: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = new TextDecoder();
  return {
    code: p.exitCode ?? -1,
    out: text.decode(p.stdout) + text.decode(p.stderr),
  };
}

/**
 * Les CHEMINS réellement mis en cache par le workflow : le contenu des blocs
 * `path:` des étapes `actions/cache`.
 *
 * On parse la CONFIGURATION, pas le texte : une mention dans un commentaire
 * ne configure rien, et un test qui lit les commentaires teste les
 * commentaires.
 */
function cachedPaths(ci: string): string[] {
  const lines = ci.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // `path: |` suivi du bloc indenté…
    if (!/^\s*path:\s*\|\s*$/.test(line)) {
      // …ou `path: <un seul chemin>`.
      const scalar = /^\s*path:\s*(\S.*?)\s*$/.exec(line);
      if (scalar) out.push(scalar[1]!);
      continue;
    }
    const indent = line.length - line.trimStart().length;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (!next.trim()) continue;
      if (next.length - next.trimStart().length <= indent) break;
      out.push(next.trim());
    }
  }
  return out;
}

describe("check.ts : pilote de `make check`", () => {
  test("cible verte : ✔ avec résumé, code 0", () => {
    const r = drive("lint");
    expect(r.code).toBe(0);
    expect(r.out).toContain("✔ lint");
    expect(r.out).toMatch(/check : OK en [\d.]+s/);
    // Étape verte : le log entier n'est PAS recopié (sinon 40 lignes de bun
    // test à chaque run), seul le résumé suit la coche.
    expect(r.out).not.toContain("\n    check-secrets OK");
  });

  test("cible inexistante : ✘, log complet, code 1", () => {
    const r = drive("cible-qui-nexiste-pas");
    expect(r.code).toBe(1);
    expect(r.out).toContain("✘ cible-qui-nexiste-pas");
    expect(r.out).toContain("check : ÉCHEC — cible-qui-nexiste-pas");
    // Le détail de l'étape est affiché, pas avalé.
    expect(r.out).toMatch(/make(\[\d+\])?: \*\*\*/);
  });

  // #368 : le défaut qui faisait passer le gate en vert à tort.
  test("CHECK_TARGETS sans opt-in : refusé, les étapes par défaut s'imposent", () => {
    const r = plan({ CHECK_TARGETS: "lint" });
    expect(r.code).toBe(0);
    // Le plan par défaut (toutes les étapes), PAS le plan réduit demandé.
    // Le nombre vient de la LISTE elle-même : ajouter une étape ne casse pas
    // ce test (et ne peut pas le rendre faux).
    expect(r.out).toContain(`${DEFAULT_TARGETS.length} étapes`);
    expect(r.out).not.toContain("PLAN — 1 étapes");
    // Et le refus est SIGNALÉ, pas silencieux.
    expect(r.out).toContain("CHECK_TARGETS REFUSÉ");
    expect(r.out).toContain("lint");
  });

  test("CHECK_TARGETS avec l'opt-in CHECK_HARNESS=1 : honoré", () => {
    const r = plan({ CHECK_TARGETS: "lint", CHECK_HARNESS: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("PLAN — 1 étapes : lint");
    expect(r.out).not.toContain("REFUSÉ");
  });

  test("le Makefile fait la différence : opt-in pour check-fast, hermétique pour check", async () => {
    const makefile = await Bun.file(join(ROOT, "Makefile")).text();
    // `check-fast` (boucle interne) : l'opt-in EXPLICITE qui autorise la liste
    // réduite — c'est le seul usage légitime de CHECK_TARGETS.
    expect(makefile).toMatch(/check-fast:\n\tCHECK_HARNESS=1 CHECK_TARGETS=/);
    // `check` (gate de merge) : l'opt-in est VIDE, donc même un shell qui
    // exporterait CHECK_HARNESS=1 ne peut pas rétrécir le gate.
    expect(makefile).toMatch(/\ncheck:\n\tCHECK_HARNESS= /);
    // #491 : `ALLOW_SKIP_ANDROID` est neutralisé de la même façon — sinon un
    // shell qui l'exporte fait sauter la SEULE compilation Kotlin du gate.
    expect(makefile).toMatch(/\ncheck:\n\tCHECK_HARNESS= ALLOW_SKIP_ANDROID= /);
    // Et le gate exige la chaîne Kotlin (sinon la parité saute en silence).
    expect(makefile).toMatch(/\ncheck:\n\tCHECK_HARNESS= ALLOW_SKIP_ANDROID= REQUIRE_KOTLIN_TOOLCHAIN=1 /);
  });

  // #491 : sans la chaîne Kotlin, la parité SAUTE — donc le gate était vert
  // sans une ligne de production Kotlin exécutée.
  test("le gate exige la chaîne Kotlin : un outillage absent est un ÉCHEC, pas un SKIP", async () => {
    const harness = await Bun.file(join(ROOT, "tests", "unit", "fixtures", "kotlin-harness.ts")).text();
    expect(harness).toContain('process.env.REQUIRE_KOTLIN_TOOLCHAIN === "1"');
    expect(harness).toMatch(/REQUIRE_KOTLIN_TOOLCHAIN === "1"[\s\S]{0,600}throw new Error/);
  });

  // #491 : le gate doit être rejoué par la CI, pas seulement par convention
  // locale. Sans CI, une PR fusionnée par un autre chemin n'était vérifiée par
  // RIEN — la PR #481 a ainsi cassé la compilation Kotlin de `main` (#483).
  test("la CI rejoue le gate COMPLET (`make check`), jamais une version light", async () => {
    const ci = await Bun.file(join(ROOT, ".github", "workflows", "ci.yml")).text();
    expect(ci).toContain("make check");
    // `check-fast` saute la compilation Kotlin : la CI ne peut pas s'en
    // contenter, sinon elle ne prouve pas ce que prouve le poste.
    expect(ci).not.toContain("check-fast");
    // Chaque PR, et chaque push sur `main`.
    expect(ci).toContain("pull_request");
    expect(ci).toContain("branches: [main]");
    // Dépôt public : aucun secret lu par le job.
    expect(ci).not.toContain("secrets.");
  });

  // #511 : la CI ne doit pas payer, à chaque run, le prix de la compilation du
  // port Kotlin (43,6 s) — ni celui des dépendances Gradle (139 s à froid).
  // Le jar de parité est mis en cache par l'empreinte de SES SOURCES.
  test("la CI met en cache le jar de parité et les dépendances Gradle", async () => {
    const ci = await Bun.file(join(ROOT, ".github", "workflows", "ci.yml")).text();
    const paths = cachedPaths(ci);
    // Le jar, dans le dossier que le harnais remplit déjà.
    expect(paths).toContain("node_modules/.cache/kotlin-parity");
    // Les dépendances Gradle : sans elles, chaque run retélécharge 378 Mo et
    // refait 353 Mo de transformations AAR.
    expect(paths).toContain("~/.gradle/caches/modules-2");
    expect(paths).toContain("~/.gradle/caches/9.8.1");
    // La clé vient de l'empreinte, pas d'un nom figé.
    expect(ci).toContain("parity-digest");
    expect(ci).toContain("kotlin-parity-${{ steps.port-kotlin.outputs.empreinte }}");
  });

  // #511 : le build cache Gradle (`caches/build-cache-1`) NE doit PAS être mis
  // en cache. Il servirait la compilation Kotlin au lieu de la faire tourner :
  // le gate compile, il ne rejoue pas un cache. C'est la SEULE vérification du
  // gate qui résout les symboles (une surcharge ambiguë, un import manquant).
  test("la CI ne met PAS le build cache Gradle en cache", async () => {
    const ci = await Bun.file(join(ROOT, ".github", "workflows", "ci.yml")).text();
    expect(cachedPaths(ci).some((p) => p.includes("build-cache-1"))).toBe(false);
  });

  // #511 : la clé du cache CI et le dossier de cache LOCAL doivent venir du
  // MÊME calcul. Deux calculs, deux clés : le cache restauré ne serait jamais
  // trouvé par le harnais — un cache mort qui coûte 43,6 s à chaque run.
  test("le harnais et la CI partagent UNE empreinte de sources", async () => {
    const harness = await Bun.file(join(ROOT, "tests", "unit", "fixtures", "kotlin-harness.ts")).text();
    // Le harnais IMPORTE le calcul, il ne le refait pas.
    expect(harness).toContain("digestOf");
    expect(harness).not.toContain("createHash");
    // Et le calcul vit dans le module qui définit les sources.
    const sources = await Bun.file(join(ROOT, "tests", "unit", "fixtures", "parity-sources.ts")).text();
    expect(sources).toContain("export function digestOf");
    expect(sources).toContain("export function parityDigest");
    // La clé de la CI est donc l'empreinte du port : 16 hex.
    expect(parityDigest()).toMatch(/^[0-9a-f]{16}$/);
    expect(digestOf(PARITY_SOURCES)).toBe(parityDigest());
  });
});
