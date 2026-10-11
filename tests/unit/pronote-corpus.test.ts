// Corpus Pronote (#199) : ce qui doit rester vrai AVANT le port Kotlin, et ce qui
// doit s'annoncer franchement quand la machine n'a pas de capture.
//
// Le corpus lui-même est gitignoré (réponses réelles d'un compte d'élève). Donc
// ce test ne prétend jamais qu'une parité a été vérifiée : sans corpus, il
// SKIP bruyamment — le harnais de parité du port (#202) consommera exactement la
// même porte, `hasCorpus()`.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORPUS_DIR, hasCorpus, listDomains, loadDomain } from "./fixtures/pronote-corpus";
import { DOMAINS } from "../../agents/runtime/capture-pronote";

const CAPTURE = hasCorpus(CORPUS_DIR);

if (!CAPTURE) {
  // Un SKIP silencieux serait un faux vert : `make check` dirait avoir vérifié
  // une parité qu'il n'a pas vérifiée.
  console.warn(
    "\n" +
      "  SKIP BRUYANT — corpus Pronote absent (#199).\n" +
      "  La parité TS <-> Kotlin (#200/#201/#202) n'est PAS vérifiée sur cette machine.\n" +
      "  Pour l'obtenir : bun run agents/runtime/capture-pronote.ts (compte réel, QR + PIN).\n",
  );
}

function corpusWith(domains: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "corpus-loader-"));
  mkdirSync(dir, { recursive: true });
  for (const d of domains) writeFileSync(join(dir, `${d}.json`), '{\n  "__untrusted": true,\n  "items": []\n}\n');
  return dir;
}

describe("corpus Pronote (#199)", () => {
  test("l'outil de capture et le chargement lisent le même repertoire", () => {
    expect(CORPUS_DIR.endsWith(join("tests", "fixtures", "pronote"))).toBe(true);
  });

  test("`hasCorpus` est strict : un domaine non marqué n'est pas un corpus rejouable", () => {
    const dir = corpusWith(["grades"]);
    expect(hasCorpus(dir)).toBe(true);
    writeFileSync(join(dir, "menus.json"), '{"items": []}\n');
    expect(hasCorpus(dir)).toBe(false);
    expect(hasCorpus(join(dir, "absent"))).toBe(false);
    expect(listDomains(dir)).toEqual(["grades", "menus"]);
  });

  test.skipIf(!CAPTURE)("capture presente : tous les domaines de la capture sont charges", () => {
    for (const spec of DOMAINS) {
      expect(`${spec.domain}:${loadDomain(spec.domain) !== null}`).toBe(`${spec.domain}:true`);
    }
  });
});
