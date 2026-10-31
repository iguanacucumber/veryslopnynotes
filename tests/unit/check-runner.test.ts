import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TARGETS } from "../../agents/runtime/check";
import {
  digestOf,
  PARITY_SOURCES,
  parityDigest,
  productionDigest,
  PRODUCTION_SOURCES,
} from "./fixtures/parity-sources";

// agents/runtime/check.ts — le pilote de `make check` : 11 étapes lancées en
// même temps, une sortie par étape, un code de sortie global.
//
// Deux chemins à prouver, parce qu'un pilote qui rend toujours vert ne sert à
// rien :
//   1. cible verte → ✔ + résumé + code 0 ;
//   2. cible cassée → ✘ + log de l'étape + code 1. Au-delà de la borne, seule
//      la fin s'affiche ; le log complet est écrit et son chemin imprimé.
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

  test("cible inexistante : ✘, log affiché, code 1", () => {
    const r = drive("cible-qui-nexiste-pas");
    expect(r.code).toBe(1);
    expect(r.out).toContain("✘ cible-qui-nexiste-pas");
    expect(r.out).toContain("check : ÉCHEC — cible-qui-nexiste-pas");
    // Le détail de l'étape est affiché, pas avalé.
    expect(r.out).toMatch(/make(\[\d+\])?: \*\*\*/);
    // Log court : rien n'est masqué, aucun fichier n'est annoncé.
    expect(r.out).not.toContain("ligne(s) masquée(s)");
  });

  test("échec long : la fin s'affiche, le fichier complet est écrit", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-710-long-"));
    try {
      // 300 lignes : seul le tail doit apparaître dans la sortie du harnais.
      writeFileSync(join(dir, "Makefile"), "long:\n\t@seq 1 300\n\t@exit 1\n");
      const p = Bun.spawnSync(["bun", DRIVER, dir], {
        cwd: ROOT,
        env: { ...process.env, CHECK_HARNESS: "1", CHECK_TARGETS: "long" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const dec = new TextDecoder();
      const out = dec.decode(p.stdout) + dec.decode(p.stderr);
      expect(p.exitCode).toBe(1);
      const path = /log complet : (\S+)/.exec(out)?.[1] ?? "";
      expect(path).not.toBe("");
      // Le début est masqué, la fin est là.
      expect(out).not.toContain("\n    1\n");
      expect(out).toContain("\n    300");
      const full = readFileSync(path, "utf8");
      expect(full).toMatch(/^1\n/);
      expect(full).toContain("300");
      rmSync(path, { force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    // Le GATE (la phase 1, `check-run`) : l'opt-in est VIDE, donc même un
    // shell qui exporterait CHECK_HARNESS=1 ne peut pas rétrécir le gate.
    const gate = /check-run:\n((?:\t[^\n]*\n)+)/.exec(makefile)?.[1] ?? "";
    expect(gate).toContain(
      "CHECK_HARNESS= ALLOW_SKIP_ANDROID= REQUIRE_KOTLIN_TOOLCHAIN=1 bun run agents/runtime/check.ts",
    );
    // #491 : `ALLOW_SKIP_ANDROID` est neutralisé de la même façon — sinon un
    // shell qui l'exporte fait sauter la SEULE compilation Kotlin du gate.
    expect(gate).toContain("ALLOW_SKIP_ANDROID=");
    // #523 : `MAKEFLAGS` aussi — `-i` faisait d'un gate ROUGE un gate VERT.
    expect(gate).toContain("MAKEFLAGS=");
  });

  // #523 : le gate ne se laisse pas neutraliser par l'environnement. Deux
  // niveaux, deux trous, deux tests :
  //   1. le harnais lance un `make` ENFANT par étape — `-i` y faisait passer
  //      une étape ROUGE pour verte ;
  //   2. `make check` elle-même : `-i` y faisait ignorer l'échec de la
  //      recette, donc `make check` sortait 0 avec un gate rouge.
  describe("#523 : MAKEFLAGS ne neutralise plus le gate", () => {
    /** Faux `bun` : le harnais ne démarre pas, son code de sortie est piloté. */
    const FAKE_BUN = `#!/bin/sh
echo "fake bun: code \${FAKE_BUN_CODE:-0}" >&2
exit "\${FAKE_BUN_CODE:-0}"
`;

    /** Lance le VRAI `make check` du dépôt, un faux `bun` devant le PATH. */
    function makeCheck(env: Record<string, string>): { code: number; out: string; status: string } {
      const dir = mkdtempSync(join(tmpdir(), "gate-523-make-"));
      const bin = join(dir, "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "bun"), FAKE_BUN);
      chmodSync(join(bin, "bun"), 0o755);
      const status = join(dir, "gate-status");
      const p = Bun.spawnSync(["make", "--no-print-directory", "-s", `GATE_STATUS=${status}`, "check"], {
        cwd: ROOT,
        env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}`, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const dec = new TextDecoder();
      return {
        code: p.exitCode ?? -1,
        out: dec.decode(p.stdout) + dec.decode(p.stderr),
        status: existsSync(status) ? readFileSync(status, "utf8").trim() : "",
      };
    }

    test("le harnais neutralise MAKEFLAGS : une étape en échec reste ROUGE", () => {
      const dir = mkdtempSync(join(tmpdir(), "gate-523-enfant-"));
      try {
        // Un dépôt-jouet dont la cible échoue : c'est le VRAI `make` enfant
        // qu'on éprouve, pas une réécriture de sa logique.
        writeFileSync(join(dir, "Makefile"), "echec:\n\t@exit 3\n");
        const p = Bun.spawnSync(["bun", DRIVER, dir], {
          cwd: ROOT,
          env: { ...process.env, CHECK_HARNESS: "1", CHECK_TARGETS: "echec", MAKEFLAGS: "-i" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const dec = new TextDecoder();
        const out = dec.decode(p.stdout) + dec.decode(p.stderr);
        expect(p.exitCode).toBe(1);
        expect(out).toContain("✘ echec");
        expect(out).toContain("check : ÉCHEC — echec");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("`make check` reste ROUGE sous MAKEFLAGS=-i (le verdict est une erreur de MAKE)", () => {
      const r = makeCheck({ MAKEFLAGS: "-i", FAKE_BUN_CODE: "1" });
      // Avant : `-i` faisait ignorer l'échec de la recette, `make check`
      // sortait 0, et `agents/ship.sh` écrivait « `make check` : OK ».
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("gate ROUGE");
      // Le code de sortie du harnais a bien été ÉCRIT, puis REFUSÉ par make.
      expect(r.status).toBe("1");
    });

    test("`make check` reste VERT quand le gate réussit (le verdict ne casse rien)", () => {
      const r = makeCheck({ MAKEFLAGS: "-i", FAKE_BUN_CODE: "0" });
      expect(r.code).toBe(0);
      expect(r.status).toBe("0");
    });

    test("un gate qui CRASH avant d'écrire son statut ne valide rien", () => {
      const dir = mkdtempSync(join(tmpdir(), "gate-523-crash-"));
      try {
        const bin = join(dir, "bin");
        mkdirSync(bin, { recursive: true });
        // Le faux `bun` tue son parent (la shell de la recette) : le harnais
        // meurt, le statut n'est JAMAIS écrit.
        writeFileSync(join(bin, "bun"), "#!/bin/sh\nkill -9 $PPID\n");
        chmodSync(join(bin, "bun"), 0o755);
        const status = join(dir, "gate-status");
        // Un statut VERT d'un run précédent traîne : il ne doit PAS valider
        // un gate qui n'a pas tourné.
        writeFileSync(status, "0");
        const p = Bun.spawnSync(["make", "--no-print-directory", "-s", `GATE_STATUS=${status}`, "check"], {
          cwd: ROOT,
          env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}`, MAKEFLAGS: "-i" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const dec = new TextDecoder();
        const out = dec.decode(p.stdout) + dec.decode(p.stderr);
        expect(p.exitCode).not.toBe(0);
        expect(out).toContain("gate NON EXÉCUTÉ");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("le gate est en DEUX phases : le verdict refuse par `$(error)`", async () => {
      const makefile = await Bun.file(join(ROOT, "Makefile")).text();
      // `check` dépend de `check-run` : la phase 1 (le harnais) tourne AVANT
      // que la phase 2 (le verdict) soit expandue.
      expect(makefile).toMatch(/^check: check-run$/m);
      // Le verdict refuse par `$(error)` : `-i` ignore l'échec d'une RECETTE,
      // pas une erreur de make.
      const verdict = /^check: check-run\n((?:\t[^\n]*\n)+)/m.exec(makefile)?.[1] ?? "";
      expect(verdict).toContain("$(error");
      expect(verdict).toContain("GATE_STATUS");
    });
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
  // Le port est mis en cache par l'empreinte des sources de PRODUCTION : un
  // pilote modifié restaure le port et ne recompile que son overlay.
  test("la CI met en cache le port de parité et les dépendances Gradle", async () => {
    const ci = await Bun.file(join(ROOT, ".github", "workflows", "ci.yml")).text();
    const paths = cachedPaths(ci);
    // Le port et les pilotes de base, dans le dossier que le harnais remplit.
    expect(paths).toContain("node_modules/.cache/kotlin-parity");
    // Les dépendances Gradle : sans elles, chaque run retélécharge 378 Mo et
    // refait 353 Mo de transformations AAR.
    expect(paths).toContain("~/.gradle/caches/modules-2");
    expect(paths).toContain("~/.gradle/caches/9.8.1");
    // Le compilateur Kotlin (90 Mo d'archive, 9-17 s de téléchargement).
    // #624 : la version vient de `env.KOTLIN_VERSION`, comparée au catalogue
    // par tests/architecture/gradle-versions.test.ts.
    expect(paths).toContain("node_modules/.cache/kotlinc-${{ env.KOTLIN_VERSION }}");
    // La clé vient de l'empreinte des sources de production, pas d'un nom figé.
    expect(ci).toContain("parity-digest");
    expect(ci).toContain("kotlin-parity-port-v1-${{ steps.port-kotlin.outputs.empreinte }}");
  });

  // #513 : le cache du compilateur Kotlin n'était JAMAIS sauvegardé, en
  // silence — `actions/cache` avale l'erreur de sauvegarde, l'étape post
  // reste verte, l'entrée est simplement ABSENTE (90 Mo retéléchargés à
  // chaque run). La cause : le cache pointait sur
  // `kotlin-compiler-<version>/` alors que l'archive de JetBrains dépose un
  // dossier `kotlinc/` — le cache visait un dossier INEXISTANT.
  //
  // Ces trois faits sont ÉCRITS : le cache porte sur le dossier que l'étape
  // remplit, et le binaire est SOUS ce dossier.
  test("le cache du compilateur pointe sur le dossier que l'étape remplit", async () => {
    const ci = await Bun.file(join(ROOT, ".github", "workflows", "ci.yml")).text();
    // Le dossier que l'étape remplit, sous le workspace...
    expect(ci).toContain('root="$GITHUB_WORKSPACE/node_modules/.cache/kotlinc-${version}"');
    // ...et le binaire, DEDANS (l'archive contient `kotlinc/`).
    expect(ci).toContain('home="$root/kotlinc"');
    // Le cache porte sur ce dossier-là — et sur la MÊME version qu'on installe
    // (#624 : une seule variable, `env.KOTLIN_VERSION`, plus de littéral).
    expect(ci).toContain('version="$KOTLIN_VERSION"');
    expect(cachedPaths(ci)).toContain("node_modules/.cache/kotlinc-${{ env.KOTLIN_VERSION }}");
    expect(ci).toContain("key: kotlinc-${{ env.KOTLIN_VERSION }}-");
  });

  // #513 : aucun chemin ABSOLU. Hors du workspace, le cache n'a jamais
  // survécu au voyage ; sous le HOME ou dans le workspace, il fonctionne.
  test("tout chemin mis en cache est relatif au workspace ou sous le HOME", async () => {
    const ci = await Bun.file(join(ROOT, ".github", "workflows", "ci.yml")).text();
    const chemins = cachedPaths(ci);
    expect(chemins.filter((p) => p.startsWith("/"))).toEqual([]);
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
  test("le harnais et la CI partagent l'empreinte des sources de production", async () => {
    const harness = await Bun.file(join(ROOT, "tests", "unit", "fixtures", "kotlin-harness-build.ts")).text();
    // Le harnais IMPORTE le calcul, il ne le refait pas.
    expect(harness).toContain("productionDigest");
    expect(harness).not.toContain("createHash");
    // Et le calcul vit dans le module qui définit les sources.
    const sources = await Bun.file(join(ROOT, "tests", "unit", "fixtures", "parity-sources.ts")).text();
    expect(sources).toContain("export function digestOf");
    expect(sources).toContain("export function productionDigest");
    // La clé de la CI est donc l'empreinte du port : 16 hex.
    expect(productionDigest()).toMatch(/^[0-9a-f]{16}$/);
    expect(digestOf(PRODUCTION_SOURCES)).toBe(productionDigest());
    // L'union reste l'empreinte du chemin à froid (cache local).
    expect(parityDigest()).toMatch(/^[0-9a-f]{16}$/);
    expect(digestOf(PARITY_SOURCES)).toBe(parityDigest());
  });
});

describe("gate : chaque étape a une vraie recette", () => {
  // #714 a supprimé la recette `unit:` en gardant l'entrée `.PHONY` : make
  // répondait « Nothing to be done » et le gate restait vert sans exécuter un
  // seul test unitaire. Une cible déclarée ne prouve rien ; une RECETTE si.
  const MAKEFILE = readFileSync(join(ROOT, "Makefile"), "utf8").split("\n");

  function hasRecipe(target: string, seen = new Set<string>()): boolean {
    if (seen.has(target)) return false;
    seen.add(target);
    const start = MAKEFILE.findIndex((l) => new RegExp(`^${target}:(?!=)`).test(l));
    if (start < 0) return false;
    // Cible agrégat (`architecture: web-build architecture-test`) : sa recette
    // est celle de ses prérequis, qui doivent eux-mêmes en avoir une.
    const prereqs = /^[^:]+:(.*)$/.exec(MAKEFILE[start]!)?.[1]?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (prereqs.length > 0) return prereqs.every((p) => hasRecipe(p, seen));
    for (let i = start + 1; i < MAKEFILE.length; i++) {
      const line = MAKEFILE[i]!;
      if (/^\t/.test(line)) return true;
      // Une nouvelle cible/variable/section termine le bloc.
      if (/^[^\t#\s]/.test(line)) return false;
    }
    return false;
  }

  test("chaque cible de DEFAULT_TARGETS possède une recette", () => {
    expect(DEFAULT_TARGETS.filter((t) => !hasRecipe(t))).toEqual([]);
  });

  test("la recette unit lance bien les tests unitaires", () => {
    expect(hasRecipe("unit")).toBe(true);
    // Le filtre est dans la recette : un échec bun doit encore rougir le gate
    // (le code de sortie est forwardé, cf. test-output.test.ts).
    expect(MAKEFILE.join("\n")).toMatch(/^unit:\n\t\$\(TEST_OUTPUT\) unit tests\/unit --parallel$/m);
  });
});
