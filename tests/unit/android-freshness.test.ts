// #311 : « ne pas refetcher un cache frais » — la règle PURE
// (`CachePolicy.shouldFetch`), son point d'application
// (`SyncedRepository.refreshAsync`) et les points d'appel des écrans.
//
// Le miroir TS rejoue le chemin de lecture avec un client COMPTÉ : c'est lui qui
// prouve le critère « zéro appel client », la lecture de la source ne prouvant
// que le câblage. Les deux sont nécessaires : un miroir vert sur un dépôt qui ne
// l'appelle pas ne servirait à rien.
//
// Ce que le fichier verrouille :
//   1. cache frais + force=false ⇒ AUCUN appel au client local ;
//   2. cache périmé, cache absent ou force=true ⇒ appel ;
//   3. le cache servi est daté de SON `fetchedAt` (jamais « maintenant ») ;
//   4. la première entrée sur un écran n'est pas un geste, le tirail / le bouton
//      « Actualiser » / le changement de semaine ou de période en est un ;
//   5. le chemin « autre semaine » (`fetchAsync`, sans écriture cache) n'est PAS
//      soumis à la règle : la fenêtre affichée n'est pas celle du cache.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_TTL_MS } from "../../shared/contracts/cache";
import type { CacheableResource } from "../../shared/contracts/cache";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const UI = join(ROOT, "android", "ui", "src", "main", "java", "fr", "veryslopnynotes", "ui");
const POLICY = join(DATA, "CachePolicy.kt");
const REPO = join(DATA, "SyncedRepository.kt");

const read = (path: string): string => readFileSync(path, "utf8");
/** Un fichier d'écran, sans ses commentaires (une garde de source ne doit pas
 *  confondre un `//` qui NOMME un appel avec l'appel lui-même). */
const screen = (file: string): string => codeOnly(read(join(UI, file)));

// --- Miroir du chemin de lecture `SyncedRepository.refreshAsync` (#311) ---

type Entry = { payload: string; fetchedAt: number };
type Outcome = { kind: "updated"; payload: string; fetchedAt: number };

/** Miroir de `CachePolicy.shouldFetch` (borne `> TTL`, comme `isStale`). */
function shouldFetch(entry: Entry | null, resource: CacheableResource, now: number, force: boolean): boolean {
  return force || entry === null || now - entry.fetchedAt > CACHE_TTL_MS[resource];
}

/** `client.reads` = nombre de lectures du client local : le critère de #311. */
function refreshAsync(
  client: { reads: number },
  store: { entry: Entry | null },
  resource: CacheableResource,
  now: number,
  force: boolean,
): Outcome {
  const entry = store.entry;
  if (entry !== null && !shouldFetch(entry, resource, now, force)) {
    // Servi par le cache, daté de SON écriture : annoncer `now` ferait passer
    // une donnée ancienne pour fraîche (le badge « périmé » deviendrait faux).
    return { kind: "updated", payload: entry.payload, fetchedAt: entry.fetchedAt };
  }
  client.reads += 1;
  const payload = `lu:${resource}`;
  store.entry = { payload, fetchedAt: now };
  return { kind: "updated", payload, fetchedAt: now };
}

describe("fraîcheur avant relecture du client local (#311)", () => {
  const cas = { payload: "cache", fetchedAt: 1_000 } satisfies Entry;

  test("cache frais + force=false ⇒ zéro appel client", () => {
    const client = { reads: 0 };
    const store = { entry: { ...cas } };
    const o = refreshAsync(client, store, "grades", 1_000 + CACHE_TTL_MS.grades, false);
    expect(client.reads).toBe(0);
    // Et la donnée rendue est celle du cache, avec l'âge du cache.
    expect(o).toEqual({ kind: "updated", payload: "cache", fetchedAt: 1_000 });
  });

  test("cache frais + force=true ⇒ appel (geste explicite)", () => {
    const client = { reads: 0 };
    const store = { entry: { ...cas } };
    const o = refreshAsync(client, store, "grades", 1_000, true);
    expect(client.reads).toBe(1);
    expect(o).toEqual({ kind: "updated", payload: "lu:grades", fetchedAt: 1_000 });
  });

  test("cache périmé ⇒ appel", () => {
    const client = { reads: 0 };
    const store = { entry: { ...cas } };
    refreshAsync(client, store, "grades", 1_000 + CACHE_TTL_MS.grades + 1, false);
    expect(client.reads).toBe(1);
  });

  test("pas de cache ⇒ appel", () => {
    const client = { reads: 0 };
    const store: { entry: Entry | null } = { entry: null };
    const o = refreshAsync(client, store, "timetable", 5_000, false);
    expect(client.reads).toBe(1);
    expect(o.fetchedAt).toBe(5_000);
  });

  test("deux entrées d'écran dans le TTL = UNE seule lecture (l'objectif du #311)", () => {
    const client = { reads: 0 };
    const store = { entry: { ...cas } };
    for (let i = 0; i < 5; i++) refreshAsync(client, store, "grades", 1_000 + 1_000 * i, false);
    expect(client.reads).toBe(0);
  });
});

