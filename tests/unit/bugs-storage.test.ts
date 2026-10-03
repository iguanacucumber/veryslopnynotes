// Chasse aux bugs — couche persistance (sqlite-storage.ts / migrations.ts).
// Chaque test doit être ROUGE sur le code actuel. Bases jetables uniquement
// (mkdtemp dans os.tmpdir()) : aucun fichier du dépôt n'est touché.
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorageProvider } from "../../server/infrastructure/sqlite-storage";
import { MIGRATIONS, type Migration } from "../../server/infrastructure/migrations";

function tmpDb(): string {
  return join(mkdtempSync(join(tmpdir(), "vsls-bugs-")), "test.db");
}

/**
 * Écrivain concurrent dans un Worker = autre « process » (sync, backup, CLI
 * sqlite3). `set()` est SYNCHRONE côté source (bun:sqlite) : un `setTimeout`
 * du même thread ne tournerait jamais pendant l'attente du verrou, il faut un
 * vrai second thread qui le libère.
 */
function startConcurrentWriter(path: string, flag: Int32Array) {
  const source = `
import { Database } from "bun:sqlite";
const db = new Database(${JSON.stringify(path)});
db.run("BEGIN EXCLUSIVE");
db.run("INSERT INTO kv (key, value) VALUES ('verrou', x'00')");
postMessage("held");
onmessage = async (event) => {
  if (event.data?.cmd !== "go") return;
  // Pause AVANT le rollback : l'écrivain concurrent tient encore le verrou.
  await Bun.sleep(event.data.waitMs);
  // Drapeau posé AVANT le rollback : lire 1 dès que set() a rendu prouve que
  // l'écriture a rendu après la libération (atomique, donc sans horloge).
  Atomics.store(event.data.flag, 0, 1);
  db.run("ROLLBACK");
  db.close();
  postMessage("released");
  // Sortie propre du thread : sinon ses descripteurs survivent au test suivant
  // qui compte les fd du process.
  process.exit(0);
};
`;
  const worker = new Worker(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  // Filet de sécurité : un worker muet doit faire échouer le test, pas le pendre.
  const recu = (mot: string) =>
    new Promise<void>((resolve, reject) => {
      const garde = setTimeout(() => reject(new Error(`worker : « ${mot} » jamais reçu`)), 10_000);
      worker.addEventListener("message", function onMsg(e: MessageEvent): void {
        if (e.data !== mot) return;
        clearTimeout(garde);
        worker.removeEventListener("message", onMsg);
        resolve();
      });
    });
  return {
    /** Attend que le verrou exclusif soit réellement tenu par l'autre thread. */
    async verrouille(): Promise<void> {
      await recu("held");
    },
    /** Ordonne la libération du verrou, encore dans `waitMs` millisecondes. */
    libere(waitMs: number): void {
      worker.postMessage({ cmd: "go", flag, waitMs });
    },
    /** Attend la libération effective et ferme le worker. */
    async fin(): Promise<void> {
      await recu("released");
      await new Promise<void>((resolve) => {
        worker.addEventListener("close", () => resolve(), { once: true });
      });
      // Laisse retomber la fermeture des descripteurs du thread mort avant les
      // tests suivants (l'un d'eux compte les fd du process).
      await Bun.sleep(0);
    },
  };
}

/** Accès au handle brut pour inspecter le schéma (contournement de `private`). */
function raw(p: SqliteStorageProvider): Database {
  return (p as unknown as { db: Database }).db;
}

/** set() typé Uint8Array, appelé ici avec des valeurs hors contrat. */
function loose(p: SqliteStorageProvider): {
  set(key: unknown, value: unknown): Promise<void>;
  get(key: unknown): Promise<Uint8Array | null>;
} {
  return p as unknown as { set(key: unknown, value: unknown): Promise<void>; get(key: unknown): Promise<Uint8Array | null> };
}

describe("bugs — SqliteStorageProvider / migrations", () => {
  test("BUG: chemin de base vide accepté — SQLite ouvre une base anonyme en RAM, les set() « réussissent » et tout disparaît au close/reopen, sans aucune erreur", async () => {
    // Sémantique SQLite : une chaîne vide (ou blanche) = base temporaire privée,
    // jamais écriture sur disque. Typiquement atteint via `process.env.DB_PATH
    // ?? ""`. Config cassée => refus explicite au boot, le message nommant le
    // chemin, jamais un stockage en RAM volatile qui perd tout au redémarrage.
    for (const chemin of ["", "   "]) {
      expect(() => new SqliteStorageProvider(chemin)).toThrow(/chemin/i);
    }

    // Le refus ne doit pas casser le chemin normal : une base réelle écrit sur
    // disque et survit au close/reopen.
    const path = tmpDb();
    const a = new SqliteStorageProvider(path);
    await a.set("k", new Uint8Array([1, 2, 3]));
    a.close();

    const b = new SqliteStorageProvider(path);
    expect(await b.get("k")).toEqual(new Uint8Array([1, 2, 3]));
    b.close();
  });

  test("BUG: `key TEXT PRIMARY KEY` sans NOT NULL — une clé undefined est liée à NULL : set() réussit, get() renvoie null, et la PK ne déduplique pas les NULL", async () => {
    // SQLite (hormis INTEGER PRIMARY KEY) autorise NULL dans une PK : les
    // upserts successifs s'empilent au lieu de s'écraser, et `WHERE key = ?`
    // (NULL) ne matche jamais la ligne écrite.
    const p = new SqliteStorageProvider(tmpDb());
    const s = loose(p);
    await s.set(undefined, new Uint8Array([1]));
    await s.set(undefined, new Uint8Array([2]));

    // Une clé overwritten doit rester relisible (dernière écriture).
    expect(await s.get(undefined)).toEqual(new Uint8Array([2]));
    // ...et une seule ligne doit exister pour cette clé.
    const rows = raw(p).query("SELECT count(*) AS c FROM kv WHERE key IS NULL").get() as { c: number };
    expect(rows.c).toBe(1);
    p.close();
  });

  test("BUG: aucun `PRAGMA busy_timeout` — set() échoue en « database is locked » dès qu'un autre écrivain tient le verrou (WAL ne protège que les lecteurs)", async () => {
    const path = tmpDb();
    const p = new SqliteStorageProvider(path);
    await p.set("k", new Uint8Array([1]));

    // Autre connexion (autre process : sync, backup, CLI sqlite3) en écriture,
    // tenue dans un Worker puis libérée PENDANT que set() attend.
    const flag = new Int32Array(new SharedArrayBuffer(4));
    const concurrent = startConcurrentWriter(path, flag);
    await concurrent.verrouille();
    concurrent.libere(150);

    let err: unknown = null;
    try {
      await p.set("k2", new Uint8Array([2]));
    } catch (e) {
      err = e;
    }
    // Lu sans horloge et sans mesure de durée : le drapeau est posé par le
    // concurrent AVANT son rollback, donc set() ne peut l'avoir rendu qu'après
    // la libération — l'attente a bien eu lieu et l'écriture n'est pas perdue.
    const renduApresLiberation = Atomics.load(flag, 0);
    await concurrent.fin();

    expect({
      err: err === null ? null : String(err),
      setRenduApresLiberation: renduApresLiberation,
    }).toEqual({ err: null, setRenduApresLiberation: 1 });
    expect(await p.get("k2")).toEqual(new Uint8Array([2]));
    p.close();
  });

  test("BUG: migrate() n'est pas atomique — le DDL reste sur disque quand l'écriture de _migrations échoue, donc la migration est rejouée au prochain démarrage", () => {
    const path = tmpDb();
    const avant = new Database(path, { create: true });
    // Ledger qui refuse la version 2 = toute panne survenue entre le DDL et
    // l'INSERT du numéro de version (crash, disque plein, SQL Error).
    avant.run("CREATE TABLE _migrations (version INTEGER PRIMARY KEY CHECK (version < 2))");
    avant.close();

    (MIGRATIONS as Migration[]).push({ version: 2, sql: "CREATE TABLE v2_leftover(x)" });
    try {
      expect(() => new SqliteStorageProvider(path)).toThrow();

      const apres = new Database(path);
      const tables = (apres.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (t) => t.name,
      );
      const versions = (apres.query("SELECT version FROM _migrations").all() as { version: number }[]).map(
        (v) => v.version,
      );
      apres.close();

      // Migration en échec => aucun effet collé (rollback), sinon rejeu au boot.
      expect(tables).not.toContain("v2_leftover");
      expect(versions).not.toContain(2);
    } finally {
      (MIGRATIONS as Migration[]).pop();
    }
  });

  test("BUG: migrate() fait confiance à _migrations sans vérifier le schéma — une base dérivée (ledger v1 mais table kv absente) s'ouvre sans erreur, l'échec n'apparaît qu'à la première écriture", () => {
    const path = tmpDb();
    const avant = new Database(path, { create: true });
    const derniereAppliquee = MIGRATIONS[MIGRATIONS.length - 1].version;
    // Base dérivée construite à la main : ledger à jour MAIS table kv jamais
    // créée (restore partiel, copie d'une base avant migration, etc.). Le
    // ledger ne prouve rien du schéma.
    avant.run("CREATE TABLE _migrations (version INTEGER PRIMARY KEY)");
    avant.run("INSERT INTO _migrations (version) VALUES (?)", [derniereAppliquee]);
    avant.close();

    // Levée au démarrage (fail fast), pas un storage cassé qui scopte plus tard.
    expect(() => new SqliteStorageProvider(path)).toThrow(/sch/i);
  });

  test("BUG: le handle SQLite fuit quand migrate() échoue — le `new Database` de la ligne 11 n'est jamais fermé si le PRAGMA ou une migration lève", () => {
    const path = tmpDb();
    // Fichier corrompu : `new Database` réussit, `PRAGMA journal_mode` lève.
    writeFileSync(path, "ceci n'est pas une base SQLite");

    const nbFds = (): number => readdirSync("/proc/self/fd").length;
    const avant = nbFds();
    for (let i = 0; i < 25; i++) {
      expect(() => new SqliteStorageProvider(path)).toThrow();
    }
    expect(nbFds() - avant).toBe(0);
  });

  test("BUG: get() ne vérifie pas typeof(value) = 'blob' — une valeur scalaire liée dans la colonne BLOB ressort en octets silencieux (5 stocké -> 5 octets nuls)", async () => {
    // La colonne BLOB n'a aucune affinité : SQLite accepte TEXT/INTEGER sans
    // erreur, et `new Uint8Array(row.value)` fabrique des octets fantômes.
    const p = new SqliteStorageProvider(tmpDb());
    const s = loose(p);
    await s.set("n", 5);
    expect(await p.get("n")).toEqual(new Uint8Array([5]));
    p.close();
  });
});