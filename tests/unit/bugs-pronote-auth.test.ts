// Chasse aux bugs (revue adversariale) sur la chaîne auth Pronote :
// pronote-auth.ts, pronote-sessions.ts, session-refresh.ts, ent-ninegate.ts.
// Zéro réseau réel : `globalThis.fetch` est stubbé puis restauré, hôtes
// synthétiques `*.invalid`, credentials factices. Horloges et sleepers
// INJECTÉS => aucun délai réel, aucun Date.now() caché : chaque test est
// déterministe. Un bug par test, le nom dit le mécanisme et l'impact.
import { afterEach, describe, expect, test } from "bun:test";
import type { CookieJar } from "tough-cookie";
import { PronoteHttpClient } from "../../server/integrations/PronoteHttpClient";
import { PronoteAuthProvider } from "../../server/integrations/pronote-auth";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { ninegateHubixEduconnect } from "../../server/integrations/ent-ninegate";
import { PronoteAuthError } from "../../server/domain/ports";

const FAKE_BASE = "https://pronote-fake.invalid/eleve.html";
const FAKE_ACCOUNT = "acc-fake-bug";
const FAKE_USER = "fake-user-UNREAL";
const FAKE_PW = "fake-pw-9x8y7z-UNREAL";
const FAKE_ENT = "ninegate";

