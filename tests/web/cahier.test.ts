import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mockCall } from "../../web/src/bridge/mock";
import type { LessonLoadResult, LessonsSnapshot, LessonSaveResult, SettingsSnapshot } from "../../web/src/bridge/types";

const ROOT = join(import.meta.dir, "..", "..");
const WEB = join(ROOT, "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

describe("cahier de cours — pont et écran (#586)", () => {
  test("le pont factice expose les matières, les notes et le manuel", async () => {
    const snapshot = await mockCall<LessonsSnapshot>("lessons.list", {});
    expect(Array.isArray(snapshot.subjects)).toBe(true);
    expect(snapshot.maxTextChars).toBe(4000);
    expect(snapshot.maxNotesPerSubject).toBe(8);
    const math = snapshot.subjects.find((item) => item.subject === "MATHEMATIQUES");
    expect(math?.notes.length).toBeGreaterThan(0);
  });

  test("une note est créée, relue, modifiée puis supprimée", async () => {
    const saved = await mockCall<LessonSaveResult>("lessons.save", {
      subject: "NSI",
      title: "Bases SQL",
      text: "SELECT * FROM eleves;",
    });
    expect(saved.ok).toBe(true);

    const snapshot = await mockCall<LessonsSnapshot>("lessons.list", {});
    const nsi = snapshot.subjects.find((item) => item.subject === "NSI");
    const summary = nsi?.notes.find((item) => item.title === "Bases SQL");
    expect(summary).toBeTruthy();

    const loaded = await mockCall<LessonLoadResult>("lessons.load", { id: summary!.id });
    expect(loaded.ok).toBe(true);
    expect(loaded.note?.text).toContain("SELECT");

    const edited = await mockCall<LessonSaveResult>("lessons.save", {
      id: summary!.id,
      subject: "NSI",
      title: "Bases SQL — jointures",
      text: "SELECT * FROM eleves JOIN classes;",
    });
    expect(edited.ok).toBe(true);

    const deleted = await mockCall<LessonSaveResult>("lessons.delete", { id: summary!.id });
    expect(deleted.ok).toBe(true);
    const after = await mockCall<LessonsSnapshot>("lessons.list", {});
    expect(after.subjects.flatMap((item) => item.notes).some((item) => item.id === summary!.id)).toBe(false);
  });

  test("le réglage du manuel est par matière", async () => {
    const disabled = await mockCall<LessonSaveResult>("lessons.setManual", {
      subject: "MATHEMATIQUES",
      enabled: false,
    });
    expect(disabled.ok).toBe(true);
    const snapshot = await mockCall<LessonsSnapshot>("lessons.list", {});
    expect(snapshot.subjects.find((item) => item.subject === "MATHEMATIQUES")?.manualEnabled).toBe(false);
    await mockCall<LessonSaveResult>("lessons.setManual", { subject: "MATHEMATIQUES", enabled: true });
  });

  test("le cahier est une source des devoirs et des fiches, jamais un miroir UI", () => {
    const bridge = readFileSync(
      join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app", "VsnBridge.kt"),
      "utf8",
    );
    expect(bridge).toContain("LessonNotes.sources(lessons.notes(), assignment.subject)");
    expect(bridge).toContain("LessonNotes.sources(lessons.notes(), a.subject)");
    expect(bridge).toContain("manualAvailableForSubject");
    expect(bridge).toContain("if (!manuals.isEnabled(subject)) return null");
    // Le cahier est dans offline/ : la purge de compte l'emporte.
    expect(bridge).toContain('File(ctx.filesDir, "offline/cahier.json")');
    // La matière du devoir décide : pas un drapeau global.
    const tasks = source("features/tasks/TasksScreen.tsx");
    expect(tasks).toContain("lessonSubjects.includes(assignment.subject)");
    expect(tasks).toContain("manualSubjects.includes(assignment.subject)");
  });

  test("l'écran est routé et relié au profil", () => {
    expect(source("App.tsx")).toContain('path="/cahier"');
    expect(source("ui/AppShell.tsx")).toContain('"/cahier"');
    expect(source("features/profile/ProfileScreen.tsx")).toContain('navigate("/cahier")');
    const screen = source("features/cahier/CahierScreen.tsx");
    expect(screen).toContain(".lessons()");
    expect(screen).toContain("bridge.saveLesson");
    expect(screen).toContain("bridge.setLessonManual");
    expect(screen).toContain("Supprimer");
  });

  test("le réglage d'assistant texte connaît les matières sources", async () => {
    const settings = await mockCall<SettingsSnapshot>("settings.get", {});
    expect(Array.isArray(settings.lessonSubjects)).toBe(true);
    expect(Array.isArray(settings.manualSubjects)).toBe(true);
  });
});
