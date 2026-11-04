// #843 : la communication ne revendique ni copie ni identité Papillon. Le
// crédit GPL et les notices restent ; seules les revendications disparaissent.
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const BANNED = [
  { label: "copie de Papillon", pattern: /\bcopie(?:\s+visuelle)?\s+de\s+Papillon\b/i },
  { label: "clone de Papillon", pattern: /\bclone\s+de\s+Papillon\b/i },
  { label: "North Star", pattern: /\bNorth\s+Star\b/i },
];

const TEXT_FILES = [
  ...new Glob("*.md").scanSync(ROOT),
  ...new Glob("docs/**/*.md").scanSync(ROOT),
  ...new Glob("*/README.md").scanSync(ROOT),
  ...new Glob("shared/**/*.{ts,kt,md}").scanSync(ROOT),
  ...new Glob("web/src/**/*.{ts,tsx,css}").scanSync(ROOT),
  ...new Glob("android/**/*.{kt,xml}").scanSync(ROOT),
].filter(
  (path) =>
    !path.startsWith(".agents/") &&
    !path.startsWith("node_modules/") &&
    !path.startsWith("android/app/build/"),
);

const flat = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/>\s/g, "");

describe("langage légal", () => {
  test("aucune revendication de copie, de clone ou de North Star", () => {
    const hits = TEXT_FILES.flatMap((path) => {
      const text = read(path);
      return BANNED.filter(({ pattern }) => pattern.test(text)).map(
        ({ label }) => `${path} : « ${label} »`,
      );
    });
    expect(hits).toEqual([]);
  });

  test("la non-affiliation nomme Papillon et Pronote / Index Éducation", () => {
    const readme = flat(read("README.md"));
    expect(readme).toMatch(
      /non affilié à Pronote \/ Index Éducation ni à Papillon \/ Association Papillon/i,
    );
    expect(flat(read("THIRD_PARTY_NOTICES.md"))).toMatch(
      /n'est affilié ni à Papillon \/ Association Papillon ni à Pronote \/ Index Éducation/i,
    );
  });

  test("aucune ressource d'identité Papillon n'est livrée", () => {
    const assets = [...new Glob("android/app/src/main/res/**/*.xml").scanSync(ROOT)];
    const hits = assets.filter((path) => /papillon/i.test(read(path)));
    expect(hits).toEqual([]);
  });
});
