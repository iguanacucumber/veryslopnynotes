// Démarrage du scraper (I8) : loopback par défaut, exposition publique
// UNIQUEMENT avec opt-in explicite et jeton Bearer. Les refus arrivent avant
// le bind ; aucun test ne touche au réseau externe.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createApp, start } from "../../server/infrastructure/http";

const TOKEN = "jeton-public-de-test-0123456789";
const servers: ReturnType<typeof Bun.serve>[] = [];
const silences: { mockRestore: () => void }[] = [];

function quiet(): void {
  silences.push(spyOn(console, "log").mockImplementation(() => {}));
  silences.push(spyOn(console, "warn").mockImplementation(() => {}));
}

function launch(env: Record<string, string>): ReturnType<typeof Bun.serve> {
  // Clair hors boucle locale réservé aux tests : l'override explicite évite de
  // faire de `NODE_ENV=test` une porte de production.
  const server = start({ PORT: "0", VSN_TEST_ALLOW_CLEARTEXT: "1", ...env });
  servers.push(server);
  return server;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const spy of silences.splice(0)) spy.mockRestore();
});

describe("I8 — bind local par défaut, public explicite et authentifié", () => {
  test("loopback : démarre sans jeton et sert /v1/health", async () => {
    quiet();
    const server = launch({ HOST: "127.0.0.1" });
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/health`);
    expect(res.status).toBe(200);
  });

  test("non-loopback sans ALLOW_PUBLIC=1 : refus au démarrage", () => {
    quiet();
    expect(() => launch({ HOST: "0.0.0.0" })).toThrow(/ALLOW_PUBLIC/);
  });

  test("public explicite sans jeton : refus au démarrage", () => {
    quiet();
    expect(() => launch({ HOST: "0.0.0.0", ALLOW_PUBLIC: "1" })).toThrow(/SCRAPER_TOKEN/);
  });

  test("public explicite avec jeton : démarre et exige le Bearer", async () => {
    quiet();
    const server = launch({ HOST: "0.0.0.0", ALLOW_PUBLIC: "1", SCRAPER_TOKEN: TOKEN });
    const url = `http://127.0.0.1:${server.port}/v1/health`;
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    expect((await fetch(url, { headers: { authorization: "Bearer mauvais-jeton" } })).status).toBe(401);
  });

  test("createApp avec jeton : toutes les routes, /v1/health compris, sont fermées", async () => {
    const app = createApp({ token: TOKEN });
    expect((await app.handler(new Request("http://127.0.0.1/v1/health"))).status).toBe(401);
    expect(
      (
        await app.handler(
          new Request("http://127.0.0.1/v1/health", {
            headers: { authorization: `Bearer ${TOKEN}` },
          }),
        )
      ).status,
    ).toBe(200);
  });
});
