import { describe, expect, test } from "bun:test";
import { loadPushConfig } from "../../server/infrastructure/push-config";
import { HttpPushProvider, NoopPushProvider, hashToken } from "../../server/infrastructure/push-provider";

// Intégration réelle uniquement avec .env.local (Makefile : skip sans fichier).
// Aucun appel réseau externe : le provider est re-pointé vers un serveur local.
// Passe avec .env.local configuré ou non ; skip sans .env.local.
const hasEnv = await Bun.file(".env.local").exists();

describe.skipIf(!hasEnv)("integration push", () => {
  test("config chargée (ou noop gracieux) + send local sans fuite", async () => {
    const config = loadPushConfig();
    if (!config) {
      const noop = new NoopPushProvider();
      await noop.send("c".repeat(64), { title: "t", body: "b" });
      expect(true).toBe(true);
      return;
    }
    // Re-pointe vers boucle locale pour éviter tout réseau externe.
    const seen: { body?: string; auth?: string } = {};
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        seen.body = await req.text();
        seen.auth = req.headers.get("authorization") ?? "";
        return Response.json({ ok: true });
      },
    });
    try {
      const logs: string[] = [];
      const local = new HttpPushProvider(
        { ...config, provider: `http://127.0.0.1:${server.port}/send` },
        { logger: (m) => logs.push(m) },
      );
      const tokenHash = hashToken(`int-${Date.now()}`);
      await local.send(tokenHash, { title: "Nouvelle note", body: "15/20 en Maths" });
      expect(seen.body ?? "").toContain(tokenHash);
      expect(seen.auth ?? "").not.toContain(config.vapidPrivateKey);
      const joined = logs.join("\n");
      expect(joined).toContain(tokenHash.slice(0, 8));
      expect(joined).not.toContain(tokenHash);
      expect(joined).not.toContain(config.vapidPrivateKey);
      expect(joined).not.toContain(config.vapidPublicKey);
    } finally {
      server.stop(true);
    }
  });
});