describe("câblage Kotlin (#311)", () => {
  test("CachePolicy : la règle est PURE (aucun import SDK) et réutilise isStale", () => {
    const policy = read(POLICY);
    expect(policy).toContain(
      "fun shouldFetch(entry: CachedEntry?, resource: String, now: Long, force: Boolean): Boolean =",
    );
    expect(policy).toContain("force || entry == null || isStale(resource, entry.fetchedAt, now)");
    expect(policy).not.toContain("import android.");
  });

  test("refreshAsync : la porte est AVANT la lecture, et le cache est daté", () => {
    const repo = codeOnly(read(REPO));
    const refresh = repo.slice(repo.indexOf("fun refreshAsync("), repo.indexOf("fun fetchAsync("));
    expect(refresh).toContain("force: Boolean = false");
    expect(refresh).toContain("CachePolicy.shouldFetch(entry, resource, clock(), force)");
    // Le cache est rendu par le MÊME chemin de callback (main thread), et daté
    // de son écriture — pas de « maintenant ».
    expect(refresh).toContain("post(cb, RefreshOutcome.Updated(entry.payload, entry.fetchedAt))");
    expect(refresh).toContain("readAsync(save = true, resource = resource, query = query, cb = cb)");
    // L'ordre EST la garantie : lire le client d'abord rendrait la porte inutile.
    expect(refresh.indexOf("shouldFetch")).toBeLessThan(refresh.indexOf("readAsync(save = true"));
  });

  test("fetchAsync (autre semaine, sans écriture cache) n'est PAS soumis à la règle", () => {
    const repo = codeOnly(read(REPO));
    const fetch = repo.slice(repo.indexOf("fun fetchAsync("), repo.indexOf("private fun readAsync("));
    expect(fetch).not.toContain("shouldFetch");
    expect(fetch).not.toContain("force");
  });
});

describe("points d'appel (#311) : un geste force, la première entrée non", () => {
  test("aucun écran ne contourne la règle : chaque `repo.refreshAsync` passe `force`", () => {
    const calls = readdirSync(UI)
      .filter((f) => f.endsWith(".kt"))
      .flatMap((f) => screen(f).split("\n").filter((l) => l.includes("repo.refreshAsync(")));
    // 9 écrans + les capacités d'AppNav : la liste EST le point d'application.
    expect(calls.length).toBe(10);
    for (const line of calls) {
      expect({ call: line.trim(), force: line.includes("force") }).toEqual({ call: line.trim(), force: true });
    }
  });

  test("les écrans à clé unique gardent une première entrée NON forcée", () => {
    for (const f of ["NewsScreen.kt", "CanteenMenus.kt", "MessagesScreen.kt", "SecurityAlertsScreen.kt"]) {
      expect({ screen: f, premiereEntree: screen(f).includes("LaunchedEffect(Unit) { refresh() }") }).toEqual({
        screen: f,
        premiereEntree: true,
      });
    }
  });

  test("écrans à clé d'état (semaine/période/algorithme/relecture) : geste déduit du rejeu", () => {
    // Le premier passage n'est pas un geste ; tout rejeu de l'effet en est un.
    expect(screen("GradesScreen.kt")).toContain("LaunchedEffect(resource, algorithm, periodId, refreshTick) {");
    expect(screen("TimetableWeek.kt")).toContain("LaunchedEffect(weekStart) {");
    expect(screen("Assignments.kt")).toContain("LaunchedEffect(week) {");
    expect(screen("Attendance.kt")).toContain("LaunchedEffect(resource, refreshTick) {");
    for (const f of ["GradesScreen.kt", "TimetableWeek.kt", "Assignments.kt", "Attendance.kt"]) {
      const code = screen(f);
      expect({ screen: f, geste: code.includes("refresh(force = gesture)") }).toEqual({ screen: f, geste: true });
      expect({ screen: f, etat: code.includes("var gesture by remember { mutableStateOf(false) }") }).toEqual({
        screen: f,
        etat: true,
      });
    }
  });

  test("tirail, « Actualiser » et « Réessayer » des écrans forcent la relecture", () => {
    for (const f of [
      "GradesScreen.kt",
      "TimetableWeek.kt",
      "Assignments.kt",
      "Attendance.kt",
      "NewsScreen.kt",
      "CanteenMenus.kt",
      "MessagesScreen.kt",
      "SecurityAlertsScreen.kt",
    ]) {
      expect({ screen: f, geste: screen(f).includes("refresh(force = true)") }).toEqual({ screen: f, geste: true });
    }
    // L'accueil ne relit QUE sur tirail : pas de première entrée à ménager.
    expect(screen("IndexScreen.kt")).toContain("repo.refreshAsync(resource, baseUrl, force = true)");
    // Capacités : la relecture APRÈS le ping est forcée, la première lecture peut
    // venir du cache (24 h de TTL).
    const nav = screen("AppNav.kt");
    expect(nav).toContain("repo.requestSyncRefresh(baseUrl, accountId) { _ -> reload(force = true) }");
    expect(nav).toContain("reload()");
  });

  test("les deux chemins de fenêtre des Devoirs et de l'EDT restent distincts", () => {
    // Semaine courante = cache (#311), autre semaine = fenêtre lue sans écrire.
    expect(screen("Assignments.kt")).toContain('repo.fetchAsync(resource, "weekStart=$week")');
    expect(screen("TimetableWeek.kt")).toContain("repo.fetchAsync(CachePolicy.TIMETABLE, window)");
  });
});
