import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #418 : les scripts de build annonçaient des succès qu'ils n'avaient pas
// vérifié. Ici : la cible `build` du Makefile (le build Docker avalait TOUTE
// erreur) et la cible `runServer` (PORT/HOST figés en dur, alors que le
// commentaire promettait le contraire).
//
// Fixture façon shot-harness : un FAUX `docker` dans le PATH (donc aucun
// daemon, aucune image, aucun réseau) et la vraie cible `make build` — c'est
// elle qu'on éprouve, pas une réécriture de sa logique.

const ROOT = join(import.meta.dir, "..", "..");
const MAKEFILE = readFileSync(join(ROOT, "Makefile"), "utf8");

/** Faux `docker` : `info` et `build` pilotés par l'environnement. */
const FAKE_DOCKER = `#!/bin/sh
case "\${1:-}" in
  info) exit "\${INFO_CODE:-0}" ;;
  build)
    printf '%s\\n' "$*" >> "\${HARNESS:?}/docker.log"
    [ "\${BUILD_CODE:-0}" = 0 ] || { printf 'fake docker: build failed\\n' >&2; exit 1; }
    ;;
esac
exit 0
`;

interface Run {
  code: number;
  out: string;
  /** Dossier du harnais (journal `docker.log`). */
  dir: string;
}

