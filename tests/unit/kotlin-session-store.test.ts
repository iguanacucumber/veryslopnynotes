// #862 — une ancienne session ne doit pas ressusciter.
//
// Deux fuites corrigées, testées sur le VRAI Kotlin exécuté
// (`android/data/SessionFallback.kt`, fichier pur compilé par la parité) :
//   1. Keystore mort au démarrage : le repli mémoire laissait le fichier
//      chiffré sur le disque. Un logout dégradé ne l'effaçait pas, et au
//      lancement suivant (Keystore réparé) l'ancienne session revenait ;
//   2. Keystore qui lâche après l'init : `load()/clear()` jetaient, donc la
//      session restait sur le disque sans moyen de l'effacer.
//
// Le câblage Android (effacement du fichier, jet de l'instance en cache) ne
// compile pas hors Gradle : il est vérifié par lecture de source.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation est un défaut (le test rougit).
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "SessionStoreParityMain.kt");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

afterAll(async () => {
  if (!link) return;
  try {
    await link.ask({ op: "cleanup" });
  } catch {
    // le pilote est déjà mort : rien à nettoyer.
  }
});

async function ask<T>(op: unknown): Promise<T> {
  return JSON.parse(await link!.ask(op)) as T;
}

function source(name: string): string {
  return codeOnly(readFileSync(join(DATA, name), "utf8"));
}

describe("SessionStoreTest : une session déconnectée ne ressuscite pas (#862)", () => {
  test.skipIf(skip)("dégradé → logout → sain ne voit rien", async () => {
    const res = await ask<{
      discards: number;
      afterFallbackKeys: string[];
      logout: string;
      nextLaunch: string;
      health: string;
    }>({ op: "degraded-logout-healthy" });
    // Le repli efface le chiffré dès la construction…
    expect(res.discards).toBeGreaterThanOrEqual(1);
    expect(res.afterFallbackKeys).toEqual([]);
    // …le logout dégradé aboutit…
    expect(res.logout).toBe("written");
    // …et un store sain NEUF sur le même disque ne trouve RIEN.
    expect(res.nextLaunch).toBe("absent");
    // L'état dégradé reste publié (#401), jamais silencieux.
    expect(res.health).toBe("UNAVAILABLE");
  });

  test.skipIf(skip)("un premier effacement raté est RÉESSAYÉ au logout", async () => {
    const res = await ask<{
      attempts: number;
      afterFallbackKeys: string[];
      logout: string;
      nextLaunch: string;
    }>({ op: "degraded-logout-retry" });
    // Le repli n'a pas pu effacer : le fichier est encore là…
    expect(res.afterFallbackKeys.length).toBeGreaterThan(0);
    // …mais le logout retente et réussit : rien ne survit.
    expect(res.attempts).toBe(2);
    expect(res.logout).toBe("written");
    expect(res.nextLaunch).toBe("absent");
  });

  test.skipIf(skip)("un effacement impossible est DIT et garde la session", async () => {
    const res = await ask<{
      discards: number;
      logout: string;
      found: boolean;
      nextLaunch: string;
    }>({ op: "clear-failure" });
    // Ni le commit ni l'effacement dur n'ont abouti : l'échec remonte.
    expect(res.discards).toBe(1);
    expect(res.logout).toBe("failed");
    // La session est TOUJOURS là : l'app ne doit pas dire « déconnecté ».
    expect(res.found).toBe(true);
    expect(res.nextLaunch).toBe("complete");
  });

  test.skipIf(skip)("un commit d'effacement raté + fichier supprimé = logout durable", async () => {
    const res = await ask<{ discards: number; logout: string; nextLaunch: string }>({
      op: "clear-failure-disk-deleted",
    });
    // Le commit a échoué mais le fichier chiffré est parti : le logout vaut
    // « written », et le lancement suivant ne voit rien.
    expect(res.discards).toBe(1);
    expect(res.logout).toBe("written");
    expect(res.nextLaunch).toBe("absent");
  });

  test.skipIf(skip)("un Keystore qui lâche après l'init efface le chiffré", async () => {
    const res = await ask<{
      discards: number;
      status: string;
      nextLaunch: string;
      health: string;
    }>({ op: "load-throws" });
    // La lecture ne jette plus : elle retombe en mémoire et efface le chiffré.
    expect(res.discards).toBe(1);
    expect(res.status).toBe("absent");
    expect(res.nextLaunch).toBe("absent");
    expect(res.health).toBe("UNAVAILABLE");
  });
});

describe("SessionStoreTest — câblage Android (#862)", () => {
  test("le repli et l'effacement suppriment le fichier chiffré", () => {
    const store = source("SessionStore.kt");
    // UN store effectif : chiffré quand il répond, mémoire sinon.
    expect(store).toContain("ResilientSessionStore(secure)");
    // Le repli reçoit l'effacement DUR, sans passer par le Keystore.
    expect(store).toContain("discardEncryptedSession(context)");
    expect(store).toContain("deleteSharedPreferences(EncryptedSessionStore.PREFS)");
    // `clear()` ne se contente pas de vider les clés : il supprime le fichier
    // et jette l'instance SharedPreferences qui garde l'ancienne valeur en RAM.
    const clear = store.slice(
      store.indexOf("override fun clear(): WriteResult"),
      store.indexOf("companion object"),
    );
    expect(clear).toContain("discardEncryptedSession(context)");
    expect(clear).toContain("records = null");
    // Toujours aucun repli en clair.
    expect(store).not.toContain("MODE_PRIVATE");
    expect(store).not.toContain("getSharedPreferences(");
    expect(store).not.toMatch(/Log\.[vdiew]\(|println\(|printStackTrace/);
  });

  test("le store effectif est PUR et signale la dégradation", () => {
    const fallback = source("SessionFallback.kt");
    // Aucun import Android : sans ça le harnais ne pourrait pas l'exécuter.
    expect(fallback).not.toMatch(/^import android\./m);
    expect(fallback).toContain("class ResilientSessionStore");
    expect(fallback).toContain("class InMemorySessionStore");
    // L'échec est un ÉTAT (#401), jamais avalé en silence.
    expect(fallback).toContain("SecureStorage.markUnavailable()");
    // Un effacement non garanti remonte comme échec, pas comme succès.
    expect(fallback).toContain('WriteResult.Failed("session non effacée")');
    expect(fallback).not.toMatch(/Log\.|println|printStackTrace/);
  });
});
