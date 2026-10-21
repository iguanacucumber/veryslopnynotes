// L'ÉTABLISSEMENT DE DÉMONSTRATION : un hôte public, un seul endroit.
//
// Le bouton « Connexion démo » ouvre une session sur le site de démonstration
// public de l'éditeur. C'est le seul hôte du dépôt qui soit une adresse
// PUBLIQUE et qui ne soit pas celui de l'utilisateur : il doit donc rester
// dans le module qui parle à l'établissement (`android/pronote/`, I1), et
// nulle part ailleurs.
//
// Concrètement : le web n'a qu'un BOUTON (la CSP le verrouille de toute
// façon), le dépôt ne connaît que le TYPE du module, et le serveur ignore
// cet hôte comme tous les autres.
//
// Ce test PARCOURT le dépôt : un hôte glissé dans un fichier de plus (une
// doc de code, une page du site public, un script) est un établissement
// public que l'app contacterait sans que personne ne l'ait voulu.
//
// Le parcours est celui PARTAGÉ (`listFiles`) : il exclut les artefacts
// générés et gère les erreurs fichier par fichier (#418, #532).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles } from "../../agents/runtime/check-architecture";

const ROOT = join(import.meta.dir, "..", "..");

/** Le module qui parle à l'établissement : le seul endroit où l'hôte est toléré. */
const MODULE = join(ROOT, "android", "pronote") + "/";

/** Les tests citent l'hôte (fixtures, ce fichier) : ils ne sont pas du produit. */
const TESTS = join(ROOT, "tests") + "/";

/** L'hôte du site de démonstration (le domaine réel de l'éditeur). */
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
    // L'adresse, l'identifiant et le mot de passe PUBLICS du compte de
    // démonstration : c'est ce qui permet la connexion en un clic.
    expect(source).toContain(`const val URL = "https://${DEMO_HOST}/`);
    expect(source).toMatch(/const val LOGIN = "[^"]+"/);
    expect(source).toMatch(/const val PASSWORD = "[^"]+"/);
    // ...et la session s'ouvre par le client du module.
    expect(source).toContain("Client.login(");
    // Le client expose la session de démo au dépôt (symétrique de
    // `qrcodeLogin`) : c'est le client qui ouvre la session.
    const client = readFileSync(
      join(MODULE, "src", "main", "java", "fr", "veryslopnynotes", "pronote", "Client.kt"),
      "utf8",
    );
    expect(client).toContain("fun demoLogin(): Client = DemoSchool.login()");
  });
});
