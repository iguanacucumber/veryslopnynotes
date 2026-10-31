// Snapshot de période : notes + moyennes + moyenne générale en UN SEUL POST.
// Le vrai `Period.notes()` et les lectures strictes tournent sur la source de
// production avec un client stub. Outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "PeriodNotesParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface NotesResult {
  posts: number;
  grades: number;
  gradeIds: string[];
  gradePeriods?: (string | null)[];
  averages: number;
  overall: unknown;
}

interface ErrorResult {
  thrown: string | null;
  posts?: number;
}

async function run<T>(op: string): Promise<T> {
  return JSON.parse(await link!.ask({ op })) as T;
}

describe("snapshot de période (Period.notes)", () => {
  test.skipIf(skip)("notes + moyennes + moyenne générale = UN SEUL DernieresNotes", async () => {
    const r = await run<NotesResult>("onePost");
    expect(r.posts).toBe(1);
    expect(r.grades).toBe(2);
    expect(r.gradeIds).toEqual(["g1", "g2"]);
    // La période PORTÉE par la ligne est résolue quand elle existe ; une ligne
    // sans `periode` reste lisible (null), elle ne jette pas.
    expect(r.gradePeriods).toEqual(["p-ok", null]);
    expect(r.averages).toBe(1);
    expect(r.overall).toBe("13,25");
  });

  test.skipIf(skip)("une ligne tordue ne jette pas le trimestre entier", async () => {
    const r = await run<NotesResult>("tolerant");
    expect(r.posts).toBe(1);
    // La note sans `note.V` et la moyenne sans `moyEleve.V` sont SAUTÉES ;
    // les deux lignes valides restent affichables.
    expect(r.grades).toBe(1);
    expect(r.gradeIds).toEqual(["g1"]);
    expect(r.averages).toBe(1);
    // La moyenne manuelle est calculée depuis les seules moyennes lisibles.
    expect(r.overall).toBe("12.5");
  });

  test.skipIf(skip)("une liste de services absente = moyenne INCONNUE", async () => {
    const r = await run<NotesResult>("missingServices");
    // Pas de `listeServices` : la moyenne générale est inconnue (null), pas
    // `"-1"` ni un zéro inventé. Les notes, elles, restent publiées.
    expect(r.grades).toBe(1);
    expect(r.averages).toBe(0);
    expect(r.overall).toBeNull();
  });

  test.skipIf(skip)("l'enveloppe dataSec.data reste STRICTE", async () => {
    const r = await run<ErrorResult>("envelope");
    // Un payload sans enveloppe ne doit jamais être publié comme un trimestre
    // vide : il lève, et le cache n'écrit rien.
    expect(r.thrown).toBe("ParsingError");
    expect(r.posts).toBe(1);
  });

  test.skipIf(skip)("grades() garde son comportement STRICT", async () => {
    const r = await run<ErrorResult>("strictGrades");
    // La parité avec la référence TS ne bouge pas : une ligne illisible fait
    // échouer `grades()`.
    expect(r.thrown).toBe("ParsingError");
  });

  test.skipIf(skip)("overallAverage() garde son comportement STRICT", async () => {
    const r = await run<ErrorResult>("strictOverall");
    expect(r.thrown).toBe("ParsingError");
  });
});
