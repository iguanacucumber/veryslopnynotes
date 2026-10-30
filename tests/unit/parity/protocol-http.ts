import { expect, test } from "bun:test";
import { Communication, CookieJar, HttpSession, K0_HEX, ask, canonTs, checkRsaHeader, closedOrTimeout, ktSeededComm, portError, skip, startRawServer, startStub, tsErrorOfAsync, tsSeededComm, wireOf } from "../fixtures/pronote-protocol";

export function registerProtocolHttp(): void {
  test.skipIf(skip)("cookies : jar direct contre tough-cookie (portée, écrasement, expiration)", async () => {
    const tsJar = new CookieJar();
    const ktSid = (JSON.parse(await ask({ op: "cookieNew" })) as { sid: number }).sid;
    const script: Array<["set", string, string] | ["get", string]> = [
      ["set", "a=1; Path=/", "http://example.com/"],
      ["get", "http://example.com/"],
      ["set", "b=2; Path=/sub; Max-Age=10000", "http://example.com/sub/"],
      ["get", "http://example.com/sub/page"],
      ["get", "http://example.com/other"],
      ["set", "a=9; Path=/", "http://example.com/"],
      ["get", "http://example.com/"],
      ["set", "dead=x; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT", "http://example.com/"],
      ["get", "http://example.com/"],
      ["set", "sec=s; Path=/; Secure", "http://example.com/"],
      ["get", "http://example.com/"],
      // `Domain=` IP-littéral : tough-cookie refuse (« public suffix »), le port
      // accepte si l'hôte correspond (CookieJar, KDoc). Aucun serveur réel
      // n'émet ça (cookies hôte-seul ou domaines publics) : pas de cas ici.
      ["set", "gone=1; Path=/; Max-Age=0", "http://example.com/"],
      ["get", "http://example.com/"],
    ];
    for (const step of script) {
      if (step[0] === "set") {
        tsJar.setCookieSync(step[1], step[2]);
        await ask({ op: "cookieSet", sid: ktSid, header: step[1], url: step[2] });
      } else {
        const ts = tsJar.getCookieStringSync(step[1]);
        const kt = (JSON.parse(await ask({ op: "cookieGet", sid: ktSid, url: step[1] })) as { value: string }).value;
        expect(`GET ${step[1]} -> ${kt}`).toBe(`GET ${step[1]} -> ${ts}`);
      }
    }
  });

  test.skipIf(skip)("http : méthodes, params, redirects, erreurs — mêmes réponses", async () => {
    const stub = startStub(`h: '1', a: 'b'`);
    try {
      const ts = new HttpSession({ "X-Test": "ts" });
      const ktSid = (JSON.parse(await ask({ op: "httpNew", headers: { "X-Test": "kt" } })) as { sid: number }).sid;
      const cases: Array<{ method: string; url: string; opts?: Record<string, unknown> }> = [
        { method: "GET", url: `${stub.base}/params`, opts: { params: { q: "a b", x: "1", accents: "é" } } },
        { method: "POST", url: `${stub.base}/params`, opts: { data: { q: "a b" } } },
        { method: "GET", url: `${stub.base}/r302` },
        { method: "POST", url: `${stub.base}/post302`, opts: { json: { a: 1 } } },
        // 307 : méthode ET corps conservés (ni GET, ni perte).
        { method: "POST", url: `${stub.base}/post307`, opts: { json: { a: 2 } } },
        { method: "GET", url: `${stub.base}/status500` },
        { method: "GET", url: `${stub.base}/setCookies` },
        { method: "GET", url: `${stub.base}/echoCookies` },
      ];
      for (const c of cases) {
        const tsRes = await ts.request(c.method, c.url, c.opts as never);
        const tsGot = { status: tsRes.status, ok: tsRes.ok, url: tsRes.url, text: tsRes.text };
        const ktLine = await ask({ op: "httpReq", sid: ktSid, method: c.method, url: c.url, opts: c.opts ?? {} });
        const ktGot = JSON.parse(ktLine) as { status: number; ok: boolean; url: string; text: string };
        expect(`${c.method} ${c.url} -> ${canonTs({ status: ktGot.status, ok: ktGot.ok, url: ktGot.url, text: ktGot.text })}`).toBe(
          `${c.method} ${c.url} -> ${canonTs(tsGot)}`,
        );
      }
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("http : N requêtes séquentielles gardent le même socket (keep-alive, #309)", async () => {
    const stub = startStub(`h: '1', a: 'b'`);
    try {
      const ktSid = (JSON.parse(await ask({ op: "httpNew" })) as { sid: number }).sid;
      const N = 3;
      const seq = await ask({ op: "httpSeq", sid: ktSid, url: `${stub.base}/final`, n: N });
      expect(JSON.parse(seq)).toEqual({ statuses: Array.from({ length: N }, () => 200) });
      // Le port distant vu par le serveur est la seule preuve externe de la
      // réutilisation du socket. Contrôle de l'observation (mesuré) : le même
      // pilote lancé avec `-Dhttp.keepAlive=false` donne N ports, donc
      // l'assertion n'est pas vide. Réserve : sur la JVM, un `disconnect()`
      // après un corps entièrement consommé est DÉJÀ sans effet sur ce cache
      // (`KeepAliveCache`) — c'est Android/OkHttp qui ferme le socket pour de
      // bon, d'où #309 ; le harnais prouve la propriété, pas l'appel retiré.
      expect(stub.remotePorts.length).toBe(N);
      for (const port of stub.remotePorts) expect(port).toBeGreaterThan(0);
      expect(new Set(stub.remotePorts).size).toBe(1);
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil S4 : Uuid RSA (http présent) — structure vérifiée, reste octet-identique", async () => {
    const stub = startStub(`h: '123456', a: 'abcdef', http: '1'`);
    try {
      const tsComm = tsSeededComm(stub);
      await tsComm.initialise("ident-test");
      const tsWire = [...stub.requests];
      stub.requests.length = 0;

      const cid = await ktSeededComm(stub);
      await ask({ op: "commInit", cid, identifier: "ident-test" });
      const ktWire = [...stub.requests];

      // Les deux Uuid sont des RSA-1024 v1.5 (pas les mêmes octets : bourrage).
      for (const [label, wire] of [["ref", tsWire], ["port", ktWire]] as const) {
        const post = wire.find((r) => r.method === "POST");
        const env = JSON.parse(post?.body ?? "{}") as { dataSec: { data: { Uuid: string } } };
        const uuid = Buffer.from(env.dataSec.data.Uuid, "base64");
        expect(uuid.length).toBe(128);
        checkRsaHeader(uuid.toString("hex"), `${label} uuid`);
      }
      const keys = { fp: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" }, post: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" } };
      expect(wireOf(ktWire, keys)).toEqual(wireOf(tsWire, keys));
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("http : une `Location` malformée → erreur RÉSEAU mappée, socket refermé (#429)", async () => {
    // `Location`s que la JVM refuse (espace dans l'hôte, protocole inconnu,
    // autorité cassée) : la redirection est ILLISIBLE, pas « à suivre ».
    const locations = ["http://ho st/x", "xyz://hote/x", "http://[casse"];
    for (const location of locations) {
      // La référence TS refuse aussi (TypeError) : le port n'invente pas un
      // comportement que la référence n'a pas. Serveur à part : le client TS
      // garde sa connexion en keep-alive, il ne doit pas bruiter l'observation.
      const rawTs = await startRawServer(location);
      try {
        const tsErr = await tsErrorOfAsync(() => new HttpSession().get(`http://127.0.0.1:${rawTs.port}/r302`));
        expect(`${location} -> ${tsErr?.name ?? "aucune erreur"}`).toBe(`${location} -> TypeError`);
      } finally {
        rawTs.close();
      }

      const raw = await startRawServer(location);
      try {
        const ktSid = (JSON.parse(await ask({ op: "httpNew" })) as { sid: number }).sid;
        const ktErr = portError(
          await ask({ op: "httpReq", sid: ktSid, method: "GET", url: `http://127.0.0.1:${raw.port}/r302` }, true),
        );
        // L'erreur est une PANNE RÉSEAU mappée (« network » pour l'app), pas
        // une `MalformedURLException` brute qui remontait au caller.
        expect(`${location} -> ${ktErr.name}`).toBe(`${location} -> IOException`);
        expect(ktErr.message).toMatch(/redirection/i);
        // Et surtout : le socket est refermé (le serveur voit le FIN). Sinon
        // chaque redirection malformée laissait une connexion ouverte et le
        // pool de sockets se remplissait.
        expect(`${location} -> ${await closedOrTimeout(raw, 5000)}`).toBe(`${location} -> closed`);
      } finally {
        raw.close();
      }
    }
  }, 30000);

  // #497 : la détection d'une `Location` illisible ne doit PAS dépendre de la
  // JVM : le constructeur `java.net.URL` valide l'hôte selon la version (JDK 17
  // ACCEPTE « http://ho st/x », JDK 25 le refuse). Le port valide donc l'hôte
  // lui-même, sinon l'erreur remontée à l'app change de nature selon la JVM
  // (UnknownHostException brute au lieu de la panne réseau mappée).

  test.skipIf(skip)("communication : site AVEC ou SANS chemin — la page visée est celle de la référence (#429)", async () => {
    const stub = startStub(`h: '1', a: 'b'`);
    try {
      for (const site of [`${stub.base}/pronote/eleve.html`, stub.base]) {
        // La référence TS : `rootSite` = tout sauf le dernier segment,
        // `htmlPage` = le dernier segment. On compare la PAGE VISÉE (origine +
        // chemin), pas les chaînes internes : le port coupe l'AUTORITÉ, la
        // référence la coupe en deux — les deux visent la même page.
        const tsComm = new Communication(site, undefined, false);
        const tsTarget = new URL(`${tsComm.rootSite}/${tsComm.htmlPage}`);
        const cid = (JSON.parse(await ask({ op: "commNew", site })) as { cid: number }).cid;
        const ktRoot = JSON.parse(await ask({ op: "commRoot", cid })) as { rootSite: string; htmlPage: string };
        const ktTarget = new URL(`${ktRoot.rootSite}/${ktRoot.htmlPage}`);
        expect(`${site} -> ${ktTarget.origin}${ktTarget.pathname}`).toBe(`${site} -> ${tsTarget.origin}${tsTarget.pathname}`);
      }
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("communication : un site SANS chemin atteint le bon hôte (le POST partait sur un autre hôte)", async () => {
    const stub = startStub(`h: '1', a: 'b'`);
    try {
      // La référence TS ne peut PAS aller au bout de ce fil : son `rootSite`
      // vaut `http:/`, donc son POST part sur `http://appelfonction/...`. Le
      // port, lui, vise l'hôte de l'établissement — le comportement attendu.
      const cid = (JSON.parse(await ask({ op: "commNew", site: stub.base })) as { cid: number }).cid;
      await ask({ op: "commInit", cid, identifier: null });
      // La page a été demandée à la racine du stub (hôte correct)…
      expect(stub.requests[0]?.path).toBe("/");
      // …et le POST d'API part sur le MÊME hôte.
      expect(stub.requests[1]?.path).toMatch(/^\/appelfonction\//);
    } finally {
      stub.close();
    }
  });
}
