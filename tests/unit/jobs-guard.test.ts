import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Garde I7 (issue #17) : la détection sync ne passe jamais par un LLM.
// Aucun import server/ai, aucun provider LLM, aucun appel de génération
// dans server/jobs/. La revue humaine reste requise en complément.
const JOBS = join(import.meta.dir, "..", "..", "server/jobs");

function list(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...list(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("jobs guard", () => {
  test("I7: aucun chemin LLM dans server/jobs", () => {
    const offenders = list(JOBS).filter((f) => {
      const c = readFileSync(f, "utf8");
      return (
        /server\/ai|LLMProvider|from\s+['"][^'"]*\/ai['"]/.test(c) ||
        /\bgenerate\s*\(/.test(c) ||
        /fetch\s*\(/.test(c)
      );
    });
    expect({ offenders }).toEqual({ offenders: [] });
  });
});
