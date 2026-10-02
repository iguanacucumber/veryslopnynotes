// Adapter SQLite de StorageProvider. Vit hors domain (I3 strict).
// Contrat structurel avec server/domain/ports.ts, sans import inverse.
import { Database } from "bun:sqlite";
import type { StorageProvider } from "../domain/ports";
import { migrate } from "./migrations";

export class SqliteStorageProvider implements StorageProvider {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    migrate(this.db);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const row = this.db
      .query("SELECT value FROM kv WHERE key = ?")
      .get(key) as { value: Uint8Array | null } | null;
    if (!row) return null;
    if (row.value == null) return null;
    return new Uint8Array(row.value);
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    this.db.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
      key,
      value,
    ]);
  }

  close(): void {
    this.db.close();
  }
}
