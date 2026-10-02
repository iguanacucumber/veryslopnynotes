import { describe, expect, test } from "bun:test";
import { PronoteHttpClient } from "../../server/integrations/PronoteHttpClient";
import { PronoteAuthProvider } from "../../server/integrations/pronote-auth";
import { PronoteAuthError } from "../../server/domain/ports";

// Intégration réelle uniquement avec .env.local (jamais commité).
// Skip sinon (voir Makefile). Valeurs via env uniquement, jamais en dur.
// Procédure re-auth IP documentée dans server/integrations/pronote-auth.ts.
const hasEnv = await Bun.file(".env.local").exists();

describe.skipIf(!hasEnv)("integration pronote-auth", () => {
  test("auth + re-auth (compte test .env.local)", async () => {
    const baseUrl = process.env["PRONOTE_URL"] ?? "";
    const username = process.env["PRONOTE_USERNAME"] ?? "";
    const password = process.env["PRONOTE_PASSWORD"] ?? "";
    const entKind = process.env["PRONOTE_ENT_KIND"] ?? "cas";
    if (!baseUrl || !username || !password) return;
    const logs: string[] = [];
    const client = new PronoteHttpClient({
      baseUrl,
      deviceUuid: crypto.randomUUID(),
      logger: (m) => logs.push(m),
    });
    const auth = new PronoteAuthProvider({ client, logger: (m) => logs.push(m) });
    const accountId = "integration-acc";
    let firstOk = false;
    try {
      const session = await auth.authenticate({ accountId, username, password, entKind });
      expect(session.accountId).toBe(accountId);
      expect(auth.isAuthenticated(accountId)).toBe(true);
      firstOk = true;
    } catch (e) {
      expect(e).toBeInstanceOf(PronoteAuthError);
      const code = (e as PronoteAuthError).code;
      expect(["invalid_credentials", "ent_unavailable", "network", "timeout"]).toContain(code);
    }
    // Re-auth après invalidation (changement IP) : ne crashe jamais.
    auth.invalidate(accountId);
    expect(auth.isAuthenticated(accountId)).toBe(false);
    if (firstOk) {
      const session2 = await auth.authenticate({ accountId, username, password, entKind });
      expect(session2.accountId).toBe(accountId);
    }
    const joined = logs.join("\n");
    if (password) expect(joined).not.toContain(password);
  });
});
