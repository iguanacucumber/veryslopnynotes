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
  test("clearAccountData retire TOUTE clé du compte, pas le drapeau d'invitation", () => {
    // Les clés de compte : celles que le companion déclare, sauf `prompt_seen`
    // (un réglage d'interface, jamais une donnée du compte).
    const keys = [...manual.matchAll(/private const val (KEY_[A-Z_]+) = "[a-z_]+"/g)]
      .map((m) => m[1]!)
      .filter((key) => key !== "KEY_PROMPT_SEEN");
    // Adresse, extraits, classe, matières vues, matières désactivées.
    expect(keys).toEqual([
      "KEY_URL",
      "KEY_DOCS",
      "KEY_CLASS_LABEL",
      "KEY_SUBJECTS",
      "KEY_DISABLED_SUBJECTS",
    ]);
    const purge = bodyOf(manual, "fun clearAccountData()");
    expect(purge.length).toBeGreaterThan(0);
    for (const key of keys) expect(purge).toContain(`.remove(${key})`);
    // Un rappel intempestif à chaque bascule serait un défaut : le drapeau reste.
    expect(purge).not.toContain("KEY_PROMPT_SEEN");
  });

  test("« Oublier » garde le drapeau vu (comportement inchangé)", () => {
    const clear = bodyOf(manual, "fun clear()");
    expect(clear).toContain("?.putBoolean(KEY_PROMPT_SEEN, true)");
  });
});

describe("pont — la purge part avec celle du cache, jamais au redémarrage", () => {
  test("déconnexion et session morte purgent le manuel AVANT la session", () => {
    const purge = bodyOf(bridge, "private fun purgeManualAccountData()");
    expect(purge).toContain("manuals.clearAccountData()");
    // Une adresse de manuel oubliée est de la donnée de compte : elle part aussi.
    expect(purge).toContain("manualFailures.clear()");

    for (const signature of ["private fun logout()", "private fun onSessionRejected()"]) {
      const path = bodyOf(bridge, signature);
      const at = path.indexOf("purgeManualAccountData()");
      // La purge est là…
      expect(at).toBeGreaterThan(-1);
      // …et AVANT `accounts.logout()` : si la purge de session jette (Keystore
      // mort), le manuel est déjà parti (fail-safe).
      expect(at).toBeLessThan(path.indexOf("accounts.logout()"));
    }
  });

  test("session morte à la restauration et appairage d'un AUTRE compte purgent aussi", () => {
    // Restauration : la branche `Dead` a déjà purgé le cache dans
    // `PairingRepository`, elle purge le manuel ici.
    const restore = bodyOf(bridge, "private fun restoreSession()");
    expect(restore).toContain("is RestoreResult.Dead");
    const dead = restore.slice(restore.indexOf("is RestoreResult.Dead"));
    expect(dead).toContain("purgeManualAccountData()");

    // Appairage : MÊME comparaison d'identité que `CacheScope.switchAccount`
    // (le manuel n'est pas connu de `PairingRepository`), appliquée aux deux
    // entrées (QR et démonstration).
    const changed = bodyOf(bridge, "private fun purgeManualIfAccountChanged(");
    expect(changed).toContain("storedIdentity()");
    expect(changed).toContain("sameAccount(next)");
    // Identité inconnue = purge (fail-closed, comme le cache).
    expect(changed).toMatch(/previous == null \|\| next == null/);
    expect(changed).toContain("purgeManualAccountData()");
    for (const signature of ["private fun pair(p: JSONObject)", "private fun pairDemo()"]) {
      expect(bodyOf(bridge, signature)).toContain("purgeManualIfAccountChanged(previous)");
    }
    // L'identité est prise AVANT l'appairage (sinon elle décrit déjà le neuf).
    const pair = bodyOf(bridge, "private fun pair(p: JSONObject)");
    expect(pair.indexOf("val previous = storedIdentity()")).toBeLessThan(
      pair.indexOf("pairBlocking("),
    );
  });

  test("un redémarrage ordinaire ne purge RIEN", () => {
    // `Restored` / `NoSession` / `Offline` : la session (ou son absence) ne
    // change pas de compte — l'utilisateur doit retrouver son manuel.
    const restore = bodyOf(bridge, "private fun restoreSession()");
    const deadAt = restore.indexOf("is RestoreResult.Dead");
    expect(deadAt).toBeGreaterThan(-1);
    const ordinary = restore.slice(0, deadAt);
    expect(ordinary).not.toContain("purgeManualAccountData()");
    expect(ordinary).not.toContain("purgeManualIfAccountChanged(");
    // La SEULE purge de ce chemin est la branche `Dead`.
    expect(restore.split("purgeManualAccountData()").length - 1).toBe(1);
  });
});
