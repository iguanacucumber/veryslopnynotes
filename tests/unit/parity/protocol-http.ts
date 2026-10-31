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
      // Pas de cas `Domain=` IP-littéral : tough-cookie le refuse, aucun serveur réel n'en émet.
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
      // Ports distants = seule preuve externe du socket réutilisé ; avec
      // `-Dhttp.keepAlive=false` on en observe N. Sur JVM, `disconnect()` après
      // corps consommé est sans effet : le harnais prouve la propriété, pas l'appel.
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
    // `Location` refusée par la JVM : redirection ILLISIBLE, pas « à suivre ».
    const locations = ["http://ho st/x", "xyz://hote/x", "http://[casse"];
    for (const location of locations) {
      // La référence TS refuse aussi (TypeError). Serveur à part : le client TS
      // garde son keep-alive, il ne doit pas bruiter l'observation.
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
        // Panne réseau mappée (`network`), pas une `MalformedURLException` brute.
        expect(`${location} -> ${ktErr.name}`).toBe(`${location} -> IOException`);
        expect(ktErr.message).toMatch(/redirection/i);
        // Socket refermé (le serveur voit le FIN), sinon le pool se remplit.
        expect(`${location} -> ${await closedOrTimeout(raw, 5000)}`).toBe(`${location} -> closed`);
      } finally {
        raw.close();
      }
    }
  }, 30000);

  // Détection indépendante de la JVM : JDK 17 accepte « http://ho st/x », JDK 25
  // le refuse. Le port valide l'hôte lui-même, sinon l'erreur change de nature
  // selon la JVM (UnknownHostException brute au lieu de la panne réseau mappée).

  test.skipIf(skip)("communication : site AVEC ou SANS chemin — la page visée est celle de la référence (#429)", async () => {
    const stub = startStub(`h: '1', a: 'b'`);
    try {
      for (const site of [`${stub.base}/pronote/eleve.html`, stub.base]) {
        // La référence coupe en `rootSite`/`htmlPage`, le port coupe l'autorité :
        // on compare la page visée, pas les chaînes internes.
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
      // La référence TS part sur `http://appelfonction/...` (son `rootSite` vaut
      // `http:/`) ; le port vise l'hôte de l'établissement.
      const cid = (JSON.parse(await ask({ op: "commNew", site: stub.base })) as { cid: number }).cid;
      await ask({ op: "commInit", cid, identifier: null });
      expect(stub.requests[0]?.path).toBe("/");
      expect(stub.requests[1]?.path).toMatch(/^\/appelfonction\//);
    } finally {
      stub.close();
    }
  });
}
