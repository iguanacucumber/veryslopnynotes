import { describe, expect, test } from "bun:test";
import { beginBusy, isBusy, subscribeBusy } from "../../web/src/lib/busy";

// Le compteur partagé remplace le délai fixe de 650 ms : il doit refléter les
// lectures RÉELLES, y compris quand deux écrans lisent en même temps.
describe("signal d'occupation partagé (#804)", () => {
  test("inactif au repos, actif pendant une lecture", () => {
    expect(isBusy()).toBe(false);
    const end = beginBusy();
    expect(isBusy()).toBe(true);
    end();
    expect(isBusy()).toBe(false);
  });

  test("deux lectures concurrentes : actif jusqu'à la dernière", () => {
    const first = beginBusy();
    const second = beginBusy();
    first();
    expect(isBusy()).toBe(true);
    second();
    expect(isBusy()).toBe(false);
  });

  test("terminer deux fois ne rend pas le compteur négatif", () => {
    const end = beginBusy();
    end();
    end();
    expect(isBusy()).toBe(false);
    const next = beginBusy();
    expect(isBusy()).toBe(true);
    next();
  });

  test("les abonnés ne voient que les transitions 0 → 1 et 1 → 0", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeBusy((busy) => seen.push(busy));
    const first = beginBusy();
    const second = beginBusy();
    first();
    second();
    unsubscribe();
    const after = beginBusy();
    after();
    expect(seen).toEqual([true, false]);
  });
});
