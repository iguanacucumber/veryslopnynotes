import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forceReload } from "../../web/src/lib/refresh";

// #365 : le geste de rafraîchissement est un DELTA, pas un absolu.
//
// Avant : `force = manual > 0 || refreshTick > 0`, deux compteurs monotones
// jamais remis à zéro. Après le PREMIER geste, `force` restait `true` pour
// toujours (chaque ouverture d'écran relisait le client local) et un
// changement de requête ne forçait jamais.
//
// La règle testée ici : on force quand le geste a changé depuis le dernier
// chargement, ou quand la requête a changé ; la première entrée sur un écran
// n'est pas un geste.
const ROOT = join(import.meta.dir, "..", "..");

const base = { query: "", manual: 0, tick: 0 };

describe("geste de rechargement = delta (#365)", () => {
  test("la première entrée sur un écran n'est PAS un geste", () => {
    expect(forceReload(null, base)).toBe(false);
    expect(forceReload(null, { query: "weekStart=2026-10-19", manual: 0, tick: 0 })).toBe(false);
  });

  test("un rechargement sans changement de requête ni de geste ne force pas", () => {
    const last = { query: "weekStart=2026-10-19", manual: 0, tick: 0 };
    expect(forceReload(last, { ...last })).toBe(false);
  });

  test("un changement de requête force la relecture", () => {
    const last = { query: "weekStart=2026-10-19", manual: 0, tick: 0 };
    expect(forceReload(last, { ...last, query: "weekStart=2026-10-26" })).toBe(true);
    // Période / algorithme : idem.
    expect(forceReload({ ...base, query: "algorithm=subject" }, { ...base, query: "algorithm=weighted" })).toBe(true);
  });

  test("après un geste, le chargement SUIVANT sans nouveau geste ne force plus", () => {
    const last = { query: "", manual: 0, tick: 0 };
    const geste = { query: "", manual: 1, tick: 0 };
    // Le geste force…
    expect(forceReload(last, geste)).toBe(true);
    // …et il est consommé : le chargement suivant ne force plus (le compteur
    // ne doit pas rester collé à `true`).
    expect(forceReload(geste, geste)).toBe(false);
    expect(forceReload(geste, { ...geste, query: "weekStart=2026-10-19" })).toBe(true);
  });

  test("le geste global (bouton « Actualiser ») force, puis se consomme", () => {
    const last = { query: "", manual: 0, tick: 0 };
    const geste = { query: "", manual: 0, tick: 1 };
    expect(forceReload(last, geste)).toBe(true);
    expect(forceReload(geste, geste)).toBe(false);
  });

  test("le câblage ne rebruit plus le compteur", () => {
    const source = readFileSync(join(ROOT, "web/src/ui/AppContext.tsx"), "utf8");
    expect(source).toContain("forceReload");
    expect(source).not.toContain("manual > 0 || refreshTick > 0");
  });
});
