// Chasse aux bugs du point d'entrée HTTP (server/infrastructure/http.ts).
// Un test = UN bug, et il doit être ROUGE tant que le bug est dans le source.
// Fakes 100 % synthétiques : aucun réseau (Bun.serve uniquement sur 127.0.0.1
// éphémère), aucun secret, aucun credential serveur. Le seul TLS est un
// certificat auto-signé jetable, généré dans un tmpdir puis supprimé.
import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, start } from "../../server/infrastructure/http";

// 0.7.0 : plus aucune variable de credential. Le serveur se construit sans env.

const EMPTY_PAGE = { items: { __untrusted: true, value: [] }, nextCursor: null };

/** Store de session fake : aucun réseau, on compte ce que le source appelle. */
function fakeSessions(account: string | null = "acc-bug") {
  const calls: string[] = [];
  const store = {
    async authenticate(c: { accountId: string; pin: string }) {
      calls.push(`authenticate(pin="${c.pin}")`);
      return { accountId: c.accountId };
    },
    currentAccountId: () => account,
    async refreshSession() {
      calls.push("refreshSession");
    },
    requireClient(): never {
      throw new Error("aucun client (fake)");
    },
  };
  return { sessions: store as never, calls };
}

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
 * Appaire un device comme le fait l'app, VIA les deux seules routes ouvertes :
 * le `PairingService` est interne à `createApp` (non injectable), le parcours
 * réel start -> confirm est donc le seul moyen d'obtenir le bearer. PIN et
 * token synthétiques, aucun réseau, aucun secret en dur.
 */
