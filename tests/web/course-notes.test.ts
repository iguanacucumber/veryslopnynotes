import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mockCall } from "../../web/src/bridge/mock";
import type {
  LessonLoadResult,
  LessonPhotoResult,
  LessonsSnapshot,
  LessonSaveResult,
  SettingsSnapshot,
} from "../../web/src/bridge/types";

const ROOT = join(import.meta.dir, "..", "..");
const WEB = join(ROOT, "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

describe("course notes — bridge and screen (#586)", () => {
  test("the mock bridge exposes subjects, notes and manual settings", async () => {
    const snapshot = await mockCall<LessonsSnapshot>("lessons.list", {});
    expect(Array.isArray(snapshot.subjects)).toBe(true);
    expect(snapshot.maxTextChars).toBe(4000);
    expect(snapshot.maxNotesPerSubject).toBe(8);
    const math = snapshot.subjects.find((item) => item.subject === "MATHEMATIQUES");
    expect(math?.notes.length).toBeGreaterThan(0);
  });

  test("a note is created, read back, edited and deleted", async () => {
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

  test("the manual toggle is per subject", async () => {
    const disabled = await mockCall<LessonSaveResult>("lessons.setManual", {
      subject: "MATHEMATIQUES",
      enabled: false,
    });
    expect(disabled.ok).toBe(true);
    const snapshot = await mockCall<LessonsSnapshot>("lessons.list", {});
    expect(snapshot.subjects.find((item) => item.subject === "MATHEMATIQUES")?.manualEnabled).toBe(false);
    await mockCall<LessonSaveResult>("lessons.setManual", { subject: "MATHEMATIQUES", enabled: true });
  });

  test("a course photo comes back as a draft, never as an image on the bridge", async () => {
    const result = await mockCall<LessonPhotoResult>("lessons.addPhoto", {
      subject: "MATHEMATIQUES",
      source: "camera",
    });
    expect(result.ok).toBe(true);
    expect(result.title).toBeTruthy();
    expect(result.text).toContain("transcrit");
    // The contract only carries text: no base64/data URL field.
    expect(JSON.stringify(result)).not.toContain("base64");
    const screen = source("features/course-notes/CourseNotesScreen.tsx");
    expect(screen).toContain("bridge.addLessonPhoto");
    expect(screen).toContain("Prendre une photo");
    expect(screen).toContain("Choisir une image");
    expect(screen).toContain("puis elle est supprimée");
  });

  test("subjects without notes are compact rows, not cards", () => {
    const screen = source("features/course-notes/CourseNotesScreen.tsx");
    // A full card only when the subject has notes.
    expect(screen).toContain("item.notes.length > 0");
    expect(screen).toContain("item.notes.length === 0");
    expect(screen).toContain('title="Sans cours"');
    expect(screen).toContain("course-notes-empty-row");
    const card = screen.indexOf('className="course-notes-subject"');
    expect(card).toBeGreaterThan(screen.indexOf("{withNotes.map((subject) =>"));
    expect(card).toBeLessThan(screen.indexOf("{withoutNotes.length > 0"));
  });

  test("one privacy note, one photo picker", () => {
    const screen = source("features/course-notes/CourseNotesScreen.tsx");
    // The privacy note is global: one occurrence only.
    expect(screen.match(/puis elle est supprimée/g)).toHaveLength(1);
    expect(screen).not.toContain("La photo part directement");
    // The camera/gallery choice is one dialog at screen level.
    expect(screen.match(/Prendre une photo/g)).toHaveLength(1);
    expect(screen.match(/Choisir une image/g)).toHaveLength(1);
    expect(screen).toContain("open={photoTarget !== null}");
    expect(screen.match(/bridge\.addLessonPhoto/g)).toHaveLength(1);
    // Short manual status, not one paragraph per subject.
    expect(screen).toContain("Cahier seul");
    expect(screen).toContain("Sans manuel");
    expect(screen).toContain("course-notes-status");
    expect(screen).not.toContain("Manuel ignoré");
    // No injected HTML.
    expect(screen).not.toContain("innerHTML");
    expect(screen).not.toContain("dangerouslySetInnerHTML");
  });

  test("after a photo, the draft asks for an explicit review", () => {
    const screen = source("features/course-notes/CourseNotesScreen.tsx");
    // The dialog is no longer the manual entry one.
    expect(screen).toContain("Vérifier la photo");
    expect(screen).toContain("Photo transcrite");
    expect(screen).toContain("La photo a été effacée");
    // Retake without losing the draft until capture succeeds.
    expect(screen).toContain("retakePhoto");
    expect(screen).toContain("Reprendre");
    expect(screen).toContain("Galerie");
    expect(screen).toContain("Ce brouillon sera remplacé");
    // Loading and failure have their own surface, not a fleeting toast.
    expect(screen).toContain("Transcription de la photo");
    expect(screen).toContain("course-notes-photo-progress");
    expect(screen).toContain("Photo non transcrite");
    expect(screen).toContain("retryPhoto");
  });

  test("course notes feed homework and revision sheets, never a UI mirror", () => {
    const bridge = readFileSync(
      join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app", "VsnBridge.kt"),
      "utf8",
    );
    expect(bridge).toContain("LessonNotes.sources(lessons.notes(), assignment.subject)");
    expect(bridge).toContain("LessonNotes.sources(lessons.notes(), a.subject)");
    expect(bridge).toContain("manualAvailableForSubject");
    expect(bridge).toContain("if (!manuals.isEnabled(subject)) return null");
    // Course notes live in offline/: account purge removes them.
    expect(bridge).toContain('File(ctx.filesDir, "offline/course-notes.json")');
    // Pre-rename file is read until the first successful write migrates it.
    expect(bridge).toContain('legacyFile = File(ctx.filesDir, "offline/cahier.json")');
    // La matière du devoir décide : pas un drapeau global.
    const tasks = source("features/tasks/TasksScreen.tsx");
    expect(tasks).toContain("lessonSubjects.includes(assignment.subject)");
    expect(tasks).toContain("manualSubjects.includes(assignment.subject)");
  });

  test("the screen is routed and linked from the profile", () => {
    expect(source("App.tsx")).toContain('path="/course-notes"');
    expect(source("App.tsx")).toContain('path="/cahier"');
    expect(source("ui/AppShell.tsx")).toContain('"/course-notes"');
    expect(source("features/profile/ProfileScreen.tsx")).toContain('navigate("/course-notes")');
    const screen = source("features/course-notes/CourseNotesScreen.tsx");
    expect(screen).toContain(".lessons()");
    expect(screen).toContain("bridge.saveLesson");
    expect(screen).toContain("bridge.setLessonManual");
    expect(screen).toContain("Supprimer");
  });

  test("the text assistant settings know the source subjects", async () => {
    const settings = await mockCall<SettingsSnapshot>("settings.get", {});
    expect(Array.isArray(settings.lessonSubjects)).toBe(true);
    expect(Array.isArray(settings.manualSubjects)).toBe(true);
  });
});
