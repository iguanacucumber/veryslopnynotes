// #586 : le cahier de cours est une mémoire LOCALE par matière.
//
// VRAI Kotlin exécuté : `core/LessonNote.kt` est compilé par le harnais puis
// piloté par `agents/runtime/kotlin-parity/LessonNotesMain.kt`. Les règles
// testées sont celles qui décident ce que l'assistant peut citer : validation,
// sélection par matière, bornes des sources.
//
// Le stockage disque (`data/LessonNotesStore.kt`) importe `org.json` (API
// Android, absente hors Gradle) : il est couvert par un test de source qui
// vérifie qu'il écrit via `OfflineArtifacts` (garde d'époque), plus le test
// Kotlin exécuté de #404 pour la garde elle-même.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "LessonNotesMain.kt");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const STORE = join(DATA, "LessonNotesStore.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

function note(id: string, subject: string, title: string, text: string, createdAt = "2026-10-19T08:00:00Z") {
  return { id, subject, title, text, createdAt };
}

describe("cahier de cours — règles exécutées (#586)", () => {
  test.skipIf(skip)("une note conforme est acceptée, une note hors contrat est refusée", async () => {
    expect((await ask({ op: "valid", ...note("n1", "Mathématiques", "Chapitre 4", "f'(x)=2x") })).valid).toBe(true);
    // Identifiant hors schéma : il finirait dans un nom de fichier ou une
    // réponse JSON, donc il est refusé AVANT le stockage.
    expect((await ask({ op: "valid", ...note("../x", "Maths", "T", "texte") })).valid).toBe(false);
    expect((await ask({ op: "valid", ...note("n1", "", "T", "texte") })).valid).toBe(false);
    expect((await ask({ op: "valid", ...note("n1", "Maths", "", "texte") })).valid).toBe(false);
    expect((await ask({ op: "valid", ...note("n1", "Maths", "T", "   ") })).valid).toBe(false);
    expect((await ask({ op: "valid", ...note("n1", "Maths", "T", "x".repeat(4001)) })).valid).toBe(false);
    expect((await ask({ op: "valid", ...note("n1", "Maths", "T", "texte", "pas une date") })).valid).toBe(false);
  });

  test.skipIf(skip)("une matière ne reçoit que SES cours, les plus récents d'abord", async () => {
    const notes = [
      note("n1", "Mathématiques", "Ancien", "a", "2026-10-01T08:00:00Z"),
      note("n2", "Mathématiques", "Récent", "b", "2026-10-20T08:00:00Z"),
      note("n3", "NSI", "Autre matière", "c", "2026-10-21T08:00:00Z"),
    ];
    const res = await ask({ op: "forSubject", subject: "Mathématiques", notes });
    expect(res.ids).toEqual(["n2", "n1"]);
  });

  test.skipIf(skip)("les sources du cahier sont bornées et étiquetées pour la citation", async () => {
    const notes = Array.from({ length: 6 }, (_, i) =>
      note(`n${i}`, "Maths", `Cours ${i}`, "x".repeat(4000), `2026-10-2${i}T08:00:00Z`),
    );
    const res = await ask({ op: "sources", subject: "Maths", notes });
    // 3 sources maximum, chacune bornée à la borne d'une source devoirs.
    expect(res.count).toBe(3);
    expect(res.labels).toEqual(["Cours : Cours 5", "Cours : Cours 4", "Cours : Cours 3"]);
    for (const text of res.texts as string[]) expect(text.length).toBeLessThanOrEqual(2000);
  });

  test("le stockage disque passe par la garde d'époque et relit des notes valides", () => {
    const store = readFileSync(STORE, "utf8");
    // Une écriture pendant une déconnexion est ABANDONNÉE : le fichier n'est
    // pas créé et le dossier purgé n'est pas ressuscité (I16/#404).
    expect(store).toContain("OfflineArtifacts.writeText(file, lessonNotesJson(notes), epoch)");
    // Une entrée corrompue est ignorée, jamais servie à l'assistant.
    expect(store).toContain("if (LessonNote.isValid(note)) out.add(note)");
    // Le fichier vit dans offline/ : la purge de compte le supprime en bloc.
    const bridge = readFileSync(
      join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app", "VsnBridge.kt"),
      "utf8",
    );
    expect(bridge).toContain('File(ctx.filesDir, "offline/cahier.json")');
  });
});
