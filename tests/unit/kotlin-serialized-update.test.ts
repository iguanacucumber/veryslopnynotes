// #882 — deux enregistrements concurrents ne perdent pas la mise à jour de
// l'autre. La lecture-modification-écriture (relire, fusionner, écrire) doit
// tenir sous UN seul verrou : `@Synchronized` par méthode ne suffit pas, les
// deux fils lisent le même état avant que le premier n'ait écrit.
//
// PREUVES :
//  - le verrou de production `SerializedUpdate` est EXÉCUTÉ par de vrais fils :
//    aucun incrément perdu, jamais deux entrées à la fois ;
//  - le VRAI `LessonNotesRepository` est EXÉCUTÉ avec un store lent : les huit
//    ajouts survivent, et le même scénario SANS le verrou en perd (le test est
//    donc sensible à la régression) ;
//  - le câblage des trois magasins (notes, préférences matière, manuel) est
//    vérifié sur la source : la section critique couvre la lecture ET l'écriture.
// Outillage Kotlin absent = SKIP BRUYANT, jamais un faux vert.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "SerializedUpdateMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) link = await parityToolchain.openParityLink(DRIVER);

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

const source = (name: string): string => codeOnly(readFileSync(join(DATA, name), "utf8"));

/** Source d'une méthode, signature comprise (corps en expression ou en bloc). */
function methodOf(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) return "";
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return "";
}

describe("lecture-modification-écriture : une seule section critique (#882)", () => {
  test.skipIf(skip)("le verrou de production ne perd aucun incrément concurrent", async () => {
    const res = await ask({ op: "counter", threads: 8, rounds: 25 });
    // 8 × 25 = 200 : sans verrou, la lecture-vieillie-écriture en perdrait.
    expect(res.value).toBe(res.expected);
    expect(res.expected).toBe(200);
    // Un seul fil dans la section critique à la fois (sérialisation prouvée).
    expect(res.maxInside).toBe(1);
  });

  test.skipIf(skip)("le vrai dépôt du cahier garde TOUS les ajouts concurrents", async () => {
    const res = await ask({ op: "notes", threads: 8, delayMs: 50 });
    expect(res.expected).toBe(8);
    // Chaque fil a ajouté sa note : aucune n'a écrasé les autres.
    expect(res.count).toBe(8);
    expect(res.distinct).toBe(8);
  });

  test.skipIf(skip)("le scénario SANS verrou perd des notes (le test est sensible)", async () => {
    const res = await ask({ op: "notesUnlocked", threads: 8, delayMs: 50 });
    // Les huit fils ont lu la même liste vide : le dernier écrase les autres.
    expect(res.count).toBeLessThan(res.expected);
  });

  test("le cahier relit et écrit sous le MÊME verrou", () => {
    const repo = source("LessonNotesRepository.kt");
    expect(repo).toContain("private val update = SerializedUpdate()");
    // Les deux écritures (ajout/modification, suppression) sont sérialisées.
    for (const signature of ["fun save(id: String", "fun delete(id: String"]) {
      const body = methodOf(repo, signature);
      expect(body).toContain("update.run {");
      const lock = body.indexOf("update.run {");
      const read = body.indexOf("notes()");
      const write = body.indexOf("write(");
      expect(read).toBeGreaterThan(lock);
      expect(write).toBeGreaterThan(read);
    }
    // La lecture publique ne voit jamais une écriture à moitié engagée.
    expect(methodOf(repo, "fun notes(")).toContain("update.run {");
  });

  test("les préférences matière fusionnent et écrivent sous le MÊME verrou", () => {
    const prefs = source("SubjectPrefs.kt");
    expect(prefs).toContain("private val update = SerializedUpdate()");
    const upsert = methodOf(prefs, "fun upsert(");
    const lock = upsert.indexOf("update.run {");
    const read = upsert.indexOf("prefs()");
    const write = upsert.indexOf("write(");
    expect(lock).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(lock);
    expect(write).toBeGreaterThan(lock);
    expect(methodOf(prefs, "fun prefs(")).toContain("update.run {");
  });

  test("le manuel relit, fusionne et écrit sous le MÊME verrou", () => {
    const manuals = source("Manuals.kt");
    expect(manuals).toContain("private val lock = SerializedUpdate()");
    // `update` est LA section critique : lecture de l'état puis écriture durable.
    const update = methodOf(manuals, "private fun update(");
    const lock = update.indexOf("lock.run {");
    const read = update.indexOf("data()");
    const write = update.indexOf("OfflineArtifacts.writeText");
    expect(lock).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(lock);
    expect(write).toBeGreaterThan(read);
    // L'ancienne adresse se lit DANS la section critique du `save`.
    const save = methodOf(manuals, "fun save(");
    expect(save).toContain("storedUrl(obj)");
    expect(save).not.toContain("val previous = url()");
    // Les replis de `saveGuess` sont lus sous le même verrou.
    const guess = methodOf(manuals, "fun saveGuess(");
    expect(guess).toContain("storedClassLabel(obj)");
    expect(guess).toContain("storedSubjects(obj)");
    // La purge de compte est sérialisée avec une écriture en vol.
    expect(methodOf(manuals, "fun clearAccountData(")).toContain("lock.run {");
  });
});
