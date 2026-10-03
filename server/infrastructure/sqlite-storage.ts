// Adapter SQLite de StorageProvider. Vit hors domain (I3 strict).
// Contrat structurel avec server/domain/ports.ts, sans import inverse.
import { Database } from "bun:sqlite";
import type { StorageProvider } from "../domain/ports";
import { migrate } from "./migrations";

/** Attente max sur un verrou writer externe avant de rendre la main (PRAGMA). */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Normalise une valeur hors contrat (ex. un scalaire passé via `any`) en octets.
 * `new Uint8Array(5)` fabriquerait 5 octets nuls au lieu de l'octet 5.
 */
function toBytes(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array([Number(value)]);
}

export class SqliteStorageProvider implements StorageProvider {
  private readonly db: Database;
  /** Remplace la ligne d'une clé : DELETE puis INSERT, dans une transaction. */
  private readonly replace: ReturnType<Database["transaction"]>;

  constructor(path: string) {
    // Chemin vide = base anonyme privée en RAM chez SQLite : les écritures
    // « réussissent » puis tout disparaît au close/reopen. Config cassée, on
    // le dit plutôt que d'héberger des données en mémoire volatile.
    if (typeof path !== "string" || path.trim() === "") {
      throw new Error(
        "SqliteStorageProvider : chemin de base vide (SQLite ouvrirait une base éphémère en RAM, les écritures seraient perdues)",
      );
    }
    const db = new Database(path, { create: true });
    try {
      // busy_timeout d'abord : sans lui un écrivain concurrent donne SQLITE_BUSY
      // immédiat (WAL ne protège que les lecteurs d'un seul écrivain).
      db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      db.run("PRAGMA journal_mode = WAL");
      migrate(db);
    } catch (e) {
      // Sans ce close, chaque échec de migration/PRAGMA fuit un handle + un fd.
      db.close();
      throw e;
    }
    this.db = db;
    this.replace = db.transaction((key: string | null, bytes: Uint8Array) => {
      // DELETE avant INSERT : une clé NULL n'est pas dédupliquée par la PK
      // (NULL n'est jamais égal à NULL), donc l'upsert empilerait les lignes
      // et la dernière lecture ne verrait pas la dernière écriture.
      db.run("DELETE FROM kv WHERE key IS ?", [key]);
      db.run("INSERT INTO kv (key, value) VALUES (?, ?)", [key, bytes]);
    });
  }

  async get(key: string): Promise<Uint8Array | null> {
    // `IS` et non `=` : `WHERE key = NULL` ne matche jamais, une clé NULL
    // deviendrait alors illisible.
    const row = this.db.query("SELECT value FROM kv WHERE key IS ?").get(key) as {
      value: unknown;
    } | null;
    if (!row) return null;
    if (row.value == null) return null;
    // La colonne BLOB est sans affinité : un scalaire écrit à la main y rentre
    // sans erreur, et `new Uint8Array(5)` rendrait des octets fantômes.
    if (!(row.value instanceof Uint8Array)) {
      throw new Error(
        `SqliteStorageProvider : valeur kv non-bLOB (${typeof row.value}), base corrompue`,
      );
    }
    return new Uint8Array(row.value);
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    this.replace(key, toBytes(value));
  }

  close(): void {
    this.db.close();
  }
}
