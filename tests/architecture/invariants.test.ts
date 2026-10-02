import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function list(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) {
        if ([".git", "node_modules"].includes(e)) continue;
        walk(p);
      } else if (/\.(ts|tsx|kt|kts|java)$/.test(e)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe("invariants", () => {
  test("I1: android sans hote Pronote/ENT", () => {
    const files = list(join(ROOT, "android")).filter((f) => {
      try {
        return /pronote|index-education/i.test(readFileSync(f, "utf8"));
      } catch { return false; }
    });
    expect({ files }).toEqual({ files: [] });
  });

  test("I3: domain sans sqlite ni framework HTTP", () => {
    const files = list(join(ROOT, "server/domain")).filter((f) => {
      const code = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => {
          const t = l.trim();
          return !t.startsWith("//") && !t.startsWith("*");
        })
        .join("\n");
      return (
        /import\s+[^;]*sqlite|from\s+['"][^'"]*sqlite|bun:sqlite|better-sqlite3/i.test(code) ||
        /from\s+['"]hono|from\s+['"]express|Bun\.serve/.test(code)
      );
    });
    expect(files).toEqual([]);
  });

  test("I2: un seul PronoteHttpClient", () => {
    const server = list(join(ROOT, "server"));
    const defs = server.filter((f) => /class PronoteHttpClient/.test(readFileSync(f, "utf8")));
    expect(defs.length).toBeLessThanOrEqual(1);
  });

  test("circuit agentique: check-pr refuse PR sans double review", async () => {
    const proc = Bun.spawnSync(["bun", "run", "agents/runtime/check-pr.ts", ".agents/prs/TEMPLATE.md", "0".repeat(40)], { cwd: ROOT });
    expect(proc.exitCode).not.toBe(0);
  });
});
