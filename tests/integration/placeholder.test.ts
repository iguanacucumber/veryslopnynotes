import { describe, test } from "bun:test";

// Intégration réelle uniquement avec .env.local. Skip sinon (voir Makefile).
const hasEnv = await Bun.file(".env.local").exists();
describe.skipIf(!hasEnv)("integration", () => {
  test("pronote/pairing/push/api (phases 2+)", () => {});
});
