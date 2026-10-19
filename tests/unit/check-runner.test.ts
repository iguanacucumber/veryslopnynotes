import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// agents/runtime/check.ts — le pilote de `make check` : 10 étapes lancées en
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
  test("CHECK_TARGETS sans opt-in : refusé, les 10 étapes par défaut s'imposent", () => {
    const r = plan({ CHECK_TARGETS: "lint" });
    expect(r.code).toBe(0);
    // Le plan par défaut (10 étapes), PAS le plan réduit demandé.
    expect(r.out).toContain("10 étapes");
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
    expect(makefile).toMatch(/\ncheck:\n\tCHECK_HARNESS= bun run agents\/runtime\/check\.ts/);
  });
});
