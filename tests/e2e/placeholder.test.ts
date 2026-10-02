import { describe, test } from "bun:test";

const hasEnv = await Bun.file(".env.local").exists();
describe.skipIf(!hasEnv)("e2e", () => {
  test("grades/assignments/manuals/revision-sheets (phases 7+)", () => {});
});
