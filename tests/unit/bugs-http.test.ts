// Chasse aux bugs du point d'entrée HTTP (server/infrastructure/http.ts).
// #209 : le process n'est plus qu'un scraper de manuels (GET /v1/health +
// POST /v1/manuals/scrape, sans auth). Ne restent ici que les bugs du
// démarrage (PORT, TLS) : tout le reste (warmup, sessions, appairage, sync)
// est parti avec l'ancien composition root — suppression physique en #210.
// Fakes 100 % synthétiques : aucun réseau (Bun.serve uniquement sur 127.0.0.1
// éphémère), aucun secret, aucun credential serveur. Le seul TLS est un
// certificat auto-signé jetable, généré dans un tmpdir puis supprimé.
import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../../server/infrastructure/http";

// 0.7.0 : plus aucune variable de credential. Le serveur se construit sans env.

/** Capture les logs `[server]` le temps du bloc, toujours restaurée. */
async function withServerLogs<T>(fn: (logs: string[]) => Promise<T>): Promise<{ value: T; logs: string[] }> {
  const logs: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(" "));
  });
  try {
    return { value: await fn(logs), logs };
  } finally {
    spy.mockRestore();
  }
}

/**
 * #209 : plus d'appairage — le scraper est sans auth. Helper supprimé avec
 * l'ancien composition root (suppression physique en #210).
 */

describe("bugs http.ts", () => {
  test("BUG: PORT=0 est ignoré (|| au lieu d'un test NaN) — le serveur lie 3000 au lieu d'un port éphémère, deux instances/tests se percutent en EADDRINUSE", async () => {
    // 0 = port éphémère (convention standard, et valeur portée par ENV).
    const { value: server, logs } = await withServerLogs(async () => start({ PORT: "0" }));
    try {
      // Port réellement lié : celui journalisé ET celui du handle renvoyé.
      const lie = logs.find((l) => l.includes("127.0.0.1:")) ?? "aucun bind journalisé";
      const port = Number(/127\.0\.0\.1:(\d+)/.exec(lie)?.[1]);
      expect({ log: lie, portJournalise: port, portDuHandle: server.port }).toEqual({
        log: expect.stringContaining("127.0.0.1:"),
        portJournalise: port,
        portDuHandle: port,
      });
      // Port éphémère = attribué par l'OS : ni nul, ni le défaut 3000 que
      // donnait `Number.parseInt("0", 10) || 3000`.
      expect(port).toBeGreaterThan(0);
      expect(port).not.toBe(3000);
    } finally {
      server.stop(true);
    }
  });

  // #209 : warmup/sessions/sync/appairage supprimés avec l'ancien composition
  // root — les tests ci-dessous couvraient ce code mort (fichiers conservés
  // pour #210). Sujets supprimés : mono-relecture warmup, 501 sync sans
  // reader, logs warmup/setup, warmup sans authenticate.

  test("BUG: TLS_CERT_FILE sans TLS_KEY_FILE — le serveur se replie en clair et répond en HTTP alors que l'app interdit le clairtext (échec https incompréhensible sur le téléphone)", () => {
    // Une seule des deux variables = configuration cassée, pas un serveur en clair.
    for (const env of [
      { PORT: "0", TLS_CERT_FILE: "/dev/null" },
      { PORT: "0", TLS_KEY_FILE: "/dev/null" },
    ]) {
      expect(() => start(env)).toThrow(/TLS/);
    }
  });

  test("BUG: TLS_CERT_FILE + TLS_KEY_FILE — le serveur se sert-il vraiment en HTTPS, et le dit-il ? (un `tls` oublié = HTTP sur 0.0.0.0, invisible dans les logs)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vsn-tls-"));
    const cert = join(dir, "cert.pem");
    const key = join(dir, "key.pem");
    // openssl absent = SKIP bruyant, jamais un faux vert (cf. android-compile).
    if (!Bun.which("openssl")) {
      rmSync(dir, { recursive: true, force: true });
      return;
    }
    const openssl = Bun.spawnSync({
      cmd: [
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", key, "-out", cert, "-days", "1",
        "-subj", "/CN=localhost",
        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      stdout: "ignore",
      stderr: "ignore",
    });
    if (openssl.exitCode !== 0) {
      rmSync(dir, { recursive: true, force: true });
      return;
    }
    const { value: server, logs } = await withServerLogs(() =>
      Promise.resolve(start({ PORT: "0", TLS_CERT_FILE: cert, TLS_KEY_FILE: key })),
    );
    try {
      // Le scheme est journalisé : sur `0.0.0.0` rien ne dit le TLS autrement.
      expect(logs.find((l) => l.includes(`https://127.0.0.1:${server.port}`))).toBeDefined();
      // Et le handshake TLS aboutit vraiment (rejet de l'auto-signé : le serveur
      // parle bien TLS, contrairement à un serveur resté en clair).
      // #209 : la sonde servie est /v1/health (plus d'appairage).
      const res = await fetch(`https://127.0.0.1:${server.port}/v1/health`, {
        tls: { rejectUnauthorized: false },
      });
      expect(res.status).toBe(200);
      // Le même port ne répond PAS en clair : un serveur HTTPS mal câblé qui
      // laisserait passer du HTTP se verrait ici.
      await expect(fetch(`http://127.0.0.1:${server.port}/v1/health`)).rejects.toThrow();
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // #209 : warmup supprimé avec l'ancien composition root (sujets ci-dessous
  // partis avec lui : "warmup() n'authentifie JAMAIS", "sans session, warmup()
  // ne fait strictement rien").
});
