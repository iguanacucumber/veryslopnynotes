// L'ÉTABLISSEMENT DE DÉMONSTRATION est le seul hôte PUBLIC du dépôt qui ne soit
// pas celui de l'utilisateur : il doit rester dans `android/pronote/` (I1) et
// nulle part ailleurs. Le test PARCOURT le dépôt avec `listFiles` (artefacts
// générés exclus, erreurs fichier par fichier).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles } from "../../agents/runtime/check-architecture";

const ROOT = join(import.meta.dir, "..", "..");

const MODULE = join(ROOT, "android", "pronote") + "/";

/** Les tests citent l'hôte (fixtures, ce fichier) : ils ne sont pas du produit. */
const TESTS = join(ROOT, "tests") + "/";

/** Le domaine réel de l'éditeur. */
const DEMO_HOST = "demo.index-education.net";

describe("établissement de démonstration", () => {
  test("l'hôte de la démo n'existe que dans le module qui parle à l'établissement", () => {
    const hits = listFiles(ROOT)
      .filter((f) => !f.startsWith(MODULE))
      .filter((f) => !f.startsWith(TESTS))
      .filter((f) => readFileSync(f, "utf8").includes(DEMO_HOST))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(hits).toEqual([]);
  });

  test("le module porte les constantes de la démo (et rien d'autre n'en parle)", () => {
    const source = readFileSync(
      join(MODULE, "src", "main", "java", "fr", "veryslopnynotes", "pronote", "DemoSchool.kt"),
      "utf8",
    );
    // L'adresse et les identifiants PUBLICS du compte de démonstration.
    expect(source).toContain(`const val URL = "https://${DEMO_HOST}/`);
    expect(source).toMatch(/const val LOGIN = "[^"]+"/);
    expect(source).toMatch(/const val PASSWORD = "[^"]+"/);
    expect(source).toContain("Client.login(");
    // Le client ouvre la session de démo (symétrique de `qrcodeLogin`).
    const client = readFileSync(
      join(MODULE, "src", "main", "java", "fr", "veryslopnynotes", "pronote", "Client.kt"),
      "utf8",
    );
    expect(client).toContain("fun demoLogin(): Client = DemoSchool.login()");
  });
});
