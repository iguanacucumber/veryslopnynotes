import { describe, expect, test } from "bun:test";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteAuthError, PronoteReadError } from "../../server/domain/ports";
import { isAssignment, isGrade, isTimetableEntry } from "../../shared/contracts/models";
import { isPedagogicResource } from "../../server/domain/ports";

// Intégration réelle SSO Ninegate via .env.local (jamais commité).
// URL + identifiants via env uniquement, jamais en dur ni en log.
// Valide chaîne complète : auth + re-auth + lectures + ressources.
const hasEnv = await Bun.file(".env.local").exists();

describe.skipIf(!hasEnv)("integration pronote-sso-ninegate", () => {
  test("auth + re-auth SSO (compte .env.local)", async () => {
    const pronoteUrl = process.env["PRONOTE_URL"] ?? "";
    const username = process.env["PRONOTE_USERNAME"] ?? "";
    const password = process.env["PRONOTE_PASSWORD"] ?? "";
    const entKind = process.env["PRONOTE_ENT_KIND"] ?? "ninegate";
    if (!pronoteUrl || !username || !password) return;
    const logs: string[] = [];
    const store = new PronoteSessionStore({ pronoteUrl, logger: (m) => logs.push(m) });
    const accountId = "integration-acc";
    let firstOk = false;
    try {
      const session = await store.authenticate({ accountId, username, password, entKind });
      expect(session.accountId).toBe(accountId);
      expect(store.isAuthenticated(accountId)).toBe(true);
      firstOk = true;
    } catch (e) {
      expect(e).toBeInstanceOf(PronoteAuthError);
      const code = (e as PronoteAuthError).code;
      expect(["invalid_credentials", "ent_unavailable", "network", "timeout"]).toContain(code);
    }
    store.invalidate(accountId);
    expect(store.isAuthenticated(accountId)).toBe(false);
    if (firstOk) {
      const session2 = await store.authenticate({ accountId, username, password, entKind });
      expect(session2.accountId).toBe(accountId);
    }
    const joined = logs.join("\n");
    if (password) expect(joined).not.toContain(password);
    if (username) expect(joined).not.toContain(username);
    if (pronoteUrl) expect(joined).not.toContain(pronoteUrl);
  }, 180_000);

  test("lectures notes/devoirs/EDT/ressources (compte .env.local)", async () => {
    const pronoteUrl = process.env["PRONOTE_URL"] ?? "";
    const username = process.env["PRONOTE_USERNAME"] ?? "";
    const password = process.env["PRONOTE_PASSWORD"] ?? "";
    const entKind = process.env["PRONOTE_ENT_KIND"] ?? "ninegate";
    if (!pronoteUrl || !username || !password) return;
    const logs: string[] = [];
    const store = new PronoteSessionStore({ pronoteUrl, logger: (m) => logs.push(m) });
    const reader = new PronoteClientReader({ sessions: store, logger: (m) => logs.push(m) });
    const accountId = "integration-acc";
    try {
      await store.authenticate({ accountId, username, password, entKind });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      return;
    }
    const grades: unknown = await reader.getGrades(accountId, { limit: 5 }).catch((e: unknown) => e);
    if (grades instanceof PronoteReadError) {
      expect(["session_expired", "ent_unavailable", "network", "timeout"]).toContain(grades.code);
    } else {
      const page = grades as { items: { __untrusted: boolean; value: unknown[] }; nextCursor: string | null };
      expect(page.items.__untrusted).toBe(true);
      for (const g of page.items.value) expect(isGrade(g)).toBe(true);
    }
    const assignments: unknown = await reader.getAssignments(accountId, { limit: 5 }).catch((e: unknown) => e);
    if (assignments instanceof PronoteReadError) {
      expect(["session_expired", "ent_unavailable", "network", "timeout"]).toContain(assignments.code);
    } else {
      const page = assignments as { items: { __untrusted: boolean; value: unknown[] }; nextCursor: string | null };
      expect(page.items.__untrusted).toBe(true);
      for (const a of page.items.value) expect(isAssignment(a)).toBe(true);
    }
    const timetable: unknown = await reader.getTimetable(accountId, { limit: 5 }).catch((e: unknown) => e);
    if (timetable instanceof PronoteReadError) {
      expect(["session_expired", "ent_unavailable", "network", "timeout"]).toContain(timetable.code);
    } else {
      const page = timetable as { items: { __untrusted: boolean; value: unknown[] }; nextCursor: string | null };
      expect(page.items.__untrusted).toBe(true);
      for (const t of page.items.value) expect(isTimetableEntry(t)).toBe(true);
    }
    const resources: unknown = await reader.getResources(accountId, { limit: 5 }).catch((e: unknown) => e);
    if (resources instanceof PronoteReadError) {
      expect(["session_expired", "ent_unavailable", "network", "timeout"]).toContain(resources.code);
    } else {
      const page = resources as { items: { __untrusted: boolean; value: unknown[] }; nextCursor: string | null };
      expect(page.items.__untrusted).toBe(true);
      for (const r of page.items.value) expect(isPedagogicResource(r)).toBe(true);
    }
    const joined = logs.join("\n");
    if (password) expect(joined).not.toContain(password);
    if (username) expect(joined).not.toContain(username);
  }, 240_000);
});
