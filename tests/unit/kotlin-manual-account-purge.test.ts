// #749 — le manuel de l'élève est la donnée d'UN compte (I16).
//
// Le manuel (adresse choisie, extraits déjà récupérés, classe, matières) était
// rangé dans des préférences qui SURVIVAIENT à la déconnexion : après une
// bascule de compte, B recevait le manuel et la classe de A dans
// `aiContextFor` / `manualDocFor`.
//
// `ManualStore` lit `SharedPreferences` (API Android) : impossible de
// l'exécuter hors Gradle, et il n'y a pas de faux-prefs dans le dépôt. La
// régression est donc étroite et portée sur le code réel : la PURGE elle-même
// (toutes les clés de compte, pas le drapeau d'invitation) et son CÂBLAGE sur
// chaque chemin qui purge déjà le cache.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { ROOT } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const BRIDGE = join(
  ROOT,
  "android",
  "app",
  "src",
  "main",
  "java",
  "fr",
  "veryslopnynotes",
  "app",
  "VsnBridge.kt",
);

/** Corps d'une fonction/méthode `fun <nom>(`, accolades équilibrées. */
function bodyOf(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) return "";
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

const manual = codeOnly(readFileSync(join(DATA, "Manuals.kt"), "utf8"));
const bridge = codeOnly(readFileSync(BRIDGE, "utf8"));

describe("manuel — purge de compte (I16)", () => {
  test("clearAccountData efface le fichier durable, sa sauvegarde et sa quarantaine", () => {
    // Le manuel est un fichier JSON dans `offline/` : la purge de compte
    // supprime la cible, `.bak` ET les copies `quarantine/` — une version
    // antérieure ne doit pas rendre le manuel du compte précédent.
    const purge = bodyOf(manual, "fun clearAccountData()");
    expect(purge.length).toBeGreaterThan(0);
    expect(purge).toContain("DurableFile.delete(it)");
    // Un rappel intempestif à chaque bascule serait un défaut : le drapeau
    // d'invitation reste dans les préférences, hors de ce fichier.
    expect(purge).not.toContain("KEY_PROMPT_SEEN");
  });

  test("« Oublier » garde le drapeau vu (comportement inchangé)", () => {
    const clear = bodyOf(manual, "fun clear()");
    expect(clear).toContain("?.putBoolean(KEY_PROMPT_SEEN, true)");
  });
});

describe("pont — la purge part avec celle du cache, jamais au redémarrage", () => {
  test("l'orchestrateur purge le manuel et ses adresses essayées", () => {
    const factory = codeOnly(readFileSync(join(DATA, "AccountPurgeFactory.kt"), "utf8"));
    expect(factory).toContain("AccountDataStore.MANUAL");
    expect(factory).toContain("targets.manuals.clearAccountData()");
    // Une adresse de manuel oubliée est de la donnée de compte : elle part aussi.
    expect(factory).toContain("targets.onManualPurged()");

    const bridge = codeOnly(readFileSync(BRIDGE, "utf8"));
    // Le pont ne refait pas une seconde purge à côté de l'orchestrateur.
    expect(bridge).not.toContain("purgeManualAccountData");
    expect(bridge).toContain("onManualPurged = { manualFailures.clear() }");
    for (const signature of ["private fun logout()", "private fun onSessionRejected()"]) {
      const path = bodyOf(bridge, signature);
      expect(path).toContain("pairing.logoutBlocking()");
      expect(path).not.toContain("manuals.clearAccountData()");
    }
  });

  test("session morte et bascule purgent par le MÊME orchestrateur", () => {
    const bridge = codeOnly(readFileSync(BRIDGE, "utf8"));
    const restore = bodyOf(bridge, "private fun restoreSession()");
    expect(restore).toContain("is RestoreResult.Dead");
    const dead = restore.slice(restore.indexOf("is RestoreResult.Dead"));
    expect(dead).not.toContain("purgeManualAccountData()");

    const pairing = codeOnly(readFileSync(join(DATA, "PairingRepository.kt"), "utf8"));
    expect(pairing).toContain("AccountPurgeMode.SESSION_DEAD");
    expect(pairing).toContain("AccountPurgeMode.ACCOUNT_SWITCH");
    // Identité inconnue = purge (fail-closed), et la purge précède la publication.
    expect(pairing).toMatch(/previous != null && current != null && previous\.sameAccount\(current\)/);
    const iPurge = pairing.indexOf("AccountPurgeMode.ACCOUNT_SWITCH");
    const iPublish = pairing.indexOf("AccountSwitch(previous, current) { PronoteSession.set(client) }");
    expect(iPurge).toBeGreaterThan(-1);
    expect(iPublish).toBeGreaterThan(iPurge);
  });

  test("un redémarrage ordinaire ne purge RIEN", () => {
    const restore = bodyOf(bridge, "private fun restoreSession()");
    const firstPurge = restore.indexOf("is RestoreResult.Incomplete");
    const deadAt = restore.indexOf("is RestoreResult.Dead");
    expect(firstPurge).toBeGreaterThan(-1);
    expect(deadAt).toBeGreaterThan(-1);
    const ordinary = restore.slice(0, firstPurge);
    expect(ordinary).not.toContain("purgeManualAccountData()");
    expect(ordinary).not.toContain("logoutBlocking()");
    // Incomplète ET morte passent par l'orchestrateur central : aucune purge
    // locale dans le pont.
    expect(restore).not.toContain("purgeManualAccountData()");
  });
});
