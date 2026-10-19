import { describe, expect, test } from "bun:test";
import { logoutSession, mustPair } from "../../web/src/lib/session";

describe("session web", () => {
  test("une session ouverte prime sur le statut lu au démarrage", () => {
    // Sans cela, l'app renvoie vers /pairing après un appairage réussi :
    // impossible d'atteindre le menu principal sans redémarrer (#357).
    expect(mustPair({ status: { state: "no_session" }, open: true, expired: false, closed: false })).toBe(false);
    expect(mustPair({ status: { state: "dead" }, open: true, expired: false, closed: false })).toBe(false);
    expect(mustPair({ status: { state: "no_session" }, open: true, expired: true, closed: false })).toBe(false);
  });

  test("pas de session ou session morte : l'appairage s'impose", () => {
    expect(mustPair({ status: { state: "no_session" }, open: false, expired: false, closed: false })).toBe(true);
    expect(mustPair({ status: { state: "dead" }, open: false, expired: false, closed: false })).toBe(true);
  });

  test("session expirée (401) : l'appairage s'impose", () => {
    expect(mustPair({ status: { state: "restored" }, open: false, expired: true, closed: false })).toBe(true);
  });

  test("session ouverte, hors ligne ou inconnue : l'app reste utilisable", () => {
    expect(mustPair({ status: { state: "restored" }, open: false, expired: false, closed: false })).toBe(false);
    expect(mustPair({ status: { state: "offline" }, open: false, expired: false, closed: false })).toBe(false);
    expect(mustPair({ status: null, open: false, expired: false, closed: false })).toBe(false);
  });

  test("session fermée et cache purgé : l'appairage s'impose", () => {
    // Après une déconnexion, le natif a invalidé la session ET purgé les
    // caches : le statut lu au démarrage (« session vivante ») est périmé.
    // Sans le drapeau « fermée », l'accueil afficherait « aucune donnée en
    // cache » pour un compte déconnecté (#360).
    expect(mustPair({ status: { state: "restored" }, open: false, expired: false, closed: true })).toBe(true);
    expect(mustPair({ status: { state: "offline" }, open: false, expired: false, closed: true })).toBe(true);
    expect(mustPair({ status: null, open: false, expired: false, closed: true })).toBe(true);
  });

  test("après une déconnexion réussie, la session est fermée", async () => {
    let closed = false;
    await logoutSession({
      logout: async () => ({ ok: true }),
      closeSession: () => {
        closed = true;
      },
    });
    expect(closed).toBe(true);
  });

  test("un logout en échec ne ferme pas la session", async () => {
    // Un natif injoignable ne déconnecte pas le compte : l'app ne doit pas
    // envoyer l'utilisateur vers l'appairage alors qu'il est encore connecté.
    let closed = false;
    await expect(
      logoutSession({
        logout: async () => {
          throw new Error("téléphone injoignable");
        },
        closeSession: () => {
          closed = true;
        },
      }),
    ).rejects.toThrow("téléphone injoignable");
    expect(closed).toBe(false);
  });

  test("un appairage réussi rouvre la session", () => {
    // Non-régression #357 : la session ouverte prime sur le statut périmé,
    // et annule la fermeture d'une déconnexion précédente.
    expect(mustPair({ status: { state: "no_session" }, open: true, expired: false, closed: false })).toBe(false);
    expect(mustPair({ status: { state: "no_session" }, open: true, expired: true, closed: false })).toBe(false);
  });
});
