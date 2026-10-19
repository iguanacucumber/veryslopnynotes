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
const ROOT = join(import.meta.dir, "..", "..");
const DRIVER = join(ROOT, "agents", "runtime", "check.ts");

function drive(targets: string): { code: number; out: string } {
  const p = Bun.spawnSync(["bun", DRIVER], {
    cwd: ROOT,
    env: { ...process.env, CHECK_TARGETS: targets },
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
});
