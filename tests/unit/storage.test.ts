import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorageProvider } from "../../server/infrastructure/sqlite-storage";

function tmpDb(): string {
  return join(mkdtempSync(join(tmpdir(), "vsls-")), "test.db");
}

describe("SqliteStorageProvider", () => {
  test("roundtrip binaire", async () => {
    const p = new SqliteStorageProvider(tmpDb());
    const bin = new Uint8Array([0, 1, 2, 255, 128, 42]);
    await p.set("k", bin);
    expect(await p.get("k")).toEqual(bin);
    p.close();
  });

  test("get absent → null", async () => {
    const p = new SqliteStorageProvider(tmpDb());
    expect(await p.get("nope")).toBeNull();
    p.close();
  });

  test("overwrite", async () => {
    const p = new SqliteStorageProvider(tmpDb());
    await p.set("k", new Uint8Array([1]));
    await p.set("k", new Uint8Array([2, 3]));
    expect(await p.get("k")).toEqual(new Uint8Array([2, 3]));
    p.close();
  });

  test("persistance après close/reopen", async () => {
    const path = tmpDb();
    const a = new SqliteStorageProvider(path);
    await a.set("k", new Uint8Array([9, 9, 9]));
    a.close();
    const b = new SqliteStorageProvider(path);
    expect(await b.get("k")).toEqual(new Uint8Array([9, 9, 9]));
    b.close();
  });

  test("migrations idempotentes (open x2 OK)", async () => {
    const path = tmpDb();
    const a = new SqliteStorageProvider(path);
    await a.set("k", new Uint8Array([7]));
    a.close();
    const b = new SqliteStorageProvider(path);
    expect(await b.get("k")).toEqual(new Uint8Array([7]));
    b.close();
  });

  test("I3 statique : aucun import sqlite dans server/domain/", () => {
    const dir = join(import.meta.dir, "..", "..", "server", "domain");
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!/\.(ts|tsx|js)$/.test(f)) continue;
      const code = readFileSync(join(dir, f), "utf8")
        .split("\n")
        .filter((l) => {
          const t = l.trim();
          return !t.startsWith("//") && !t.startsWith("*");
        })
        .join("\n");
      if (/import\s+[^;]*sqlite|from\s+['"][^'"]*sqlite|require\s*\([^)]*sqlite|bun:sqlite|better-sqlite3/i.test(code))
        offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
