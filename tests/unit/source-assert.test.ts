import { describe, expect, test } from "bun:test";
import {
  expectFileContains,
  expectFileMatch,
  expectSourceContains,
  expectSourceMatch,
} from "./fixtures/source-assert";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SMALL = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app", "AttachmentMime.kt");

describe("source-assert : échec court, jamais le fichier entier", () => {
  test("présence : succès silencieux", () => {
    expectSourceContains("UNTRUSTED_DATA et nonce", "nonce", "fichier.kt");
  });

  test("absence : message court et contient le fichier", () => {
    let err: Error | null = null;
    try {
      expectSourceContains("un petit source", "ABSENT", "fichier.kt");
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    const msg = err!.message;
    expect(msg).toContain("fichier.kt");
    expect(msg).toContain("ABSENT");
    // Jamais le fichier entier : message court.
    expect(msg.length).toBeLessThan(600);
    expect(msg.split("\n").length).toBeLessThan(12);
  });

  test("regex : succès", () => {
    expectSourceMatch("openFile(file, mimeOf())", /openFile\(file,\s*mimeOf\(/, "fichier.kt");
  });

  test("regex : échec court", () => {
    let err: Error | null = null;
    try {
      expectSourceMatch("rien qui matche", /openFile\(/, "fichier.kt");
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    const msg = err!.message;
    expect(msg).toContain("fichier.kt");
    expect(msg.length).toBeLessThan(600);
  });

  test("expectFileContains sur un vrai fichier", () => {
    expectFileContains(SMALL, "EXECUTABLE_MIME_TYPES");
  });

  test("expectFileMatch sur un vrai fichier", () => {
    expectFileMatch(SMALL, /EXECUTABLE_MIME_TYPES/);
  });

  test("expectFileContains échec cite le fichier et reste court", () => {
    let err: Error | null = null;
    try {
      expectFileContains(SMALL, "CERTAINEMENT_ABSENT_XYZ");
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    const msg = err!.message;
    expect(msg).toContain(SMALL);
    expect(msg.length).toBeLessThan(600);
  });
});
