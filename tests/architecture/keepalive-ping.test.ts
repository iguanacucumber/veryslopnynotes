// #408 : la RELECTURE MANUELLE doit forcer un aller-retour.
//
// `Communication.post` rafraîchit `lastPing` à chaque POST réussi : juste après
// une lecture, le seuil de 110 s n'est PAS atteint, donc le ping « si dû »
// (`pingIfDue`) ne partait JAMAIS. `SyncedRepository.syncOutcome()` rendait
// alors `Updated` sans rien vérifier de la session : une session morte
// passait pour vivante (ni `DeviceAuth.reject()`, ni invite à ré-appairer).
//
// Ce test lit le VRAI source (la couche data ne compile pas hors Gradle : elle
// tire `android.os`). Le comportement COMPILÉ est prouvé par
// `tests/unit/kotlin-pronote-client-parity.test.ts` (Kotlin compilé + port TS
// `pronotets` : le ping manuel émet la requête de la référence).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");
const PRONOTE = join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote");
const REPO = join(DATA, "SyncedRepository.kt");
const COMM = join(PRONOTE, "Communication.kt");

/** Source à partir de `header`, jusqu'au `nextHeader` suivant. */
function slice(src: string, header: string, nextHeader: string): string {
  const start = src.indexOf(header);
  if (start === -1) return "";
  const end = src.indexOf(nextHeader, start);
  return src.slice(start, end === -1 ? src.length : end);
}

describe("ping de session (#408)", () => {
  test("la relecture manuelle force le ping (jamais le ping « si dû »)", () => {
    const repo = codeOnly(readFileSync(REPO, "utf8"));
    const body = slice(repo, "private fun syncOutcome()", "\n    private fun ");
    expect(body).toContain("client.keepAlive().ping()");
    // Le ping « si dû » ne part jamais après une lecture (le POST vient de
    // rafraîchir `lastPing`) : c'est le bug.
    expect(body).not.toContain("pingIfDue");
    // Et nulle part ailleurs dans la couche data.
    expect(repo).not.toContain("pingIfDue");
  });

  test("le ping manuel ignore le seuil ; le ping de fond garde son seuil", () => {
    const comm = codeOnly(readFileSync(COMM, "utf8"));
    // Le ping MANUEL : la requête part SANS consulter le seuil.
    const ping = slice(comm, "fun ping()", "\n    fun ");
    expect(ping).toContain("pingRequest()");
    expect(ping).not.toContain("shouldPing");
    // Le ping de FOND (périodique) garde son seuil : la session ne coûte pas
    // une requête par lecture.
    const ifDue = slice(comm, "fun pingIfDue()", "\n    fun ");
    expect(ifDue).toContain("shouldPing()");
  });
});
