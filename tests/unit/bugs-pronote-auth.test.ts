// Chasse aux bugs (revue adversariale) sur la chaîne auth Pronote :
// pronote-sessions.ts, session-refresh.ts.
// Zéro réseau réel : `globalThis.fetch` est stubbé puis restauré, hôtes
// synthétiques `*.invalid`, credentials factices. Horloges et sleepers
// INJECTÉS => aucun délai réel, aucun Date.now() caché : chaque test est
// déterministe. Un bug par test, le nom dit le mécanisme et l'impact.
import { afterEach, describe, expect, test } from "bun:test";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { PronoteAuthError } from "../../server/domain/ports";

const FAKE_BASE = "https://pronote-fake.invalid/eleve.html";
const FAKE_ACCOUNT = "acc-fake-bug";
const FAKE_QR = { login: "bG9naW4tZmFrZS1VTlJFQUw=", jeton: "amV0b24tZmFrZS1VTlJFQUw=" };
const FAKE_PIN = "0000-UNREAL";

const creds = { accountId: FAKE_ACCOUNT, pronoteUrl: FAKE_BASE, qr: FAKE_QR, pin: FAKE_PIN };

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Horloge manuelle : aucun Date.now() caché, aucun setTimeout réel. */
function clock(startMs = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("bugs auth Pronote (revue adversariale)", () => {
  // ------------------------------------------------------------------ 1
  test("BUG: invalidate() (logout) n'annule pas la renewal en vol — la session réapparaît dans le store dès que le login lent se termine", async () => {
    const c = clock();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let store!: PronoteSessionStore;
    store = new PronoteSessionStore({
      now: c.now,
      // Câblage réel (server/infrastructure/http.ts) : la renewal EST un authenticate.
      renew: async (target: string) => {
        await gate; // renewal encore en cours au moment du logout
        await store.authenticate({ ...creds, accountId: target });
      },
      clientFactory: (async () => ({ periods: [] })) as never,
    });

    await store.authenticate(creds);
    c.advance(6 * 60 * 1000); // TTL 5 min dépassé -> une renewal est due
    const inflight = store.refreshSession(FAKE_ACCOUNT);
    store.invalidate(FAKE_ACCOUNT); // logout
    expect(store.isAuthenticated(FAKE_ACCOUNT)).toBe(false);

    release();
    await inflight;

    // Le logout doit rester définitif : aucune session réactivée après coup.
    expect(store.isAuthenticated(FAKE_ACCOUNT)).toBe(false);
  });

  // ------------------------------------------------------------------ 2
  test("BUG: refreshSession() tente un login complet pour un accountId inconnu choisi par l'appelant — POST /v1/sync/refresh plante une session Pronote sous une clé arbitraire", async () => {
    const c = clock();
    let logins = 0;
    let store!: PronoteSessionStore;
    store = new PronoteSessionStore({
      now: c.now,
      renew: async (target: string) => {
        await store.authenticate({ ...creds, accountId: target });
      },
      clientFactory: (async () => {
        logins += 1;
        return { periods: [] };
      }) as never,
    });

    await store.refreshSession("attacker-chosen-account");

    // Aucun compte appairé : aucune renewal, et encore moins une session
    // authentifiée créée sous une clé fournie par l'appelant.
    expect(logins).toBe(0);
    expect(store.isAuthenticated("attacker-chosen-account")).toBe(false);
  });

  // ------------------------------------------------------------------ 3
  test("BUG: la clé de session n'est normalisée qu'à l'authentification — invalidate(\" acc \") laisse la session vivante, le logout passe", async () => {
    const store = new PronoteSessionStore({
      clientFactory: (async () => ({ periods: [] })) as never,
    });
    await store.authenticate({ ...creds, accountId: ` ${FAKE_ACCOUNT} ` });

    // La session a bien été créée (clé normalisée) : un logout avec la même
    // chaîne non normalisée doit l'invalider elle aussi.
    expect(store.isAuthenticated(FAKE_ACCOUNT)).toBe(true);
    store.invalidate(` ${FAKE_ACCOUNT} `);
    expect(store.isAuthenticated(FAKE_ACCOUNT)).toBe(false);
  });

  // ------------------------------------------------------------------ 4
  test("BUG: une renewal rejetée pour credentials invalides garde le client mort — l'app n'est jamais invitée à se ré-appairer et lit avec une session morte", async () => {
    const c = clock();
    const store = new PronoteSessionStore({
      now: c.now,
      renew: async () => {
        throw new PronoteAuthError("invalid credentials", "invalid_credentials");
      },
      clientFactory: (async () => ({ periods: [] })) as never,
    });
    await store.authenticate(creds);

    c.advance(6 * 60 * 1000);
    await store.refreshSession(FAKE_ACCOUNT).catch(() => undefined);

    // Credentials refusées par Pronote = session DÉFINITIVEMENT morte.
    expect(store.isAuthenticated(FAKE_ACCOUNT)).toBe(false);
  });

  // ------------------------------------------------------------------ 5
  test("le credential ne part que vers l'URL de l'établissement : aucune option de portail n'est transmise à la lib", async () => {
    const calls: { url: string; opts: unknown }[] = [];
    const store = new PronoteSessionStore({
      clientFactory: (async (url: string, opts: unknown) => {
        calls.push({ url, opts });
        return { periods: [] };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    });

    await store.authenticate(creds);

    // Le credential va sur l'URL de l'établissement, et NULLE PART ailleurs :
    // aucune option de portail n'est transmise à la lib, donc impossible de
    // rejouer le QR sur un autre hôte (l'URL est filtrée par isPublicSchoolUrl).
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(FAKE_BASE);
    expect(calls[0]?.opts).toMatchObject({ qr: FAKE_QR, pin: FAKE_PIN });
    expect(Object.keys(calls[0]?.opts as object).sort()).toEqual(["pin", "qr", "uuid"]);
  });

});