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

/** Colonnes attendues sur kv : vérifiées après migration (fail fast au boot). */
const KV_COLUMNS: readonly string[] = ["key", "value"];

export function migrate(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)");
  const applied = new Set(
    (db.query("SELECT version FROM _migrations").all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
  if (pending.length > 0) {
    // Transaction explicite autour du DDL + du numéro de version : sans elle,
    // une panne entre les deux (crash, disque plein, CHECK du ledger) laisse le
    // DDL sur disque et la migration est rejouée au prochain démarrage.
    db.run("BEGIN");
    try {
      for (const m of pending) {
        db.run(m.sql);
        db.run("INSERT INTO _migrations (version) VALUES (?)", [m.version]);
      }
      db.run("COMMIT");
    } catch (e) {
      // Rollback best-effort : une transaction déjà annulée ne doit pas masquer
      // l'erreur d'origine (c'est elle qu'on veut remonter).
      try {
        db.run("ROLLBACK");
      } catch {}
      throw e;
    }
  }
  assertSchema(db);
}

/**
 * Un ledger _migrations cohérent ne prouve rien du schéma : une base dérivée
 * (version 1 enregistrée mais table kv absente) s'ouvrirait sans erreur et
 * l'échec n'apparaîtrait qu'à la première écriture. On refuse au démarrage.
 */
function assertSchema(db: Database): void {
  const columns = (db.query("PRAGMA table_info(kv)").all() as { name: string }[]).map(
    (c) => c.name,
  );
  const missing = KV_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    throw new Error(
      `schéma SQLite inattendu : table kv sans colonne(s) ${missing.join(", ")} (trouvées : ${columns.join(", ") || "aucune"})`,
    );
  }
}
