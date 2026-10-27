// tests/architecture/docs.test.ts — le registre et les règles ne dérivent pas.
//
// Ces vérifications portent sur la FORME de la documentation, pas sur son
// contenu : IDs uniques, sections complètes, références valides, commandes
// `make` existantes. Un lien mort ou un ID réutilisé doit rougir le gate, pas
// attendre une relecture humaine.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const INVARIANTS = read("docs/architecture/INVARIANTS.md");
const AGENTS = read("AGENTS.md");
const README = read("README.md");
const MAKEFILE = read("Makefile");

const ENTRY = /^## (I\d+(?: bis)?) — /;

interface Entry {
  id: string;
  body: string;
}

/** Sections détaillées du registre (`## I<n> — …`), dans l'ordre du fichier. */
export function parseInvariantEntries(md: string): Entry[] {
  const lines = md.split("\n");
  const starts = lines.flatMap((line, i) => (ENTRY.test(line) ? [i] : []));
  return starts.map((start, k) => {
    const end = starts[k + 1] ?? lines.length;
    const id = ENTRY.exec(lines[start]!)![1]!;
    return { id, body: lines.slice(start, end).join("\n") };
  });
}

/** IDs `I<n>` cités dans un texte, avec la variante `I<n> bis`. */
export function referencedIds(text: string): string[] {
  return [...text.matchAll(/\bI(\d+)( bis)?\b/g)].map((m) => `I${m[1]}${m[2] ?? ""}`);
}

/** Cibles déclarées dans le Makefile (hors variables `:=`). */
export function makeTargets(makefile: string): Set<string> {
  const targets = new Set<string>();
  for (const line of makefile.split("\n")) {
    const m = /^([a-zA-Z][\w-]*):(?!=)/.exec(line);
    if (m) targets.add(m[1]!);
  }
  return targets;
}

const entries = parseInvariantEntries(INVARIANTS);
const ids = entries.map((e) => e.id);
const numeric = ids
  .filter((id) => !id.endsWith(" bis"))
  .map((id) => Number(id.slice(1)))
  .sort((a, b) => a - b);

describe("registre d'invariants", () => {
  test("les identifiants sont uniques", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("la numérotation est consécutive à partir de I1", () => {
    expect(numeric.length).toBeGreaterThan(0);
    expect(numeric).toEqual(Array.from({ length: numeric.length }, (_, i) => i + 1));
  });

  test("chaque entrée porte test, commande et portée", () => {
    for (const { id, body } of entries) {
      expect({ id, test: /^- Test :/m.test(body) }).toEqual({ id, test: true });
      expect({ id, commande: /^- Commande :/m.test(body) }).toEqual({ id, commande: true });
      expect({ id, emplacement: /^- Emplacement :/m.test(body) }).toEqual({ id, emplacement: true });
    }
  });

  test("chaque entrée a une ligne dans le registre", () => {
    for (const id of ids) expect(INVARIANTS).toContain(`| ${id} |`);
  });

  test("les références de AGENTS.md et README.md existent", () => {
    const known = new Set(ids);
    for (const [name, text] of [["AGENTS.md", AGENTS], ["README.md", README]] as const) {
      for (const id of referencedIds(text)) {
        expect({ name, id, known: known.has(id) }).toEqual({ name, id, known: true });
      }
    }
  });

  test("README annonce la plage réelle du registre", () => {
    const max = Math.max(...numeric);
    expect(README).toContain(`I1–I${max}`);
  });
});

describe("commandes citées", () => {
  test("chaque `make <cible>` de AGENTS.md et README.md existe", () => {
    const targets = makeTargets(MAKEFILE);
    for (const [name, text] of [["AGENTS.md", AGENTS], ["README.md", README]] as const) {
      for (const m of text.matchAll(/\bmake ([a-zA-Z][\w-]*)/g)) {
        const target = m[1]!;
        expect({ name, target, exists: targets.has(target) }).toEqual({ name, target, exists: true });
      }
    }
  });
});

describe("ADR", () => {
  test("chaque ADR déclare un statut", () => {
    const dir = join(ROOT, "docs/adr");
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      expect({ file, statut: /^- Statut :/m.test(text) }).toEqual({ file, statut: true });
    }
  });
});
