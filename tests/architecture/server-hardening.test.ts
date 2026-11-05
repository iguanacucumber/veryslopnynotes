// Durcissements serveur : pré-vol SSRF épinglé (pas de seconde résolution),
// échéance absolue du corps, refus du clair hors boucle locale et sonde
// `/v1/ready` sans détail interne. Aucun réseau externe : serveur HTTP local,
// résolveurs injectés, fausse promesse de scrape.
import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp, start } from "../../server/infrastructure/http";
import { fetchPinned, resolvePublicHost } from "../../server/infrastructure/ssrf";
import type { HostResolver } from "../../server/infrastructure/ssrf";

const servers: Array<{ close: (done?: () => void) => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe("pré-vol SSRF : connexion épinglée", () => {
  test("la requête part vers l'adresse validée, Host et chemin restent ceux du nom", async () => {
    let seenHost = "";
    let seenPath = "";
    const server = createServer((req, res) => {
      seenHost = req.headers.host ?? "";
      seenPath = req.url ?? "";
      res.end("ok");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    // Aucune résolution système de `rebind.example.invalid` : l'adresse est
    // fournie par la garde. Une seconde résolution irait vers 127.0.0.1.
    const res = await fetchPinned(
      new URL(`http://rebind.example.invalid:${port}/sommaire?x=1`),
      ["127.0.0.1"],
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(seenHost).toBe(`rebind.example.invalid:${port}`);
    expect(seenPath).toBe("/sommaire?x=1");
  });

  test("une résolution lente est annulée par l'échéance (dns.lookup ignore le signal)", async () => {
    const never: HostResolver = () => new Promise<readonly string[]>(() => {});
    const signal = AbortSignal.timeout(20);
    await expect(resolvePublicHost("lent.example.invalid", never, signal)).rejects.toThrow();
  });
});

describe("échéance absolue : corps lent et slot de concurrence", () => {
  test("un corps qui ne finit jamais rend 504, annule le flux et libère le slot", async () => {
    let scrapeCalls = 0;
    let cancelled = false;
    const app = createApp({
      timeoutMs: 40,
      scrape: async () => {
        scrapeCalls += 1;
        return [];
      },
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"platform":"p"'));
        // Jamais `close()` : le corps goutte puis se tait.
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("http://127.0.0.1/v1/manuals/scrape", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "4096" },
      body,
      duplex: "half",
    } as RequestInit);

    const res = await app.handler(req);
    expect(res.status).toBe(504);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("timeout");
    // Le scrape n'a jamais démarré, et le slot n'est pas resté tenu.
    expect(scrapeCalls).toBe(0);
    expect(cancelled).toBe(true);
    expect(app.inFlightScrapes()).toBe(0);
  });
});

describe("démarrage : pas de clair hors boucle locale", () => {
  test("HOST non-loopback sans TLS refuse AVANT le bind", () => {
    expect(() =>
      start({
        PORT: "0",
        HOST: "0.0.0.0",
        ALLOW_PUBLIC: "1",
        SCRAPER_TOKEN: "jeton-public-de-test-0123456789",
      }),
    ).toThrow(/TLS obligatoire hors boucle locale/);
  });

  test("un couple TLS blanc est refusé même sur la boucle locale", () => {
    expect(() =>
      start({
        PORT: "0",
        HOST: "127.0.0.1",
        TLS_CERT_FILE: "   ",
        TLS_KEY_FILE: "\t",
      }),
    ).toThrow(/TLS_CERT_FILE blanc/);
  });
});

describe("/v1/ready : 503 sans détail interne", () => {
  test("l'erreur de sonde n'entre jamais dans le corps", async () => {
    const app = createApp({
      readiness: () => {
        throw new Error("SECRET-INTERNAL /chemin/prive");
      },
    });
    const res = await app.handler(new Request("http://127.0.0.1/v1/ready"));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("SECRET-INTERNAL");
    expect(text).not.toContain("/chemin/prive");
    const body = JSON.parse(text) as { status: string; checks: Record<string, unknown> };
    expect(body.status).toBe("not_ready");
    expect(Object.values(body.checks).every((value) => typeof value === "boolean")).toBe(true);
  });
});