/** Lance `make build` avec un faux `docker` devant le PATH. */
function makeBuild(env: Record<string, string>): Run {
  const dir = mkdtempSync(join(tmpdir(), "build-418-"));
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "docker"), FAKE_DOCKER);
  chmodSync(join(bin, "docker"), 0o755);
  const p = Bun.spawnSync(["make", "--no-print-directory", "build"], {
    cwd: ROOT,
    env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}`, HARNESS: dir, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const dec = new TextDecoder();
  return { code: p.exitCode ?? -1, out: dec.decode(p.stdout) + dec.decode(p.stderr), dir };
}

describe("cible build : le build Docker ne se masque plus (#418)", () => {
  test("daemon ABSENT : SKIP bruyant, la cible passe, aucun build tenté", () => {
    const r = makeBuild({ INFO_CODE: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("daemon Docker ABSENT");
    // Le build n'a pas été tenté : rien à masquer.
    expect(existsSync(join(r.dir, "docker.log"))).toBe(false);
  });

  test("build EN ÉCHEC : la cible ÉCHOUE (avant, le « || echo » l'avalait)", () => {
    const r = makeBuild({ INFO_CODE: "0", BUILD_CODE: "1" });
    // Le code de sortie EST l'échec : c'est lui que la CI et le make regardent.
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("build Docker EN ÉCHEC");
    // Le masque d'avant ne doit plus être là.
    expect(r.out).not.toContain("skip docker");
  });

  test("build réussi : l'image `:local` est bien reconstruite", () => {
    const r = makeBuild({ INFO_CODE: "0" });
    expect(r.code).toBe(0);
    const log = readFileSync(join(r.dir, "docker.log"), "utf8");
    expect(log).toContain("veryslopnynotes-server:local");
    expect(log).toContain("Dockerfile.server");
  });

  test("« docker » absent du PATH : SKIP bruyant, la cible passe", () => {
    // PATH minimal : ni `docker`, ni rien d'autre que ce dont la recette a
    // besoin (`bun` pour le scan de secrets, `git` pour lister les fichiers
    // trackés). Le reste de la recette ne dépend d'aucun outil.
    const dir = mkdtempSync(join(tmpdir(), "build-418-nodocker-"));
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    for (const tool of ["bun", "git"]) {
      const real = Bun.which(tool);
      if (real) symlinkSync(real, join(bin, tool));
    }
    const p = Bun.spawnSync([Bun.which("make") ?? "make", "--no-print-directory", "build"], {
      cwd: ROOT,
      env: { ...process.env, PATH: bin },
      stdout: "pipe",
      stderr: "pipe",
    });
    const dec = new TextDecoder();
    const out = dec.decode(p.stdout) + dec.decode(p.stderr);
    expect(p.exitCode).toBe(0);
    expect(out).toContain("« docker » absent du PATH");
    expect(out).toContain("NON construite");
  });

  test("la recette ne masque plus l'erreur du build Docker", () => {
    // Le défaut exact, en clair : `|| echo "skip docker (daemon absent)"`
    // avalait TOUTE erreur (Dockerfile cassé, lockfile manquant, OOM) et
    // l'image `:local` d'un build précédent était testée comme neuve.
    expect(MAKEFILE).not.toContain('|| echo "skip docker');
    // La sonde du daemon précède le build.
    expect(MAKEFILE.indexOf("docker info")).toBeLessThan(MAKEFILE.indexOf("docker build"));
  });
});

describe("le daemon Gradle ne traîne pas trois heures (#517)", () => {
  /** `android/gradle.properties`, tel qu'il est écrit. */
  function proprietes(): string {
    return readFileSync(join(ROOT, "android", "gradle.properties"), "utf8");
  }

  test("le délai d'inactivité du daemon est court", () => {
    const m = /org\.gradle\.daemon\.idletimeout=(\d+)/.exec(proprietes());
    expect(m).not.toBeNull();
    // Le défaut de Gradle est 3 h : un daemon fantôme garde ~780 Mo de RSS,
    // et plusieurs worktrees en parallèle en laissaient jusqu'à 5. Un daemon
    // fantôme ne fait jamais ÉCHOUER quoi que ce soit — il mange de la RAM
    // en silence, donc rien ne le signale s'il disparaît du fichier.
    expect(Number(m![1])).toBeLessThanOrEqual(300_000);
  });
});

describe("runServer : PORT et HOST sont surchargeables (#418)", () => {
  /** La recette `runServer`, telle qu'elle est écrite. */
  function recette(): string {
    return /runServer:\n((?:\t[^\n]*\n)+)/.exec(MAKEFILE)?.[1] ?? "";
  }

  test("la recette ne fige plus les valeurs en dur", () => {
    const r = recette();
    expect(r).toContain('PORT="$${PORT:-8080}"');
    // #421 : le défaut HOST est la boucle locale (le scraper est sans auth,
    // I8) — plus l'écoute universelle d'avant.
    expect(r).toContain('HOST="$${HOST:-127.0.0.1}"');
    // Les anciens masques : `PORT=8080 HOST=0.0.0.0` en dur.
    expect(r).not.toContain("PORT=8080 HOST=0.0.0.0");
    expect(r).not.toContain("HOST=0.0.0.0");
  });

  test("l'environnement surcharge les valeurs par défaut", () => {
    // La recette est ÉVALUÉE telle qu'elle est écrite : le défaut et la
    // surcharge sont observés, pas devinés.
    const affectation = /PORT="[^"]*"\s+HOST="[^"]*"/.exec(recette())?.[0] ?? "";
    expect(affectation).not.toBe("");
    const resoudre = (env: Record<string, string | undefined>) => {
      const p = Bun.spawnSync(
        ["sh", "-c", `${affectation.replace(/\$\$/g, "$")}; printf '%s %s' "$PORT" "$HOST"`],
        { env: { ...process.env, ...env } as Record<string, string>, stdout: "pipe" },
      );
      return new TextDecoder().decode(p.stdout);
    };
    // Défaut = boucle locale (#421, I8) ; la surcharge reste possible.
    expect(resoudre({ PORT: undefined, HOST: undefined })).toBe("8080 127.0.0.1");
    expect(resoudre({ PORT: "9090", HOST: "127.0.0.1" })).toBe("9090 127.0.0.1");
    // Exposer reste une DÉCISION explicite (réseau de confiance).
    expect(resoudre({ PORT: undefined, HOST: "0.0.0.0" })).toBe("8080 0.0.0.0");
  });
});
