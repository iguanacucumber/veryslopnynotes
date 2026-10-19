// #401 : l'échec du Keystore ne doit PLUS être avalé en silence.
//
// AVANT : `SessionStores.newStore` et `LlmKeys.newStore` faisaient
// `catch (_: Exception) { InMemorySessionStore() }` — ni log, ni message, ni
// état. Conséquence : un Keystore invalidé (écran de verrouillage changé,
// appareil verrouillé depuis le démarrage) faisait croire à l'app qu'elle
// n'était pas appairée, et la clé de l'assistant disparaissait sans un mot.
//
// CE QUE CE TEST PROUVE (trois niveaux) :
//   1. la DÉCISION et l'ÉTAT, sur le VRAI Kotlin exécuté (`StoreHealth.kt`
//      est compilé par le port de parité) : un Keystore mort produit
//      `UNAVAILABLE`, un état EXPLICITE, et il reste tel quel ;
//   2. le CÂBLAGE : les deux `catch` appellent bien `SecureStorage
//      .markUnavailable()` — sans quoi la décision pure serait orpheline et
//      l'échec resterait muet ;
//   3. la PUBLICATION : le pont publie l'état (`storage`) et le journalise —
//      dans le PONT, jamais dans les stores (ils tiennent le jeton et la
//      clé) et sans aucun secret.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "StoreHealthMain.kt");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask(op: unknown): Promise<string> {
  return link!.ask(op);
}

/** L'état du stockage tel que le pont le publierait. */
async function kotlinHealth(op: unknown): Promise<string> {
  const res = JSON.parse(await ask(op)) as { health: string };
  return res.health;
}

function source(file: string): string {
  // SANS les commentaires : un mot de secret cité en prose (dans un KDoc)
  // ne doit pas faire échouer la garde du journal.
  return codeOnly(readFileSync(file, "utf8"));
}

/** Le `catch` du store : son corps, jusqu'à l'accolade qui le ferme. */
function catchBody(src: string): string {
  const start = src.indexOf("catch (");
  if (start < 0) return "";
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

describe("stockage chiffré : l'échec du Keystore est signalé (#401)", () => {
  test.skipIf(skip)("le Keystore mort produit un état EXPLICITE, pas un silence (Kotlin)", async () => {
    // Le Keystore répond : rien à signaler.
    expect(await kotlinHealth({ op: "decision", keystoreAvailable: true })).toBe("AVAILABLE");
    // Le Keystore échoue : l'état dégradé est produit — c'est lui qui est
    // publié à l'interface. Avant, l'app n'apprenait RIEN de cet échec.
    expect(await kotlinHealth({ op: "decision", keystoreAvailable: false })).toBe("UNAVAILABLE");
  });

  test.skipIf(skip)("l'état dégradé est-collé et lisible par le pont (Kotlin)", async () => {
    // Avant l'échec : l'état nominal.
    expect(await kotlinHealth({ op: "state" })).toBe("AVAILABLE");
    // L'échec est enregistré (le `catch` des stores appelle ça).
    expect(await kotlinHealth({ op: "fail" })).toBe("UNAVAILABLE");
    // Il RESTE dégradé : le repli mémoire ne se réinstalle pas tout seul, et
    // l'interface doit continuer à dire que rien n'est conservé.
    expect(await kotlinHealth({ op: "state" })).toBe("UNAVAILABLE");
  });

  test("les deux `catch` de store MARQUENT l'échec (ils ne l'avalent plus)", () => {
    for (const file of ["SessionStore.kt", "LlmKeyStore.kt"]) {
      const body = catchBody(source(join(DATA, file)));
      expect(body.length).toBeGreaterThan(0);
      // Le cœur du correctif : l'échec est transformé en état.
      expect(body).toContain("SecureStorage.markUnavailable()");
      // Le repli mémoire reste (jamais un secret en clair) : l'app continue
      // de fonctionner, elle ne perd que la CONSERVATION.
      expect(body).toContain("InMemory");
    }
  });

  test("le journal est dans le PONT (jamais à côté d'un secret) et il est borné", () => {
    // Les stores ne journalisent PAS : ils tiennent le jeton et la clé, la
    // règle du dépôt est « jamais de log à côté d'un secret » (pin sur
    // `SessionStore.kt`). Le diagnostic, c'est l'ÉTAT publié.
    for (const file of ["SessionStore.kt", "LlmKeyStore.kt"]) {
      expect(source(join(DATA, file))).not.toMatch(/Log\.[vdiew]\(|println\(|printStackTrace/);
    }
    // Le pont, lui, journalise l'état — une fois, au démarrage.
    const bridge = source(join(APP, "VsnBridge.kt"));
    expect(bridge).toMatch(/Log\.w\(TAG,/);
    // ...et seulement en cas de dégradation (pas à chaque démarrage).
    expect(bridge).toMatch(/if\s*\(SecureStorage\.health\(\)\s*==\s*StoreHealth\.UNAVAILABLE\)/);
    // ...sans secret, sans chemin, sans hôte : l'état, c'est tout.
    const log = /Log\.w\(TAG,\s*"([^"]*)"/.exec(bridge)?.[1] ?? "";
    expect(log.length).toBeGreaterThan(0);
    expect(log).not.toMatch(/apiKey|password|jeton|login|endpoint|https?:\/\/|\/data\/|message/);
  });

  test("le pont PUBLIE l'état du stockage (l'interface peut l'afficher)", () => {
    const bridge = source(join(APP, "VsnBridge.kt"));
    // L'état dégradé est publié avec le statut de session ET de restauration.
    expect(bridge).toMatch(/put\("storage", storageState\(\)\)/);
    // L'état vient bien de la décision Kotlin, pas d'un texte en dur côté pont.
    expect(bridge).toContain("SecureStorage.health()");
  });
});
