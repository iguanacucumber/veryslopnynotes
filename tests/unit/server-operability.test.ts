// Opérabilité du scraper : `/v1/ready` dit la disponibilité RÉELLE (jar,
// navigateur, drain), SIGTERM laisse finir les scrapes, et l'image porte un
// HEALTHCHECK + des limites cgroup documentées (CA/HSTS réels côté opérateur).
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DRAIN_TIMEOUT_MS,
  createApp,
  createShutdown,
  start,
  type App,
} from "../../server/infrastructure/http";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const request = (path: string, init?: RequestInit) =>
  new Request(`http://127.0.0.1${path}`, init);

const servers: ReturnType<typeof Bun.serve>[] = [];
const silences: { mockRestore: () => void }[] = [];

function quiet(): void {
  silences.push(spyOn(console, "log").mockImplementation(() => {}));
  silences.push(spyOn(console, "warn").mockImplementation(() => {}));
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const spy of silences.splice(0)) spy.mockRestore();
});

describe("/v1/ready — disponibilité réelle, distincte de /v1/health", () => {
  test("tous les contrôles vrais = 200 ready", async () => {
    const app = createApp({ readiness: () => ({ jar: true, browser: true }) });
    const res = await app.handler(request("/v1/ready"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ready",
      checks: { jar: true, browser: true, accepting: true },
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("un contrôle faux = 503 not_ready avec le détail", async () => {
    const app = createApp({ readiness: () => ({ jar: true, browser: false }) });
    const res = await app.handler(request("/v1/ready"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "not_ready",
      checks: { jar: true, browser: false, accepting: true },
    });
  });

  test("une sonde qui lève est indisponible (503), jamais une panne 500", async () => {
    const app = createApp({
      readiness: () => {
        throw new Error("jar absent");
      },
    });
    const res = await app.handler(request("/v1/ready"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "not_ready",
      checks: { probe: false, accepting: true },
    });
  });

  test("le drain retire l'instance du trafic sans tuer la vivacité", async () => {
    const app = createApp({ readiness: () => ({ jar: true, browser: true }) });
    app.markDraining();
    const ready = await app.handler(request("/v1/ready"));
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({
      status: "not_ready",
      checks: { jar: true, browser: true, accepting: false },
    });
    expect((await app.handler(request("/v1/health"))).status).toBe(200);
  });

  test("HEAD renvoie le statut sans corps, POST est refusé 405", async () => {
    const app = createApp({ readiness: () => ({ jar: true, browser: true }) });
    const head = await app.handler(request("/v1/ready", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await app.handler(request("/v1/ready", { method: "POST" }));
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
  });

  test("le jeton public ferme aussi /v1/ready (I8)", async () => {
    const app = createApp({
      token: "jeton-public-de-test-0123456789",
      readiness: () => ({ jar: true, browser: true }),
    });
    expect((await app.handler(request("/v1/ready"))).status).toBe(401);
  });
});

describe("démarrage — /v1/ready utilise le jar préparé", () => {
  test("le serveur réel répond santé + disponibilité avec des contrôles réels", async () => {
    quiet();
    const server = start({ PORT: "0", HOST: "127.0.0.1" });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    expect((await fetch(`${base}/v1/health`)).status).toBe(200);

    const res = await fetch(`${base}/v1/ready`);
    expect([200, 503]).toContain(res.status);
    const body = (await res.json()) as {
      status: string;
      checks: { jar: boolean; browser: boolean; accepting: boolean };
    };
    // Le démarrage a préparé (ou vérifié) le répertoire 0700 du jar.
    expect(body.checks.jar).toBe(true);
    expect(typeof body.checks.browser).toBe("boolean");
    expect(body.checks.accepting).toBe(true);
    expect(body.status).toBe(body.checks.browser ? "ready" : "not_ready");
  });
});

describe("SIGTERM — drain gracieux", () => {
  function fakeApp(events: string[]): App {
    return {
      handler: async () => new Response(),
      inFlightScrapes: () => 0,
      markDraining: () => events.push("draining"),
    };
  }

  test("le drain passe AVANT la fermeture et attend les requêtes en cours", async () => {
    const events: string[] = [];
    const server = {
      stop: (force?: boolean) => {
        events.push(force === true ? "force" : "graceful");
        return Promise.resolve();
      },
    };
    await createShutdown(fakeApp(events), server, () => {}, 50)("SIGTERM");
    expect(events).toEqual(["draining", "graceful"]);
  });

  test("au-delà du délai, l'arrêt devient forcé", async () => {
    const events: string[] = [];
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = {
      stop: (force?: boolean) => {
        events.push(force === true ? "force" : "graceful");
        if (force === true) release();
        return pending;
      },
    };
    await createShutdown(fakeApp(events), server, () => {}, 10)("SIGTERM");
    expect(events).toEqual(["draining", "graceful", "force"]);
  });

  test("deux signaux ne relancent pas le drain", async () => {
    const events: string[] = [];
    const server = {
      stop: (force?: boolean) => {
        events.push(force === true ? "force" : "graceful");
        return Promise.resolve();
      },
    };
    const shutdown = createShutdown(fakeApp(events), server, () => {}, 50);
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    expect(events).toEqual(["draining", "graceful"]);
  });

  test("le délai par défaut couvre le scrape de 30 s", () => {
    expect(DRAIN_TIMEOUT_MS).toBeGreaterThan(30_000);
  });
});

describe("Dockerfile et documentation d'exploitation", () => {
  const dockerfile = read("Dockerfile.server");
  const readme = read("server/README.md");
  const published = /```sh\n(docker run[\s\S]*?)```/.exec(readme)?.[1] ?? "";
  const healthcheck = /HEALTHCHECK ([^\n]*\n\s*CMD [^\n]*)/.exec(dockerfile)?.[0] ?? "";

  test("HEALTHCHECK sonde /v1/ready avec fenêtre de démarrage et reprises", () => {
    expect(healthcheck).toContain("/v1/ready");
    for (const flag of ["--interval=", "--timeout=", "--start-period=", "--retries="]) {
      expect(healthcheck).toContain(flag);
    }
    expect(dockerfile).toMatch(/^STOPSIGNAL SIGTERM$/m);
  });

  test("la commande documentée pose des limites cgroup dures", () => {
    for (const flag of ["--memory=", "--memory-swap=", "--cpus=", "--pids-limit="]) {
      expect(published).toContain(flag);
    }
    expect(readme).toMatch(/limites DURES/i);
    expect(readme).toMatch(/OOM|mémoire/i);
  });

  test("la documentation sépare vivacité, disponibilité et drain", () => {
    expect(readme).toMatch(/\/v1\/health.*vivacité/is);
    expect(readme).toMatch(/\/v1\/ready.*disponibilité/is);
    expect(readme).toMatch(/SIGTERM/);
    expect(readme).toContain("--stop-timeout=40");
    expect(readme).toMatch(/35 s/);
  });

  test("CA réelle et HSTS sont documentés, pas seulement un certificat auto-signé", () => {
    expect(readme).toMatch(/ACME|Let's Encrypt|autorité de certification|AC publique/i);
    expect(readme).toMatch(/renouvel/i);
    expect(readme).toContain("Strict-Transport-Security");
    expect(readme).toContain("max-age=31536000");
    expect(readme).toMatch(/includeSubDomains/);
    expect(readme).toMatch(/proxy/i);
  });
});
