// Course notes are a LOCAL memory per subject (#586). Real Kotlin runs:
// `core/LessonNote.kt` via `LessonNotesMain.kt`; these rules decide what the
// assistant may cite. The disk store imports `org.json` (Android only), so a
// source test checks its epoch-guarded writes.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";

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

describe("course notes — executed rules (#586)", () => {
  test.skipIf(skip)("a conforming note is accepted, an out-of-contract note is refused", async () => {
    expect((await ask({ op: "valid", ...note("n1", "Mathématiques", "Chapitre 4", "f'(x)=2x") })).valid).toBe(true);
    // Out-of-schema id (a file name, a JSON response) is refused BEFORE storage.
    expect((await ask({ op: "valid", ...note("../x", "Maths", "T", "texte") })).valid).toBe(false);
    expect((await ask({ op: "valid", ...note("n1", "", "T", "texte") })).valid).toBe(false);
    expect((await ask({ op: "valid", ...note("n1", "Maths", "", "texte") })).valid).toBe(false);
    expect((await ask({ op: "valid", ...note("n1", "Maths", "T", "   ") })).valid).toBe(false);
    expect((await ask({ op: "valid", ...note("n1", "Maths", "T", "x".repeat(4001)) })).valid).toBe(false);
    expect((await ask({ op: "valid", ...note("n1", "Maths", "T", "texte", "pas une date") })).valid).toBe(false);
  });

  test.skipIf(skip)("a subject receives only ITS notes, newest first", async () => {
    const notes = [
      note("n1", "Mathématiques", "Ancien", "a", "2026-10-01T08:00:00Z"),
      note("n2", "Mathématiques", "Récent", "b", "2026-10-20T08:00:00Z"),
      note("n3", "NSI", "Autre matière", "c", "2026-10-21T08:00:00Z"),
    ];
    const res = await ask({ op: "forSubject", subject: "Mathématiques", notes });
    expect(res.ids).toEqual(["n2", "n1"]);
  });

  test.skipIf(skip)("course note sources are labelled for citation and bounded like a source", async () => {
    const notes = Array.from({ length: 6 }, (_, i) =>
      note(`n${i}`, "Maths", `Cours ${i}`, "x".repeat(4000), `2026-10-2${i}T08:00:00Z`),
    );
    const res = await ask({ op: "sources", subject: "Maths", notes });
    // No artificial cap: each note is bounded as a source; the AI assembler fits them.
    expect(res.count).toBe(6);
    expect(res.labels).toEqual([
      "Cahier : Cours 5",
      "Cahier : Cours 4",
      "Cahier : Cours 3",
      "Cahier : Cours 2",
      "Cahier : Cours 1",
      "Cahier : Cours 0",
    ]);
    for (const text of res.texts as string[]) expect(text.length).toBeLessThanOrEqual(2000);
  });

  test("the disk store goes through the epoch guard and reads valid notes", () => {
    const store = readFileSync(STORE, "utf8");
    // A write during logout is ABANDONED: no file, purged directory not resurrected (I16).
    expect(store).toContain("OfflineArtifacts.writeText(file, lessonNotesJson(notes), epoch)");
    // A corrupt entry is ignored, never served to the assistant.
    expect(store).toContain("if (LessonNote.isValid(note)) out.add(note)");
    // Parsing distinguishes "empty list" from "unreadable JSON".
    expect(store).toContain("internal fun parseLessonNotesOrNull(raw: String): List<LessonNote>? = try {");
    // A corrupt/partial new file falls through to intact legacy notes.
    expect(store).toContain("val current = file.takeIf { it.isFile }?.let { parseLessonNotesOrNull(it.readText()) }");
    expect(store).toContain("if (current != null) return current");
    // Pre-rename file is read until the first successful write migrates it.
    expect(store).toContain("return legacyFile?.takeIf { it.isFile }?.let { parseLessonNotesOrNull(it.readText()) } ?: emptyList()");
    // The old file is deleted only AFTER the new one is written.
    expect(store).toContain("if (written) legacyFile?.takeIf { it.isFile }?.delete()");
    // The file lives in offline/: account purge deletes it wholesale.
    const bridge = readBridgeSource();
    expect(bridge).toContain('File(ctx.filesDir, "offline/course-notes.json")');
    expect(bridge).toContain('legacyFile = File(ctx.filesDir, "offline/cahier.json")');
  });
});
