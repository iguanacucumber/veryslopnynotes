// Le build Vite peut MOURIR sans message (binding natif tué) : le gate
// rougissait pour un bundle intact. `build-web.ts` plafonne la durée, réessaie
// UNE fois une mort (jamais un échec) et nomme la cause. Les essais rejouent
// une mort avec une fausse commande, sans payer un build Vite.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWeb, describeOutcome } from "../../agents/runtime/build-web";

/** Dossier jetable pour les marqueurs des fausses commandes. */
function jetable(): string {
  return mkdtempSync(join(tmpdir(), "vsn-build-web-"));
}

describe("build-web : un build Vite mort ne rougit pas le gate pour rien (#516)", () => {
  test("un processus MORT est rejoué, et le réessai réussi est un succès", () => {
    const dir = jetable();
    try {
      const marqueur = join(dir, "mort");
      // Le 1er essai se tue (SIGKILL), le 2e réussit.
      const r = buildWeb({
        cmd: [
          "sh",
          "-c",
          `if [ -f "${marqueur}" ]; then echo "2e essai"; exit 0; fi; ` +
            `touch "${marqueur}"; echo "1er essai"; kill -9 $$`,
        ],
      });
      expect(r.ok).toBe(true);
      expect(r.attempts.length).toBe(2);
      // Le 1er essai est nommé comme tel : MORT, pas « échec de compilation ».
      expect(r.attempts[0]!.dead).toBe(true);
      expect(r.attempts[0]!.signal).toBe("SIGKILL");
      expect(r.attempts[0]!.code).toBeNull();
      expect(r.attempts[1]!.code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un ÉCHEC de compilation n'est PAS rejoué (il est déterministe)", () => {
    const r = buildWeb({
      cmd: ["sh", "-c", "echo 'erreur de compilation' >&2; exit 1"],
    });
    expect(r.ok).toBe(false);
    expect(r.attempts.length).toBe(1);
    expect(r.attempts[0]!.code).toBe(1);
    expect(r.attempts[0]!.dead).toBe(false);
    // Le journal du build est conservé : l'erreur reste lisible.
    expect(r.attempts[0]!.journal).toContain("erreur de compilation");
  });

  test("un build coincé est TUÉ par le plafond, pas attendu", () => {
    const started = Date.now();
    const r = buildWeb({ cmd: ["sh", "-c", "sleep 30"], timeoutMs: 300 });
    expect(r.ok).toBe(false);
    // Pas de réessai : un build coincé ne se rejoue pas.
    expect(r.attempts.length).toBe(1);
    expect(r.attempts[0]!.timedOut).toBe(true);
    expect(r.attempts[0]!.dead).toBe(false);
    // Le plafond a bien coupé l'attente (pas 30 s).
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("le diagnostic NOMME la cause de chaque essai", () => {
    const mort = buildWeb({ cmd: ["sh", "-c", "kill -9 $$"] });
    const echec = buildWeb({ cmd: ["sh", "-c", "exit 2"] });
    expect(describeOutcome(mort)).toContain("MORT");
    expect(describeOutcome(mort)).toContain("SIGKILL");
    expect(describeOutcome(echec)).toContain("ÉCHEC (code 2)");
  });

  // Le build de l'APK passe par le MÊME helper, sinon pas de plafond ni de réessai.
  test("le build de l'APK passe par le même helper", async () => {
    const pkg = JSON.parse(
      await Bun.file(join(import.meta.dir, "..", "..", "package.json")).text(),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["build:web"]).toContain("agents/runtime/build-web.ts");
  });
});
