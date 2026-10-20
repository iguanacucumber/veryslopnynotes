// #403 : le job de fond passe par LA MÊME file que l'interface.
//
// Le `Client` est MUTABLE (`refresh()` réassigne `communication`, `attributes`
// et la clé AES) : une lecture de l'écran et une du job de fond en même temps
// = deux authentifications sur le même compte = « Exceeded max authorization
// requests » (erreur 25) → l'ÉTABLISSEMENT limite le compte. `LocalRequestQueue`
// existe pour ça (#310) — mais le job de fond lisait le client EN DIRECT, et
// chaque dépôt avait SA file.
//
// Ce test lit le VRAI source : il échoue dès qu'une lecture du client repartit
// hors de la file partagée, ou qu'une file par dépôt réapparaît.
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

/** Les sources Kotlin du module `data`. */
function dataFiles(): string[] {
  return readdirSync(DATA).filter((f) => f.endsWith(".kt")).sort();
}

/** Une INSTANTIATION de la queue (`LocalRequestQueue<…>()`), pas sa déclaration. */
const QUEUE_INSTANCE = /LocalRequestQueue<[^>]*>\s*\(/;

describe("file partagée du client local (#403)", () => {
  test("UNE file pour tous : ni file par dépôt, ni file propre au job", () => {
    // La file partagée est UN objet, qui porte UNE instance de la queue.
    const queue = codeOnly(readFileSync(QUEUE, "utf8"));
    expect(queue).toContain("object ClientQueue");
    expect(queue.match(new RegExp(QUEUE_INSTANCE, "g"))?.length).toBe(1);
    // Logique pure : elle compile et s'exécute hors Gradle (harnais de parité).
    expect(queue).not.toContain("import android.");
    // AUCUNE autre file dans le module : une file par dépôt se recroiserait.
    for (const f of dataFiles()) {
      if (f === "ClientQueue.kt") continue;
      const src = codeOnly(readFileSync(join(DATA, f), "utf8"));
      expect({ file: f, queue: QUEUE_INSTANCE.test(src) }).toEqual({ file: f, queue: false });
    }
  });

  test("l'interface ET le job passent par LA MÊME file", () => {
    const repo = codeOnly(readFileSync(REPO, "utf8"));
    const worker = codeOnly(readFileSync(WORKER, "utf8"));
    // Les écrans…
    expect(repo).toContain("ClientQueue.submit(");
    // …et le job de fond : la MÊME file, pas une file à lui.
    expect(worker).toContain("ClientQueue.submitAndAwait(");
    expect(worker).not.toContain("LocalRequestQueue");
  });

  test("le job de fond ne lit plus le client en direct", () => {
    const worker = codeOnly(readFileSync(WORKER, "utf8"));
    // Aucune lecture directe : ni payload, ni appel de méthode sur le client.
    expect(worker).not.toMatch(/Payload\(/);
    expect(worker).not.toMatch(/\bclient\./);
    // La lecture passe par la porte unique…
    expect(worker).toContain("cachedRead(client, resource,");
    // …dans la file partagée, sous une clé namespacée (jamais celle d'un
    // écran : un résultat étranger ne peut pas être livré au job).
    expect(worker).toContain('"job|$resource|"');
  });

  test("les ressources lues par le job n'ont qu'une porte d'entrée", () => {
    // `cachedRead` est la SEULE porte : les trois ressources que le job relit
    // (notes, devoirs, EDT) ne sont lues que par elle.
    for (const f of dataFiles()) {
      if (f === "PronotePayloads.kt" || f === "CachedReads.kt") continue;
      const src = codeOnly(readFileSync(join(DATA, f), "utf8"));
      for (const call of ["gradesPayload(", "assignmentsPayload(", "timetablePayload("]) {
        expect({ file: f, call, present: src.includes(call) }).toEqual({ file: f, call, present: false });
      }
    }
    // ... et c'est bien elle qui les lit.
    const reads = codeOnly(readFileSync(READS, "utf8"));
    expect(reads).toContain("gradesPayload(client, q)");
    expect(reads).toContain("assignmentsPayload(client, q)");
    expect(reads).toContain("timetablePayload(client, q)");
  });
});
