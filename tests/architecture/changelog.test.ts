import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const CHANGELOG = read("CHANGELOG.md");

const HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?$/;

/** La note de version est recopiée depuis le changelog : un titre hors format casse l'extraction. */
export function versionSections(md: string): { version: string; date?: string }[] {
  return md
    .split("\n")
    .flatMap((line) => {
      const m = HEADING.exec(line);
      return m ? [{ version: m[1]!, date: m[2] }] : [];
    });
}

describe("CHANGELOG", () => {
  const sections = versionSections(CHANGELOG);

  test("Keep a Changelog : Unreleased en tête, releases semver datées et uniques", () => {
    expect(sections[0]?.version).toBe("Unreleased");
    const released = sections.slice(1);
    expect(new Set(released.map((s) => s.version)).size).toBe(released.length);
    for (const { version, date } of released) {
      expect({
        version,
        semver: /^\d+\.\d+\.\d+$/.test(version),
        date: /^\d{4}-\d{2}-\d{2}$/.test(date ?? ""),
      }).toEqual({ version, semver: true, date: true });
    }
  });

  test("le format est déclaré et RELEASE.md porte la convention", () => {
    expect(CHANGELOG).toContain("keepachangelog.com");
    expect(CHANGELOG).toContain("semver.org");
    const release = read("docs/RELEASE.md");
    expect(release).toContain("CHANGELOG.md");
    expect(release).toContain("[Unreleased]");
  });
});
