// #749 — « Oublier » la clé LLM doit être DURABLE, même Keystore cassé (I18).
//
// DEUX défauts corrigés, et testés sur le VRAI Kotlin exécuté
// (`android/data/LlmKeyFallback.kt`, fichier pur, compilé par la parité) :
//   1. Keystore cassé AU DÉMARRAGE : le repli mémoire ne vidait que la
//      mémoire, la clé chiffrée restait sur le disque et revenait au lancement
//      suivant ;
//   2. Keystore qui lâche APRÈS l'init : `apiKey()/save()/clear()` jetaient,
//      donc « Oublier » devenait impossible.
//
// Le câblage Android (Keystore, effacement du fichier) ne compile pas hors
// Gradle : il est vérifié par lecture de source, comme les autres ponts.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "LlmKeyFallbackMain.kt");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask<T>(op: unknown): Promise<T> {
  return JSON.parse(await link!.ask(op)) as T;
}

function source(name: string): string {
  return codeOnly(readFileSync(join(DATA, name), "utf8"));
}

describe("clé LLM — « Oublier » survit à un Keystore mort (#749)", () => {
  test.skipIf(skip)("démarrage dégradé : la clé se saisit, l'oublier efface le chiffré", async () => {
    const res = await ask<{
      saved: string | null;
      configured: boolean;
      afterForget: string | null;
      discards: number;
      nextLaunch: string | null;
      health: string;
    }>({ op: "degraded" });
    // Repli mémoire : la clé collée (espaces compris) reste utilisable.
    expect(res.saved).toBe("cle-du-compte-b");
    expect(res.configured).toBe(true);
    // « Oublier » la vide…
    expect(res.afterForget).toBeNull();
    // …ET efface le fichier chiffré, illisible mais bien présent sur disque.
    expect(res.discards).toBe(1);
    // Lancement suivant, Keystore réparé : la clé de l'ancien compte ne
    // ressuscite pas. C'était le défaut : elle revenait.
    expect(res.nextLaunch).toBeNull();
    // L'état dégradé est SIGNALÉ, pas silencieux (#401).
    expect(res.health).toBe("UNAVAILABLE");
  });

  test.skipIf(skip)("un échec APRÈS l'init ne fait plus jeter : la clé saisie reste utilisable", async () => {
    const res = await ask<{ threw: boolean; apiKey: string | null; discards: number; health: string }>({
      op: "save-throws",
    });
    expect(res.threw).toBe(false);
    expect(res.apiKey).toBe("cle-1");
    // L'ancienne entrée du disque est périmée : elle part pour ne pas
    // ressusciter au lancement suivant avec une clé que l'UI n'affiche plus.
    expect(res.discards).toBe(1);
    expect(res.health).toBe("UNAVAILABLE");
  });

  test.skipIf(skip)("un échec de lecture retombe sur la mémoire, sans jeter", async () => {
    const res = await ask<{ before: string | null; after: string | null; discards: number }>({
      op: "read-throws",
    });
    expect(res.before).toBeNull();
    expect(res.after).toBe("cle-b");
    expect(res.discards).toBe(0);
  });

  test.skipIf(skip)("« Oublier » ne jette plus et reste DURABLE après l'init", async () => {
    const res = await ask<{
      threw: boolean;
      apiKey: string | null;
      discards: number;
      nextLaunch: string | null;
      health: string;
    }>({ op: "clear-throws" });
    expect(res.threw).toBe(false);
    expect(res.apiKey).toBeNull();
    expect(res.discards).toBe(1);
    // La preuve qui compte : un store NEUF sur le même fichier ne voit rien.
    expect(res.nextLaunch).toBeNull();
    expect(res.health).toBe("UNAVAILABLE");
  });

  test.skipIf(skip)("un commit() qui rend false n'enregistre pas en douce : repli mémoire + chiffré effacé", async () => {
    const res = await ask<{
      threw: boolean;
      apiKey: string | null;
      discards: number;
      nextLaunch: string | null;
      health: string;
    }>({ op: "save-commit-false" });
    expect(res.threw).toBe(false);
    // La clé saisie reste utilisable pour la session en cours…
    expect(res.apiKey).toBe("cle-1");
    // …et l'ancienne entrée du disque ne reste pas l'autorité.
    expect(res.discards).toBe(1);
    expect(res.nextLaunch).toBeNull();
    expect(res.health).toBe("UNAVAILABLE");
  });

  test.skipIf(skip)("un commit() qui rend false sur « Oublier » efface quand même le fichier", async () => {
    const res = await ask<{
      threw: boolean;
      apiKey: string | null;
      discards: number;
      nextLaunch: string | null;
      health: string;
    }>({ op: "clear-commit-false" });
    expect(res.threw).toBe(false);
    expect(res.apiKey).toBeNull();
    // L'écriture synchrone a échoué : l'effacement dur est le seul recours.
    expect(res.discards).toBe(1);
    // La preuve qui compte : rien ne ressuscite au lancement suivant.
    expect(res.nextLaunch).toBeNull();
    expect(res.health).toBe("UNAVAILABLE");
  });

  test.skipIf(skip)("Keystore sain : l'effacement chiffré suffit, pas d'effacement dur", async () => {
    const res = await ask<{ apiKey: string | null; discards: number; nextLaunch: string | null }>({
      op: "healthy-clear",
    });
    expect(res.apiKey).toBeNull();
    expect(res.discards).toBe(0);
    expect(res.nextLaunch).toBeNull();
  });

  test.skipIf(skip)("une clé invalide est refusée AVANT tout état", async () => {
    const res = await ask<{
      errors: string[];
      stored: string | null;
      configured: boolean;
      discards: number;
    }>({ op: "invalid" });
    // Mêmes bornes que le contrat : vide et trop longue.
    expect(res.errors).toEqual(["IllegalArgumentException", "IllegalArgumentException"]);
    // Rien d'écrit, et le refus ne dégrade pas le stockage.
    expect(res.stored).toBeNull();
    expect(res.configured).toBe(false);
    expect(res.discards).toBe(0);
  });
});

