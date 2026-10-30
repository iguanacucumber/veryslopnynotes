import { expect, test } from "bun:test";
import { JETON, LOGIN, PIN, UUID, ask, canonTs, expectBothStates, expectBothWire, ktLogin, portError, qrHex, skip, startStub, tsLogin } from "../fixtures/pronote-client";

export function registerClientAuth(): void {
  test.skipIf(skip)("auth : QR heureux, rotation du jeton, état identique", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      const tsClient = await tsLogin(tsa);
      const tsPosts = [...tsa.posts];
      tsa.posts.length = 0;
      const ktCid = await ktLogin(kta);
      const ktPosts = [...kta.posts];
      kta.posts.length = 0;
      await expectBothStates({ tsa, kta, tsClient, ktCid, tsPosts, ktPosts }, "auth");
      await expectBothWire({ tsa, kta, tsClient, ktCid, tsPosts, ktPosts }, "auth");
      // Rotation : le mot de passe est le jeton mobile, plus le QR.
      expect(tsClient.password).toBe("mobile-token-abc");
      const ktState = JSON.parse(await ask({ op: "clientState", cid: ktCid })) as { password: string };
      expect(ktState.password).toBe("mobile-token-abc");
      // `exportCredentials` suit la rotation des deux côtés (ports normalisés :
      // deux stubs = deux ports, le reste de l'URL est identique).
      const normUrl = (u: string): string => u.replace(/:\d+\/pronote/, ":PORT/pronote");
      const ktCreds = JSON.parse(await ask({ op: "exportCreds", cid: ktCid })) as Record<string, unknown>;
      const tsCreds = tsClient.exportCredentials() as unknown as Record<string, unknown>;
      expect(canonTs({ ...ktCreds, pronoteUrl: normUrl(ktCreds.pronoteUrl as string) })).toBe(
        canonTs({ ...tsCreds, pronoteUrl: normUrl(tsCreds.pronoteUrl as string) }),
      );
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("QR : URL réécrite — hôte underscore, IDN, port, chemin vide (parité TS)", async () => {
    // Référence TS : la transformation de `new URL()` faite par `qrcodeLogin`.
    const tsRewrite = (raw: string): string => {
      const url = new URL(raw);
      const parts = url.pathname.split("/");
      const lastIndex = parts.length - 1;
      const last = parts[lastIndex];
      if (last === undefined) throw new Error("URL sans segment de chemin");
      if (!last.startsWith("mobile.")) parts[lastIndex] = "mobile." + last;
      url.pathname = parts.join("/");
      url.search = "?fd=1&bydlg=A6ABB224-12DD-4E31-AD3E-8A39A1C2C335&login=true";
      url.hash = "";
      return url.toString();
    };
    // Hôtes « non serveur » : `URI.getHost()` y vaut NULL, le port Kotlin les
    // REFUSAIT tous (appairage impossible sur ces établissements, #402).
    const urls = [
      "https://lycee_jean_moulin.example/pronote/eleve.html",
      "https://ecole_avec_accents.example/pronote/eleve.html",
      "https://école.example/pronote/eleve.html",
      "https://LYCee_EXAMPLE.example/pronote/eleve.html",
      "https://ecole.example:8443/pronote/eleve.html",
      "https://ecole.example:443/pronote/eleve.html",
      "https://ecole.example",
      "https://ecole.example/",
      "https://eleve@ecole.example/pronote/eleve.html",
      "https://ecole.example/pronote/eleve.html#ancre",
      "https://[::1]:/pronote/eleve.html",
    ];
    for (const raw of urls) {
      const kt = JSON.parse(await ask({ op: "rewriteQrUrl", url: raw })) as { url: string };
      expect(`rewriteQrUrl ${raw} -> ${kt.url}`).toBe(`rewriteQrUrl ${raw} -> ${tsRewrite(raw)}`);
      // L'hôte est repris tel quel par l'appelant : jamais de « double slash ».
      expect(kt.url.replace(/^https?:\/\//, "")).not.toContain("//");
    }
    // Cas d'école : l'hôte underscore est celui attendu, pas un refus.
    const kt = JSON.parse(await ask({ op: "rewriteQrUrl", url: "https://lycee_jean_moulin.example/pronote/eleve.html" })) as { url: string };
    expect(kt.url).toBe(
      "https://lycee_jean_moulin.example/pronote/mobile.eleve.html" +
        "?fd=1&bydlg=A6ABB224-12DD-4E31-AD3E-8A39A1C2C335&login=true",
    );
    // IDN : punycode, comme `new URL()`.
    const idn = JSON.parse(await ask({ op: "rewriteQrUrl", url: "https://école.example/pronote/eleve.html" })) as { url: string };
    expect(idn.url).toBe(tsRewrite("https://école.example/pronote/eleve.html"));
    // Hôte IDN : l'URL reste utilisable telle quelle (ASCII, un seul `/`).
    expect(idn.url.startsWith("https://xn--cole-9oa.example/pronote/mobile.eleve.html?")).toBe(true);
    // Refus : autorité sans hôte ou port illisible (le TS jette un TypeError,
    // le port un IllegalArgumentException — même refus des deux côtés).
    for (const raw of ["https://:8443/x", "https://ecole.example:abc/x", "https://ecole.example:8443:90/x", "https://ecole.example:99999/x"]) {
      const bad = portError(await ask({ op: "rewriteQrUrl", url: raw }, true));
      expect(`rewriteQrUrl ${raw} -> ${bad.name}`).toBe(`rewriteQrUrl ${raw} -> IllegalArgumentException`);
      expect(() => new URL(raw)).toThrow();
    }
  });

  test.skipIf(skip)("auth : sécurisation active => second tour `token`", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      tsa.script.securisation = 1;
      kta.script.securisation = 1;
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      // Deux handshakes (FP) de chaque côté, mode final `token`.
      expect(tsa.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      expect(kta.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      // Temp FRAIS au second tour (pas de rejeu d'aléa), des deux côtés (C10).
      for (const stub of [tsa, kta]) {
        const uuids = stub.posts
          .filter((p) => p.id === "FonctionParametres")
          .map((p) => ((p.inner as { data: { Uuid: string } }).data.Uuid));
        expect(new Set(uuids).size).toBe(2);
        for (const u of uuids) expect(Buffer.from(u, "base64").length).toBe(16);
      }
      expect(tsClient.loginMode).toBe("token");
      const ktState = JSON.parse(await ask({ op: "clientState", cid: ktCid })) as { loginMode: string };
      expect(ktState.loginMode).toBe("token");
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("auth : refus typés (PIN faux, hex pourri, sans cle, 2FA)", async () => {
    // PIN faux : déchiffrement QR impossible.
    const badPinTs = await (async () => {
      try {
        const { Client: C } = await import("pronotets");
        await C.qrcodeLogin({ login: qrHex(PIN, LOGIN), jeton: qrHex(PIN, JETON), url: "http://127.0.0.1/x" } as never, "9999", UUID);
        return null;
      } catch (e) {
        return { name: (e as Error).name, message: (e as Error).message };
      }
    })();
    const badPinKt = portError(await ask({
      op: "clientQrcode", site: "http://127.0.0.1/x", loginHex: qrHex(PIN, LOGIN), jetonHex: qrHex(PIN, JETON),
      pin: "9999", uuid: UUID, qrUrl: "http://127.0.0.1/x",
    }, true));
    expect(badPinKt).toEqual({ name: badPinTs?.name ?? "", message: badPinTs?.message ?? "" });
    expect(badPinTs?.name).toBe("QRCodeDecryptError");

    // Hex pourri : même refus (le TS tronque en silence puis échoue au déchiffrement).
    const badHexKt = portError(await ask({
      op: "clientQrcode", site: "http://127.0.0.1/x", loginHex: "zz", jetonHex: "zz",
      pin: PIN, uuid: UUID, qrUrl: "http://127.0.0.1/x",
    }, true));
    expect(badHexKt.name).toBe("QRCodeDecryptError");

    // Sans `cle` + `skip2fa` : login `false` propre, pas de sonde (donc pas de gate).
    const tsa = startStub();
    const kta = startStub();
    try {
      tsa.script.auth = { noCle: true };
      kta.script.auth = { noCle: true };
      const tsClient = await tsLogin(tsa, { skip2fa: true });
      const ktLoginRes = JSON.parse(await ask({
        op: "clientQrcode", site: `${kta.base}/pronote/eleve.html`, loginHex: qrHex(PIN, LOGIN), jetonHex: qrHex(PIN, JETON),
        pin: PIN, uuid: UUID, qrUrl: `${kta.base}/pronote/eleve.html`, skip2fa: true,
      })) as { cid: number; loggedIn: boolean };
      expect(tsClient.logged_in).toBe(false);
      expect(ktLoginRes.loggedIn).toBe(false);
      // Aucune sonde `PageInfosPerso` : le login raté ne poste rien de plus.
      expect(tsa.posts.some((p) => p.id === "PageInfosPerso")).toBe(false);
      expect(kta.posts.some((p) => p.id === "PageInfosPerso")).toBe(false);
    } finally {
      tsa.close();
      kta.close();
    }

    // Sans `cle` SANS `skip2fa` : la sonde tourne quand même (`logged_in` ignoré,
    // upstream), la gate refuse (`onglets` vides), `refresh` rejoue, ça rejette
    // pareil des deux côtés. Bizarrerie fidèlement portée, pas corrigée ici.
    const tsa3 = startStub();
    const kta3 = startStub();
    try {
      tsa3.script.auth = { noCle: true };
      kta3.script.auth = { noCle: true };
      const tsErr = await (async () => {
        try {
          await tsLogin(tsa3);
          return null;
        } catch (e) {
          return { name: (e as Error).name, message: (e as Error).message };
        }
      })();
      const ktErr = portError(await ask({
        op: "clientQrcode", site: `${kta3.base}/pronote/eleve.html`, loginHex: qrHex(PIN, LOGIN), jetonHex: qrHex(PIN, JETON),
        pin: PIN, uuid: UUID, qrUrl: `${kta3.base}/pronote/eleve.html`,
      }, true));
      expect(tsErr?.name).toBe("PronoteAPIError");
      expect(ktErr).toEqual({ name: tsErr?.name ?? "", message: tsErr?.message ?? "" });
    } finally {
      tsa3.close();
      kta3.close();
    }

    // 2FA exigée sans PIN : `MFAError` des deux côtés.
    const tsa2 = startStub();
    const kta2 = startStub();
    try {
      tsa2.script.auth = { actions: "[3]", derniere: "12/09/2026 08:00:00", jeton: "tok" };
      kta2.script.auth = { actions: "[3]", derniere: "12/09/2026 08:00:00", jeton: "tok" };
      const tsErr = await (async () => {
        try {
          await tsLogin(tsa2);
          return null;
        } catch (e) {
          return { name: (e as Error).name, message: (e as Error).message };
        }
      })();
      const ktErr = portError(await ask({
        op: "clientQrcode", site: `${kta2.base}/pronote/eleve.html`, loginHex: qrHex(PIN, LOGIN), jetonHex: qrHex(PIN, JETON),
        pin: PIN, uuid: UUID, qrUrl: `${kta2.base}/pronote/eleve.html`,
      }, true));
      expect(tsErr?.name).toBe("MFAError");
      expect(ktErr).toEqual({ name: tsErr?.name ?? "", message: tsErr?.message ?? "" });
    } finally {
      tsa2.close();
      kta2.close();
    }
  });
}