const creds = {
  accountId: FAKE_ACCOUNT,
  username: FAKE_USER,
  password: FAKE_PW,
  entKind: FAKE_ENT,
};

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Horloge manuelle : aucun Date.now() caché, aucun setTimeout réel. */
function clock(startMs = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

interface StubRoute {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

/** Stub `globalThis.fetch` (utilisé par HttpSession de pronotets) sur une table de routes. */
function stubFetch(routes: StubRoute[], seen: Seen[]): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    seen.push({ method, url, body });
    const hit = routes.find((r) => r.method === method && r.url === url);
    if (!hit) throw new Error(`stub fetch: route inconnue ${method} ${url}`);
    // Aucun Set-Cookie : la page servie est réellement non authentifiée.
    return new Response(hit.body, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

const HUBIX = "https://hubix.ac-reunion.fr/go/ELEVE";
const HUBIX_ACS = "https://hubix.ac-reunion.fr/sso/redirect";
const EDU_E1S1 = "https://sso-fake.invalid/idp/profile/SAML2/Redirect/SSO?execution=e1s1";
const EDU_E1S2 = "https://sso-fake.invalid/idp/profile/SAML2/Redirect/SSO?execution=e1s2";
const EDU_ACS = "https://sso-fake.invalid/saml/acs";

const hubixPage = `<html><body>
<form name="f" method="post" action="/sso/redirect">
<input type="hidden" name="SAMLRequest" value="REQ-FAKE" />
<input type="hidden" name="RelayState" value="RS-FAKE" />
</form></body></html>`;

const e1s1Page = `<html><body>
<form name="form1" method="post" action="${EDU_E1S1}">
<input type="hidden" name="_eventId_proceed" value="" />
</form></body></html>`;

function loginPage(action: string): string {
  return `<html><body>
<form method="post" action="${action}">
<input type="hidden" name="csrf_token" value="CSRF-FAKE" />
<input type="text" name="j_username" />
<input type="password" name="j_password" />
</form></body></html>`;
}

const samlResponsePage = `<html><body>
<form method="post" action="${EDU_ACS}">
<input type="hidden" name="SAMLResponse" value="RESP-FAKE" />
<input type="hidden" name="RelayState" value="RS-FAKE" />
</form></body></html>`;

function bureauPage(): string {
  return `<html><body><ul>
<li><a href="https://ninegate-fake.invalid/ninegate/autre">Mes applications</a></li>
<li><a href="https://pronote-fake.invalid/eleve.html">Pronote</a></li>
</ul></body></html>`;
}

describe("bugs auth Pronote (revue adversariale)", () => {
  // ------------------------------------------------------------------ 1
  test("BUG: le POST j_password suit l'action du form servie par la page, sans contrôle d'origine — une page ENT substituée expédie le mot de passe en clair vers un hôte arbitraire", async () => {
    const evil = "https://evil.invalid/collect";
    const seen: Seen[] = [];
    stubFetch(
      [
        { method: "GET", url: HUBIX, body: hubixPage },
        { method: "POST", url: HUBIX_ACS, body: e1s1Page },
        // La page de login annonce une action de form sur un autre hôte.
        { method: "POST", url: EDU_E1S1, body: loginPage(evil) },
        { method: "POST", url: evil, body: "<html><body>page inconnue</body></html>" },
      ],
      seen,
    );
    await ninegateHubixEduconnect(FAKE_USER, FAKE_PW).catch(() => undefined);

    // Le secret ne doit partir que vers l'origine qui a servi le formulaire.
    const leaked = seen.filter((r) => r.body.includes(FAKE_PW) && !r.url.startsWith("https://sso-fake.invalid"));
    expect(leaked.map((r) => `${r.method} ${r.url}`)).toEqual([]);
  });

  // ------------------------------------------------------------------ 2
  test("BUG: invalidate() (logout) n'annule pas la renewal en vol — la session réapparaît dans le store dès que le login lent se termine", async () => {
    const c = clock();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let store!: PronoteSessionStore;
    store = new PronoteSessionStore({
      pronoteUrl: FAKE_BASE,
      now: c.now,
      // Câblage réel (server/infrastructure/http.ts) : la renewal EST un authenticate.
      renew: async (target: string) => {
        await gate; // renewal SSO encore en cours au moment du logout
        await store.authenticate({ accountId: target, username: FAKE_USER, password: FAKE_PW, entKind: FAKE_ENT });
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

  // ------------------------------------------------------------------ 3
  test("BUG: refreshSession() tente un login SSO complet pour un accountId inconnu choisi par l'appelant — POST /v1/sync/refresh plante une session Pronote sous une clé arbitraire", async () => {
    const c = clock();
    let logins = 0;
    let store!: PronoteSessionStore;
    store = new PronoteSessionStore({
      pronoteUrl: FAKE_BASE,
      now: c.now,
      renew: async (target: string) => {
        await store.authenticate({ accountId: target, username: FAKE_USER, password: FAKE_PW, entKind: FAKE_ENT });
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

  // ------------------------------------------------------------------ 4
  test("BUG: la clé de session n'est normalisée qu'à l'authentification — invalidate(\" acc \") laisse la session vivante, le logout passe", async () => {
    const store = new PronoteSessionStore({
      pronoteUrl: FAKE_BASE,
      clientFactory: (async () => ({ periods: [] })) as never,
    });
    await store.authenticate({ ...creds, accountId: ` ${FAKE_ACCOUNT} ` });

    // La session a bien été créée (clé normalisée) : un logout avec la même
    // chaîne non normalisée doit l'invalider elle aussi.
    expect(store.isAuthenticated(FAKE_ACCOUNT)).toBe(true);
    store.invalidate(` ${FAKE_ACCOUNT} `);
    expect(store.isAuthenticated(FAKE_ACCOUNT)).toBe(false);
  });

  // ------------------------------------------------------------------ 5
  test("BUG: une renewal rejetée pour credentials invalides garde le client mort — l'app n'est jamais invitée à se ré-appairer et lit avec une session morte", async () => {
    const c = clock();
    const store = new PronoteSessionStore({
      pronoteUrl: FAKE_BASE,
      now: c.now,
      renew: async () => {
        throw new PronoteAuthError("invalid credentials", "invalid_credentials");
      },
      clientFactory: (async () => ({ periods: [] })) as never,
    });
    await store.authenticate(creds);

    c.advance(6 * 60 * 1000);
    await store.refreshSession(FAKE_ACCOUNT).catch(() => undefined);

    // Credentials refusées par l'ENT = session DÉFINITIVEMENT morte.
    expect(store.isAuthenticated(FAKE_ACCOUNT)).toBe(false);
  });

  // ------------------------------------------------------------------ 6
  test("BUG: entKind \"cas\"/\"educonnect\" est accepté mais la chaîne exécutée est toujours le SSO Ninegate — les identifiants partent vers un ENT que le compte n'a pas configuré", async () => {
    let entCalls = 0;
    const store = new PronoteSessionStore({
      pronoteUrl: FAKE_BASE,
      entLogin: (async () => {
        entCalls += 1;
        return { getCookieString: () => "" } as unknown as CookieJar;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      // Factory « réelle » : pronotets appelle opts.ent pendant le login.
      clientFactory: (async (_url: string, u: string, p: string, opts: { ent: (u: string, p: string, o: any) => Promise<CookieJar> }) =>
        opts.ent(u, p, { pronote_url: FAKE_BASE })) as never,
    });

    const err = await store.authenticate({ ...creds, entKind: "cas" }).catch((e: unknown) => e);

    // Seul ninegate est implémenté : les autres ENT doivent être refusés,
    // pas joués en silence par le SSO Ninegate.
    expect((err as PronoteAuthError).code).toBe("invalid_credentials");
    expect(entCalls).toBe(0);
    expect(store.isAuthenticated(FAKE_ACCOUNT)).toBe(false);
  });

  // ------------------------------------------------------------------ 7
  test("BUG: le portail SSO est validé par un simple substring « ninegate » dans le HTML — une page non authentifiée est acceptée comme session valide et un jar vide est renvoyé", async () => {
    const portal = "https://ninegate-fake.invalid";
    stubFetch(
      [
        { method: "GET", url: HUBIX, body: hubixPage },
        { method: "POST", url: HUBIX_ACS, body: e1s1Page },
        { method: "POST", url: EDU_E1S1, body: loginPage(EDU_E1S2) },
        { method: "POST", url: EDU_E1S2, body: samlResponsePage },
        { method: "POST", url: EDU_ACS, body: `<html><body><a href="${portal}/accueil">Cliquer ici</a></body></html>` },
        // Page « portail » qui ne contient que la chaîne ninegate, sans cookie.
        { method: "GET", url: `${portal}/accueil`, body: "<html><body>ninegate</body></html>" },
        { method: "GET", url: `${portal}/ninegate/login`, body: "<html><body>ok</body></html>" },
        { method: "GET", url: `${portal}/ninegate/page/view/-200?usage=accueil&group=null`, body: bureauPage() },
        { method: "GET", url: "https://pronote-fake.invalid/eleve.html", body: "<html><body>ok</body></html>" },
      ],
      [],
    );

    // Un SSO « réussi » doit avoir établi un cookie de session ; sinon il doit
    // échouer franchement (jamais renvoyer un jar vide comme une session valide).
    const outcome = await ninegateHubixEduconnect(FAKE_USER, FAKE_PW).then(
      async (jar: CookieJar) => await jar.getCookieString(`${portal}/`),
      () => "rejected",
    );
    expect(outcome).not.toBe("");
  });

  // ------------------------------------------------------------------ 8
  test("BUG: extractToken() prend `token` vide sans retenter `sessionToken` — une réponse {token:\"\",sessionToken:\"…\"} fait échouer l'auth sur un jeton valide", async () => {
    const validToken = "fake-token-abc123-UNREAL";
    const fetchFn = (async () =>
      new Response(JSON.stringify({ token: "", sessionToken: validToken }), { status: 200 })) as unknown as typeof fetch;
    const client = new PronoteHttpClient({
      baseUrl: "https://pronote-fake.invalid/api",
      deviceUuid: "123e4567-e89b-42d3-a456-426614174000",
      fetchFn,
    });
    const auth = new PronoteAuthProvider({ client });

    const session = await auth.authenticate({ ...creds, entKind: "cas-fake" });

    expect(session.accountId).toBe(FAKE_ACCOUNT);
    expect(auth.getSessionToken(FAKE_ACCOUNT)).toBe(validToken);
  });
});