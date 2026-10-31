import { expect, test, jest } from "bun:test";
import { IV1_HEX, K0_HEX, KeepAlive, ROOT, ask, behaviorKeys, canonTs, createHash, inflateRawSync, join, ktSeededComm, portError, readFileSync, skip, startStub, tsAesEncrypt, tsErrorOfAsync, tsSeededComm, wireOf } from "../fixtures/pronote-protocol";
import type { RecordedReq } from "../fixtures/pronote-protocol";

export function registerProtocolWire(): void {
  test.skipIf(skip)("fil S1 : handshake + POST en clair, octet-identique (aléa fixé)", async () => {
    const stub = startStub(`h: '123456', a: 'abcdef', `);
    try {
      const tsComm = tsSeededComm(stub);
      const tsInit = await tsComm.initialise("ident-test");
      const tsPost = await tsComm.post("TestEcho", { data: { bonjour: "monde", n: 3 } });
      const tsState = { n: tsComm.requestNumber, enc: tsComm.encryptRequests, comp: tsComm.compressRequests };
      const tsWire = [...stub.requests];
      stub.requests.length = 0;

      const cid = await ktSeededComm(stub);
      const initLine = await ask({ op: "commInit", cid, identifier: "ident-test" });
      const ktPost = await ask({ op: "commPost", cid, function: "TestEcho", data: { data: { bonjour: "monde", n: 3 } } });
      const stateLine = await ask({ op: "commState", cid });
      const ktWire = [...stub.requests];

      expect(`init -> ${canonTs(JSON.parse(initLine))}`).toBe(`init -> ${canonTs({ attributes: tsInit[0], response: tsInit[1] })}`);
      expect(`post -> ${canonTs(JSON.parse(ktPost))}`).toBe(`post -> ${canonTs(tsPost)}`);
      expect(`state -> ${canonTs(JSON.parse(stateLine))}`).toBe(
        `state -> ${canonTs({ requestNumber: tsState.n, encryptRequests: tsState.enc, compressRequests: tsState.comp })}`,
      );
      // Fil identique à l'octet près (Uuid = temp fixé, pas de RSA ici).
      const keys = { fp: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" }, post: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" } };
      expect(wireOf(ktWire, keys)).toEqual(wireOf(tsWire, keys));
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil : `CrA: '0'` chiffre aussi (vérité JS, pas booléen textuel)", async () => {
    const stub = startStub(`h: '1', a: 'b', CrA: '0'`);
    try {
      const tsComm = tsSeededComm(stub);
      await tsComm.initialise(undefined);
      const cid = await ktSeededComm(stub);
      await ask({ op: "commInit", cid, identifier: undefined });
      // Les deux lisent une chaîne non vide comme vraie ; le stub déchiffre, les deux comprennent pareil.
      expect(tsComm.encryptRequests).toBe(true);
      const stateLine = await ask({ op: "commState", cid });
      expect(`state -> ${canonTs(JSON.parse(stateLine))}`).toBe(
        `state -> ${canonTs({ requestNumber: tsComm.requestNumber, encryptRequests: true, compressRequests: false })}`,
      );
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil S2 : chiffré (CrA) + afterAuth, octet-identique, clé dérivée", async () => {
    const stub = startStub(`h: '123456', a: 'abcdef', CrA: '1'`);
    try {
      const k1 = createHash("md5").update(Buffer.from([10, 20, 30])).digest("hex");
      behaviorKeys(stub, k1, IV1_HEX);
      stub.behavior.answer = (_id, inner) => ({ bienRecu: inner });
      const tsComm = tsSeededComm(stub);
      await tsComm.initialise("ident-test");
      // `afterAuth` pose `authKey` puis déchiffre `cle` SOUS ELLE ; K1 = md5([10,20,30]).
      const authKeyHex = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
      const cle = tsAesEncrypt(authKeyHex, IV1_HEX, Buffer.from("10,20,30", "utf8")).toString("hex");
      const authPayload = { dataSec: { data: { cle } } };
      await tsComm.afterAuth(authPayload as never, Buffer.from(authKeyHex, "hex"));
      const tsPost = await tsComm.post("TestEcho", { data: { secret: "chiffré" } });
      const tsWire = [...stub.requests];
      stub.requests.length = 0;

      const cid = await ktSeededComm(stub);
      await ask({ op: "commInit", cid, identifier: "ident-test" });
      await ask({ op: "commAfterAuth", cid, data: authPayload, authKeyHex: "0f1e2d3c4b5a69788796a5b4c3d2e1f0" });
      const ktPost = await ask({ op: "commPost", cid, function: "TestEcho", data: { data: { secret: "chiffré" } } });
      const ktWire = [...stub.requests];

      expect(`post -> ${canonTs(JSON.parse(ktPost))}`).toBe(`post -> ${canonTs(tsPost)}`);
      // Corps déchiffrables par le test (FP : K0/zéros, posts : K1/iv1) et identiques.
      const keys = { fp: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" }, post: { keyHex: k1, ivHex: IV1_HEX } };
      expect(wireOf(ktWire, keys)).toEqual(wireOf(tsWire, keys));
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil S3 : compressé (CoA), contenu inflaté identique (flux non comparé)", async () => {
    const stub = startStub(`h: '123456', a: 'abcdef', CoA: '1'`);
    try {
      behaviorKeys(stub, K0_HEX, IV1_HEX);
      stub.behavior.answer = (_id, inner) => ({ bienRecu: inner });
      const big = { grand: "x".repeat(500), accents: "Éléonore — 妥当性" };
      const tsComm = tsSeededComm(stub);
      await tsComm.initialise("ident-test");
      const tsPost = await tsComm.post("TestEcho", { data: big });
      const tsWire = [...stub.requests];
      stub.requests.length = 0;

      const cid = await ktSeededComm(stub);
      await ask({ op: "commInit", cid, identifier: "ident-test" });
      const ktPost = await ask({ op: "commPost", cid, function: "TestEcho", data: { data: big } });
      const ktWire = [...stub.requests];

      expect(`post -> ${canonTs(JSON.parse(ktPost))}`).toBe(`post -> ${canonTs(tsPost)}`);
      // dataSec déflaté : on compare l'inflaté, pas le flux (zlib ≠ Java).
      const inflateBody = (body: string): string => {
        if (body === "") return "";
        const env = JSON.parse(body) as { dataSec: string };
        return inflateRawSync(Buffer.from(env.dataSec, "hex")).toString("utf8");
      };
      expect(tsWire.map((r) => inflateBody(r.body))).toEqual(ktWire.map((r) => inflateBody(r.body)));
      // …mais tout le reste du fil est octet-identique.
      const stripDataSec = (reqs: RecordedReq[]) =>
        reqs.map((r) => ({ ...r, headers: {}, body: JSON.stringify({ ...JSON.parse(r.body || "{}"), dataSec: "DEFLATE" }) }));
      expect(stripDataSec(ktWire)).toEqual(stripDataSec(tsWire));
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil : garde des onglets (Signature) + user-agent mobile", async () => {
    const stub = startStub(`h: '1', a: 'b', `);
    try {
      const tsComm = tsSeededComm(stub, true);
      const tsInit = await tsComm.initialise(undefined);
      tsComm.authorizedOnglets = [7];
      const tsOk = await tsComm.post("Navigation", { Signature: { onglet: 7 } });
      const tsRefused = await tsErrorOfAsync(() => tsComm.post("Navigation", { Signature: { onglet: 8 } }));
      const tsWire = [...stub.requests];
      stub.requests.length = 0;

      const cid = await ktSeededComm(stub, true);
      const init = await ask({ op: "commInit", cid, identifier: null });
      await ask({ op: "commSetOnglets", cid, onglets: [7] });
      const ktOk = await ask({ op: "commPost", cid, function: "Navigation", data: { Signature: { onglet: 7 } } });
      const ktRefused = portError(await ask({ op: "commPost", cid, function: "Navigation", data: { Signature: { onglet: 8 } } }, true));
      const ktWire = [...stub.requests];

      expect(`init -> ${canonTs(JSON.parse(init))}`).toBe(`init -> ${canonTs({ attributes: tsInit[0], response: tsInit[1] })}`);
      expect(`ok -> ${canonTs(JSON.parse(ktOk))}`).toBe(`ok -> ${canonTs(tsOk)}`);
      expect(tsRefused?.name).toBe("PronoteAPIError");
      expect(ktRefused).toEqual({ name: tsRefused?.name ?? "", message: tsRefused?.message ?? "" });
      const keys = { fp: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" }, post: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" } };
      expect(wireOf(ktWire, keys)).toEqual(wireOf(tsWire, keys));
      for (const wire of [tsWire, ktWire]) {
        expect(wire.find((r) => r.method === "GET")?.headers["user-agent"]).toBe("iPhone");
      }
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil : erreurs serveur typées (Erreur G, HTTP 500, JSON cassé)", async () => {
    const stub = startStub(`h: '1', a: 'b', `);
    try {
      const tsComm = tsSeededComm(stub);
      await tsComm.initialise(undefined);
      const cid = await ktSeededComm(stub);
      await ask({ op: "commInit", cid, identifier: null });

      // Les aiguillages du stub sont à UN COUP : on arme avant chaque côté.
      const armG22 = () => { stub.behavior.nextEnvelope = { Erreur: { G: 22, Titre: "session morte" } }; };
      const armG99 = () => { stub.behavior.nextEnvelope = { Erreur: { G: 99, Titre: "Bizarre" } }; };
      const arm500 = () => { stub.behavior.nextPostStatus = { status: 500, body: "oops" }; };
      const armRaw = () => { stub.behavior.nextRaw = "pas du json{"; };

      // G == 22 : objet expiré.
      armG22();
      const ts22 = await tsErrorOfAsync(() => tsComm.post("X", { data: {} }));
      armG22();
      const kt22 = portError(await ask({ op: "commPost", cid, function: "X", data: { data: {} } }, true));
      expect(ts22?.name).toBe("ExpiredObject");
      expect(kt22).toEqual({ name: ts22?.name ?? "", message: ts22?.message ?? "" });

      // G inconnu : message brut `Titre` dans le texte.
      armG99();
      const ts99 = await tsErrorOfAsync(() => tsComm.post("X", { data: {} }));
      armG99();
      const kt99 = portError(await ask({ op: "commPost", cid, function: "X", data: { data: {} } }, true));
      expect(ts99?.name).toBe("PronoteAPIError");
      expect(kt99).toEqual({ name: ts99?.name ?? "", message: ts99?.message ?? "" });

      // HTTP 500 : statut dans le message.
      arm500();
      const ts500 = await tsErrorOfAsync(() => tsComm.post("X", { data: {} }));
      arm500();
      const kt500 = portError(await ask({ op: "commPost", cid, function: "X", data: { data: {} } }, true));
      expect(kt500).toEqual({ name: ts500?.name ?? "", message: ts500?.message ?? "" });

      // JSON cassé : les deux jettent (classes brutes différentes, fait assumé).
      armRaw();
      const tsBad = await tsErrorOfAsync(() => tsComm.post("Z", { data: {} }));
      armRaw();
      const ktBad = portError(await ask({ op: "commPost", cid, function: "Z", data: { data: {} } }, true));
      expect(tsBad?.name).toBe("SyntaxError");
      expect(ktBad.name).toBe("JsonError");

      // Déflate corrompu sous CoA : le même `JSONDecodeError` des deux côtés.
      const stubC = startStub(`h: '1', a: 'b', CoA: '1'`);
      try {
        const tsCo = tsSeededComm(stubC);
        await tsCo.initialise(undefined);
        const cidC = await ktSeededComm(stubC);
        await ask({ op: "commInit", cid: cidC, identifier: undefined });
        const armDeflate = () => { stubC.behavior.nextDataSec = "00ff00ff"; };
        armDeflate();
        const tsDe = await tsErrorOfAsync(() => tsCo.post("Z", { data: {} }));
        armDeflate();
        const ktDe = portError(await ask({ op: "commPost", cid: cidC, function: "Z", data: { data: {} } }, true));
        expect(tsDe?.name).toBe("PronoteAPIError");
        expect(ktDe).toEqual({ name: tsDe?.name ?? "", message: tsDe?.message ?? "" });
      } finally {
        stubC.close();
      }
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil : initialise rejoue la page 3 fois (succès au 2e, échec au 3e illisible)", async () => {
    // Succès au 2e essai : le 1er HTML est illisible, le 2e est bon.
    const stub = startStub(`PAS DE START ICI`);
    try {
      stub.behavior.htmlQueue.push(`h: '7', a: 'g', `);
      const tsComm = tsSeededComm(stub);
      const tsInit = await tsComm.initialise(undefined);
      const tsGets = stub.gets;
      stub.requests.length = 0;
      stub.gets = 0;

      const stub2 = startStub(`PAS DE START ICI`);
      try {
        stub2.behavior.htmlQueue.push(`h: '7', a: 'g', `);
        const cid = await ktSeededComm(stub2);
        const init = await ask({ op: "commInit", cid, identifier: null });
        expect(stub2.gets).toBe(tsGets);
        expect(`init -> ${canonTs(JSON.parse(init))}`).toBe(`init -> ${canonTs({ attributes: tsInit[0], response: tsInit[1] })}`);
      } finally {
        stub2.close();
      }

      // 3 HTML illisibles : les deux abandonnent au même message.
      const stub3 = startStub(`TOUJOURS PAS DE START`);
      try {
        const tsErr = await tsErrorOfAsync(() => tsSeededComm(stub3).initialise(undefined));
        const cid3 = await ktSeededComm(stub3);
        const ktErr = portError(await ask({ op: "commInit", cid: cid3, identifier: null }, true));
        expect(stub3.gets).toBe(6);
        expect(ktErr).toEqual({ name: tsErr?.name ?? "", message: tsErr?.message ?? "" });
        expect(tsErr?.name).toBe("PronoteAPIError");
      } finally {
        stub3.close();
      }
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("keepAlive : ping si dû, silence sinon (seuil 110 s)", async () => {
    // Vrai thread de garde, période 25 ms au lieu de 1 000 : ce qui est testé, c'est le SEUIL (110 s).
    const TICK_MS = 25;
    const ktStaleP = ask({ op: "keepAlive", staleSec: 200, runMs: 200, tickMs: TICK_MS });

    jest.useFakeTimers();
    try {
      let tsPings = 0;
      const tsStale = new KeepAlive({ communication: { lastPing: Math.floor(Date.now() / 1000) - 200 }, post: async () => { tsPings++; } } as never);
      tsStale.start();
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      tsStale.stop();
      expect(tsPings).toBeGreaterThanOrEqual(1);
    } finally {
      jest.useRealTimers();
    }

    const ktStale = JSON.parse(await ktStaleP) as { pings: number };
    expect(ktStale.pings).toBeGreaterThanOrEqual(1);

    // 60 s simulées < 110 s : aucune des deux implémentations ne doit pinger.
    const ktFresh = JSON.parse(await ask({ op: "keepAliveTick", staleSec: 0 })) as { pings: number };
    jest.useFakeTimers();
    try {
      let tsFreshPings = 0;
      const tsFresh = new KeepAlive({ communication: { lastPing: Math.floor(Date.now() / 1000) }, post: async () => { tsFreshPings++; } } as never);
      tsFresh.start();
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
      tsFresh.stop();
      expect(tsFreshPings).toBe(0);
    } finally {
      jest.useRealTimers();
    }
    expect(ktFresh.pings).toBe(0);

    // Ping MANUEL : INCONDITIONNEL, le seuil ne s'applique pas (extension du port).
    const ktManual = JSON.parse(await ask({ op: "keepAlivePing" })) as { pings: number };
    expect(ktManual.pings).toBe(1);
  }, 30000);

  // Une redirection illisible ne doit ni fuir la connexion ni renvoyer une exception brute.

  test("le port valide l'hôte de la redirection lui-même (indépendant de la JVM)", () => {
    const port = readFileSync(
      join(
        ROOT,
        "android",
        "pronote",
        "src",
        "main",
        "java",
        "fr",
        "veryslopnynotes",
        "pronote",
        "HttpSession.kt",
      ),
      "utf8",
    );
    expect(port).toMatch(/host\.isEmpty\(\)\s*\|\|\s*host\.any/);
    expect(port).toContain("Redirection invalide");
  });

  // Un site SANS chemin (`https://host`) doit viser la MÊME page que la référence.
}
