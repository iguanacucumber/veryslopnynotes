// Migrations versionnées SQLite. Table _migrations(version INTEGER PK).
// Version 1 : table kv(key TEXT PK, value BLOB NOT NULL).
import type { Database } from "bun:sqlite";

export interface Migration {
  readonly version: number;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value BLOB NOT NULL)",
  },
] as const;

export function migrate(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)");
  const applied = new Set(
    (db.query("SELECT version FROM _migrations").all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.run(m.sql);
    db.run("INSERT INTO _migrations (version) VALUES (?)", [m.version]);
  }
}
