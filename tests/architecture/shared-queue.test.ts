// Le job de fond passe par LA MÊME file que l'interface : le `Client` est MUTABLE
// (`refresh()` réassigne `communication`, `attributes`, clé AES), donc deux
// lectures concurrentes font deux authentifications sur le même compte
// (« Exceeded max authorization requests », erreur 25) et l'établissement limite
// le compte. `LocalRequestQueue` doit rester unique pour tout le process.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");
const WORKER = join(DATA, "PeriodicSyncWorker.kt");
const REPO = join(DATA, "SyncedRepository.kt");
const QUEUE = join(DATA, "ClientQueue.kt");
const READS = join(DATA, "CachedReads.kt");

function dataFiles(): string[] {
  return readdirSync(DATA).filter((f) => f.endsWith(".kt")).sort();
}

/** Une INSTANTIATION de la queue, pas sa déclaration. */
const QUEUE_INSTANCE = /LocalRequestQueue<[^>]*>\s*\(/;

describe("file partagée du client local (#403)", () => {
  test("UNE file pour tous : ni file par dépôt, ni file propre au job", () => {
    const queue = codeOnly(readFileSync(QUEUE, "utf8"));
    expect(queue).toContain("object ClientQueue");
    expect(queue.match(new RegExp(QUEUE_INSTANCE, "g"))?.length).toBe(1);
    // Logique pure : elle compile et s'exécute hors Gradle (harnais de parité).
    expect(queue).not.toContain("import android.");
    // Une file par dépôt se recroiserait.
    for (const f of dataFiles()) {
      if (f === "ClientQueue.kt") continue;
      const src = codeOnly(readFileSync(join(DATA, f), "utf8"));
      expect({ file: f, queue: QUEUE_INSTANCE.test(src) }).toEqual({ file: f, queue: false });
    }
  });

  test("l'interface ET le job passent par LA MÊME file", () => {
    const repo = codeOnly(readFileSync(REPO, "utf8"));
    const worker = codeOnly(readFileSync(WORKER, "utf8"));
    expect(repo).toContain("ClientQueue.submit(");
    expect(worker).toContain("ClientQueue.submitAndAwait(");
    expect(worker).not.toContain("LocalRequestQueue");
  });

  test("le job de fond ne lit plus le client en direct", () => {
    const worker = codeOnly(readFileSync(WORKER, "utf8"));
    // Aucune lecture directe : ni payload, ni appel de méthode sur le client.
    expect(worker).not.toMatch(/Payload\(/);
    expect(worker).not.toMatch(/\bclient\./);
    expect(worker).toContain("cachedRead(client, resource,");
    // Clé namespacée : un résultat étranger ne peut pas être livré au job.
    expect(worker).toContain('"job|$resource|"');
  });

  test("les ressources lues par le job n'ont qu'une porte d'entrée", () => {
    // `cachedRead` est la SEULE porte des trois ressources que le job relit
    // (notes, devoirs, EDT).
    for (const f of dataFiles()) {
      if (f.endsWith("Payloads.kt") || f === "CachedReads.kt") continue;
      const src = codeOnly(readFileSync(join(DATA, f), "utf8"));
      for (const call of ["gradesPayload(", "assignmentsPayload(", "timetablePayload("]) {
        expect({ file: f, call, present: src.includes(call) }).toEqual({ file: f, call, present: false });
      }
    }
    const reads = codeOnly(readFileSync(READS, "utf8"));
    expect(reads).toContain("gradesPayload(client, q)");
    expect(reads).toContain("assignmentsPayload(client, q)");
    expect(reads).toContain("timetablePayload(client, q)");
  });
});