async function appairer(
  app: { handler: (req: Request) => Promise<Response> },
): Promise<{ authorization: string }> {
  const start = await app.handler(
    new Request("http://127.0.0.1/v1/pairing/start", {
      method: "POST",
      body: JSON.stringify({ deviceName: "pixel-test" }),
    }),
  );
  const { sessionId, code } = (await start.json()) as { sessionId: string; code: string };
  const confirm = await app.handler(
    new Request("http://127.0.0.1/v1/pairing/confirm", {
      method: "POST",
      body: JSON.stringify({ sessionId, code }),
    }),
  );
  const { token } = (await confirm.json()) as { token: string };
  // Le bearer des routes fermées : sans lui, le 401 de la porte d'entrée
  // masquerait le statut métier que ces tests de bugs veulent observer.
  return { authorization: `Bearer ${token}` };
}

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

  test("BUG: warmup() appelle liveSync.run() hors du garde-fou mono-relecture — le pull-refresh de l'app part en parallèle sur la MÊME session Pronote (rafale de session_expired) et les deux passes écrivent le même snapshot de diff", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = {
      async getGrades() {
        entered += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await gate;
        concurrent -= 1;
        return EMPTY_PAGE;
      },
      async getAssignments() {
        return EMPTY_PAGE;
      },
      async getTimetable() {
        return EMPTY_PAGE;
      },
    } as never;
    const { sessions } = fakeSessions();
    const app = createApp({ reader, sessions });

    const warm = app.warmup(); // exactement ce que fait start() au boot
    while (entered === 0) await Bun.sleep(1); // warmup est entré dans la lecture
    const refresh = app.handler(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: "{}" }),
    );
    // Laisse la 2e lecture démarrer si elle n'est pas sérialisée (bug attendu).
    const deadline = Date.now() + 2_000;
    while (entered === 1 && Date.now() < deadline) await Bun.sleep(1);
    release();
    await Promise.all([warm, refresh]);

    expect(maxConcurrent).toBe(1);
  });

  test("BUG: POST /v1/sync/refresh répond 200 {events: []} sans aucun reader branché — faux succès (le handler impose 501 « relecture non branchée », cf. tous les autres ports absents)", async () => {
    // reader null => la relecture ne peut JAMAIS aboutir.
    const app = createApp({ reader: null, sessions: null });
    // Device appairé : la porte d'entrée laisse passer, le 501 du port absent
    // reste le statut observé (et non un 401 d'authentification).
    const auth = await appairer(app);
    const res = await app.handler(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", headers: auth, body: "{}" }),
    );
    expect(res.status).toBe(501);
  });

  test("BUG: warmup() journalise « snapshot initial rempli » alors que TOUTES les lectures Pronote ont échoué — faux succès au boot, l'app croit le snapshot peuplé", async () => {
    let failures = 0;
    const boom = async () => {
      failures += 1;
      throw new Error("session expirée (fake)");
    };
    const reader = { getGrades: boom, getAssignments: boom, getTimetable: boom } as never;
    const { sessions } = fakeSessions();
    const app = createApp({ reader, sessions });

    const { value: grades, logs } = await withServerLogs(async () => {
      await app.warmup();
      return app.store.grades();
    });

    expect(failures).toBeGreaterThan(0); // le reader a bien tout rejeté
    expect(grades).toHaveLength(0); // ... donc le snapshot est vide
    const claim = logs.find((l) => l.includes("snapshot initial rempli"));
    expect(claim ? `log menteur : ${claim} (${failures} lectures en échec)` : "aucun faux succès journalisé").toBe(
      "aucun faux succès journalisé",
    );
  });

  test("BUG: le setup journalise « snapshot rafraichi » alors que la relecture vient d'être explicitement sautée — mensonge de log sur un faux succès (I6)", async () => {
    // Aucune session ouverte : le setup joue donc son vrai rôle (QR reçu -> auth).
    const { sessions } = fakeSessions(null);
    // reader null : le skip est garanti (« sync -> skip (aucune session Pronote) »).
    const { value, logs } = await withServerLogs(async (captures) => {
      const app = createApp({ reader: null, sessions });
      const res = await app.handler(
        new Request("http://127.0.0.1/v1/setup", {
          method: "POST",
          body: JSON.stringify({
            deviceName: "app-test",
            schoolUrl: "https://etablissement.example.test/pronote",
            qr: { login: "bG9naW4tZmFrZS1VTlJFQUw=", jeton: "amV0b24tZmFrZS1VTlJFQUw=" },
            pin: "0000-UNREAL",
          }),
        }),
      );
      // Fire-and-forget : on laisse la chaîne authenticate -> refresh -> log finir.
      for (let i = 0; i < 200 && !captures.some((l) => l.includes("relecture ignoree")); i += 1) await Bun.sleep(1);
      return { status: res.status, app };
    });

    expect(value.status).toBe(200);
    expect(value.app.store.grades()).toHaveLength(0); // aucune lecture n'a pu alimenter le snapshot
    const claim = logs.find((l) => l.includes("snapshot rafraichi"));
    expect(claim ? `log menteur : ${claim}` : "aucun faux succès journalisé").toBe(
      "aucun faux succès journalisé",
    );
    // ...et la ligne honnête est bien là : session ouverte, relecture ignorée.
    expect(logs.some((l) => l.includes("setup ->") && l.includes("relecture ignoree"))).toBe(true);
  });

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
      const res = await fetch(`https://127.0.0.1:${server.port}/v1/pairing/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceName: "pixel-tls" }),
        tls: { rejectUnauthorized: false },
      });
      expect(res.status).toBe(200);
      // Le même port ne répond PAS en clair : un serveur HTTPS mal câblé qui
      // laisserait passer du HTTP se verrait ici.
      await expect(fetch(`http://127.0.0.1:${server.port}/v1/pairing/start`, { method: "POST" })).rejects.toThrow();
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("0.7.0 : warmup() n'authentifie JAMAIS — aucun credential serveur, donc aucune session à ouvrir au boot", async () => {
    const { sessions, calls } = fakeSessions();
    const app = createApp({ sessions });
    await app.warmup();
    // Une session existe (fake) donc seule la renewal part : jamais un
    // `authenticate`, qui exigerait un credential que le serveur n'a pas.
    expect(calls.filter((c) => c.startsWith("authenticate"))).toEqual([]);
  });

  test("0.7.0 : sans session, warmup() ne fait strictement rien", async () => {
    const { sessions, calls } = fakeSessions(null);
    const app = createApp({ sessions });
    await app.warmup();
    expect(calls).toEqual([]);
  });
});
