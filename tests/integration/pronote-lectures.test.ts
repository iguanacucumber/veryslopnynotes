import { describe, expect, test } from "bun:test";
import { PronoteHttpClient } from "../../server/integrations/PronoteHttpClient";
import { PronoteAuthProvider } from "../../server/integrations/pronote-auth";
import { PronoteLectureProvider } from "../../server/integrations/pronote-lectures";
import { PronoteReadError } from "../../server/domain/ports";
import { isAssignment, isGrade, isTimetableEntry } from "../../shared/contracts/models";

// Intégration réelle uniquement avec .env.local (jamais commité).
// Skip sinon (voir Makefile). Valeurs via env uniquement, jamais en dur.
const hasEnv = await Bun.file(".env.local").exists();

describe.skipIf(!hasEnv)("integration pronote-lectures", () => {
  test("lectures notes/devoirs/EDT (compte test .env.local)", async () => {
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
    const lectures = new PronoteLectureProvider({ client, sessions: auth, logger: (m) => logs.push(m) });
    const accountId = "integration-acc";
    try {
      await auth.authenticate({ accountId, username, password, entKind });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      return;
    }
    for (const read of [
      lectures.getGrades(accountId, { limit: 5 }),
      lectures.getAssignments(accountId, { limit: 5 }),
      lectures.getTimetable(accountId, { limit: 5 }),
    ]) {
      try {
        const page = await read;
        expect(page.items.__untrusted).toBe(true);
        expect(Array.isArray(page.items.value)).toBe(true);
        for (const item of page.items.value) {
          expect(isGrade(item) || isAssignment(item) || isTimetableEntry(item)).toBe(true);
        }
      } catch (e) {
        expect(e).toBeInstanceOf(PronoteReadError);
        const code = (e as PronoteReadError).code;
        expect(["session_expired", "ent_unavailable", "network", "timeout"]).toContain(code);
      }
    }
    const joined = logs.join("\n");
    if (password) expect(joined).not.toContain(password);
  });
});