describe("clé LLM — câblage Android (#749)", () => {
  test("« Oublier » efface le fichier chiffré sans passer par le Keystore", () => {
    const store = source("LlmKeyStore.kt");
    // Un seul store de process, comme avant.
    expect(store).toContain("object LlmKeys");
    expect(store).toMatch(/@Volatile/);
    // Le repli effectif : chiffré s'il répond, mémoire sinon.
    expect(store).toContain("ResilientLlmKeyStore(secure)");
    // L'effacement durable : le fichier chiffré part même illisible.
    expect(store).toContain("deleteSharedPreferences(EncryptedLlmKeyStore.PREFS)");
    // Toujours AUCUNE prefs simple : la clé ne doit jamais être en clair.
    expect(store).not.toMatch(/getSharedPreferences/);
    expect(store).not.toMatch(/Log\.|println|printStackTrace/);
  });

  test("enregistrer et oublier sont DURABLES : commit() vérifié, jamais apply()", () => {
    const store = source("LlmKeyStore.kt");
    // `apply()` rend la main AVANT le disque : un force-stop juste après
    // « clé enregistrée » la perdait, et juste après « Oublier » la laissait
    // ressusciter au lancement suivant. Les deux écritures chiffrées sont donc
    // synchrones.
    expect(store).not.toMatch(/\.apply\(\)/);
    expect(store.match(/\.commit\(\)/g)).toHaveLength(2);
    // `commit()` rend un Boolean : les deux appels en font un échec dur, que le
    // repli traduit en dégradation + effacement du fichier.
    expect(store.match(/check\(\s*prefs\.edit\(\)[\s\S]*?\.commit\(\)\s*\)/g)).toHaveLength(2);
  });

  test("le repli est PUR (exécuté par la parité) et ne journalise rien", () => {
    const policy = source("LlmKeyFallback.kt");
    // Aucun import Android : sans ça le harnais ne pourrait pas l'exécuter.
    expect(policy).not.toMatch(/^import android\./m);
    expect(policy).not.toMatch(/Log\.|println|printStackTrace/);
    // Le repli mémoire existe bien, et il est le SEUL autre support.
    expect(policy).toContain("class InMemoryLlmKeyStore");
    expect(policy).toContain("class ResilientLlmKeyStore");
    // L'échec est un ÉTAT (#401) : marqué, jamais avalé en silence.
    expect(policy).toContain("SecureStorage.markUnavailable()");
  });
});
