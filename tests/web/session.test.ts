import { describe, expect, test } from "bun:test";
import { mustPair } from "../../web/src/lib/session";

describe("session web", () => {
  test("une session ouverte prime sur le statut lu au démarrage", () => {
    // Sans cela, l'app renvoie vers /pairing après un appairage réussi :
    // impossible d'atteindre le menu principal sans redémarrer (#357).
    expect(mustPair({ status: { state: "no_session" }, open: true, expired: false })).toBe(false);
    expect(mustPair({ status: { state: "dead" }, open: true, expired: false })).toBe(false);
    expect(mustPair({ status: { state: "no_session" }, open: true, expired: true })).toBe(false);
  });

  test("pas de session ou session morte : l'appairage s'impose", () => {
    expect(mustPair({ status: { state: "no_session" }, open: false, expired: false })).toBe(true);
    expect(mustPair({ status: { state: "dead" }, open: false, expired: false })).toBe(true);
  });

  test("session expirée (401) : l'appairage s'impose", () => {
    expect(mustPair({ status: { state: "restored" }, open: false, expired: true })).toBe(true);
  });

  test("session ouverte, hors ligne ou inconnue : l'app reste utilisable", () => {
    expect(mustPair({ status: { state: "restored" }, open: false, expired: false })).toBe(false);
    expect(mustPair({ status: { state: "offline" }, open: false, expired: false })).toBe(false);
    expect(mustPair({ status: null, open: false, expired: false })).toBe(false);
  });
});
