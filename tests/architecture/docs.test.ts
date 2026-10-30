// tests/architecture/docs.test.ts — le registre et les règles ne dérivent pas.
//
// Ces vérifications portent sur la FORME de la documentation, pas sur son
// contenu : IDs uniques, sections complètes, références valides, commandes
// `make` existantes. Un lien mort ou un ID réutilisé doit rougir le gate, pas
// attendre une relecture humaine.
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const INVARIANTS = read("docs/architecture/INVARIANTS.md");
const INVARIANTS_DIR = join(ROOT, "docs/architecture/invariants");
// Le registre est un INDEX : les entrées détaillées vivent par thème, pour
// qu'un agent ne lise que le fichier de l'invariant qu'il touche.
const DETAIL_FILES = readdirSync(INVARIANTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort();
const DETAIL_BY_FILE = Object.fromEntries(
  DETAIL_FILES.map((f) => [f, readFileSync(join(INVARIANTS_DIR, f), "utf8")]),
);
const DETAIL = DETAIL_FILES.map((f) => DETAIL_BY_FILE[f]!).join("\n");
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

/** IDs inscrits dans la section `## Retirés` du registre (un par ligne de table). */
export function parseRetiredIds(md: string): string[] {
  const lines = md.split("\n");
  const start = lines.indexOf("## Retirés");
  if (start === -1) return [];
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const body = lines.slice(start + 1, end === -1 ? lines.length : end);
  return body.flatMap((l) => (l.startsWith("| I") ? [l.split("|")[1]!.trim()] : []));
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

/**
 * Erreurs de numérotation : un trou entre I1 et la dernière entrée active n'est
 * toléré que si l'ID figure dans `## Retirés`, et un ID retiré ne réapparaît
 * jamais comme entrée active.
 */
export function numberingErrors(entries: Entry[], retired: string[]): string[] {
  const errors: string[] = [];
  const active = new Set(entries.map((e) => e.id));
  for (const id of retired) {
    if (active.has(id)) errors.push(`${id} est réutilisé alors qu'il figure dans ## Retirés`);
  }
  const nums = activeNumericIds(entries);
  const max = Math.max(...nums, 0);
  for (let n = 1; n <= max; n++) {
    if (nums.has(n)) continue;
    if (!retired.includes(`I${n}`)) errors.push(`trou non documenté : I${n} n'est ni une entrée ni dans ## Retirés`);
  }
  return errors;
}

/** Colonnes `Vérification principale` du registre, par ID (hors `## Retirés`). */
export function registryCheckCells(md: string): Map<string, string> {
  const cells = new Map<string, string>();
  let inRegistry = false;
  for (const line of md.split("\n")) {
    if (/^## /.test(line)) inRegistry = line.startsWith("## Registre");
    if (!inRegistry) continue;
    const parts = line.split("|");
    if (parts.length > 3 && /^I\d+/.test(parts[1]!.trim())) cells.set(parts[1]!.trim(), parts[3]!);
  }
  return cells;
}

/** Liens de détail de la table du registre : ID → fichier + ancre. */
export interface DetailLink {
  id: string;
  file: string;
  anchor: string;
}

export function detailLinks(md: string): DetailLink[] {
  const links: DetailLink[] = [];
  const row = /^\| (I\d+(?: bis)?) \|.*\| \[[^\]]+\]\(invariants\/([\w-]+)\.md#([\w-]+)\) \|$/;
  for (const line of md.split("\n")) {
    const m = row.exec(line);
    if (m) links.push({ id: m[1]!, file: m[2]!, anchor: m[3]! });
  }
  return links;
}

/** Blocs de code entre backticks d'un texte. */
export function codeSpans(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}

/** Un backtick « ressemble à un chemin » : tests/ ou agents/ (glob permis). */
export function isCitedPath(span: string): boolean {
  return /^(tests|agents)\//.test(span);
}

/** Un chemin cité est un glob : il contient un caractère de joker. */
export function isGlobPattern(path: string): boolean {
  return /[*?[]/.test(path);
}

/** Le bloc `- Test :` d'une entrée, jusqu'à la ligne `- Commande :` suivante. */
export function testBlock(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.startsWith("- Test :"));
  if (start === -1) return "";
  const end = lines.findIndex((l, i) => i > start && /^- (Commande|Emplacement) :/.test(l));
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

/** Chemins de vérification cités dans le bloc `- Test :` d'une entrée. */
export function citedTestPaths(body: string): string[] {
  return codeSpans(testBlock(body)).filter(isCitedPath);
}

/** Chemins cités par une entrée : bloc `- Test :` + colonne du registre. */
export function citedPaths(detailBody: string, registryRow: string): string[] {
  return [...citedTestPaths(detailBody), ...codeSpans(registryRow).filter(isCitedPath)];
}

/**
 * Erreurs de citation : un chemin littéral doit exister, un glob doit matcher
 * au moins un fichier, et une entrée doit citer au moins un fichier réel —
 * la prose entre backticks n'est jamais vérifiée.
 */
export function citationErrors(
  entries: { id: string; paths: string[] }[],
  isFile: (path: string) => boolean,
  globMatchCount: (pattern: string) => number,
): string[] {
  const errors: string[] = [];
  for (const { id, paths } of entries) {
    if (paths.length === 0) {
      errors.push(`${id} ne cite aucun fichier de vérification`);
      continue;
    }
    for (const path of paths) {
      if (isGlobPattern(path)) {
        if (globMatchCount(path) === 0) errors.push(`${id} : le glob \`${path}\` ne matche aucun fichier`);
      } else if (!isFile(path)) {
        errors.push(`${id} : le fichier \`${path}\` n'existe pas`);
      }
    }
  }
  return errors;
}

/** Numéros `I<n>` (hors `bis`) des entrées actives. */
function activeNumericIds(entries: Entry[]): Set<number> {
  return new Set(
    entries
      .filter((e) => !e.id.endsWith(" bis"))
      .map((e) => Number(e.id.slice(1))),
  );
}

const entries = parseInvariantEntries(DETAIL);
const ids = entries.map((e) => e.id);
const numeric = ids
  .filter((id) => !id.endsWith(" bis"))
  .map((id) => Number(id.slice(1)))
  .sort((a, b) => a - b);
const retired = parseRetiredIds(INVARIANTS);
const cells = registryCheckCells(INVARIANTS);
const cited = entries.map((e) => ({ id: e.id, paths: citedPaths(e.body, cells.get(e.id) ?? "") }));

const isFile = (path: string) => {
  try {
    return statSync(join(ROOT, path)).isFile();
  } catch {
    return false;
  }
};
const globMatchCount = (pattern: string) => [...new Glob(pattern).scanSync(ROOT)].length;

describe("registre d'invariants", () => {
  test("les identifiants sont uniques", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("le registre est un index : aucune entrée détaillée", () => {
    // Un agent lit l'index + un seul thème ; une entrée recollée ici
    // ramènerait les 33 Ko dans chaque lecture.
    expect(INVARIANTS).not.toMatch(/^## I\d/m);
  });

  test("chaque ligne du registre pointe vers son entrée de détail", () => {
    const links = detailLinks(INVARIANTS);
    expect(links.map((l) => l.id).sort()).toEqual([...ids].sort());
    for (const link of links) {
      const file = `${link.file}.md`;
      const body = DETAIL_BY_FILE[file];
      expect({ id: link.id, file, exists: body !== undefined }).toEqual({ id: link.id, file, exists: true });
      expect({ id: link.id, ancre: body!.includes(`<a id="${link.anchor}"></a>`) }).toEqual({
        id: link.id,
        ancre: true,
      });
    }
    // Aucun fichier de détail orphelin (jamais atteint depuis l'index).
    expect([...new Set(links.map((l) => `${l.file}.md`))].sort()).toEqual(DETAIL_FILES);
  });

  test("l'index et les détails restent sous leur budget de lecture", () => {
    // Budgets de CONTEXTE, pas de style : un agent qui relit un fichier le
    // garde jusqu'à la compaction. Dépasser = revenir au registre monolithique.
    expect({ fichier: "INVARIANTS.md", sousBudget: INVARIANTS.length <= 8_000 }).toEqual({
      fichier: "INVARIANTS.md",
      sousBudget: true,
    });
    for (const file of DETAIL_FILES) {
      expect({ file, sousBudget: DETAIL_BY_FILE[file]!.length <= 12_000 }).toEqual({
        file,
        sousBudget: true,
      });
    }
  });

  test("les surfaces de lecture agent restent sous leur budget d'octets", () => {
    // Budgets de CONTEXTE : un agent qui relit ces fichiers les garde jusqu'à
    // la compaction. Dépasser = revenir à la lecture intégrale à chaque tour.
    expect({ fichier: "AGENTS.md", sousBudget: AGENTS.length <= 5_000 }).toEqual({
      fichier: "AGENTS.md",
      sousBudget: true,
    });
    expect({ fichier: "Makefile", sousBudget: MAKEFILE.length <= 9_000 }).toEqual({
      fichier: "Makefile",
      sousBudget: true,
    });
    expect({ fichier: "README.md", sousBudget: README.length <= 10_000 }).toEqual({
      fichier: "README.md",
      sousBudget: true,
    });
  });

  test("chaque entrée d'invariant tient en 120 mots maximum", () => {
    // Une entrée au-delà force l'agent à relire le détail à chaque tour ;
    // le détail appartient à l'issue, au commit ou à l'ADR.
    for (const { id, body } of entries) {
      const words = body.split(/\s+/).filter(Boolean).length;
      expect({ id, words, sousBudget: words <= 120 }).toEqual({
        id,
        words,
        sousBudget: true,
      });
    }
  });

  test("la numérotation est consécutive à partir de I1, sauf retrait documenté", () => {
    expect(numeric.length).toBeGreaterThan(0);
    expect(numberingErrors(entries, retired)).toEqual([]);
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
    const known = new Set([...ids, ...retired]);
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

  test("chaque entrée pointe vers au moins un fichier existant", () => {
    expect({ bad: citationErrors(cited, isFile, globMatchCount) }).toEqual({ bad: [] });
  });
});

describe("sabotage : retrait d'invariant (fixtures)", () => {
  const entry = (n: number) =>
    `## I${n} — Règle de test\n- Test : t\n- Commande : c\n- Emplacement : e\n`;

  test("un trou non documenté est rouge", () => {
    const fixtures = parseInvariantEntries(`${entry(1)}\n${entry(3)}`);
    expect(numberingErrors(fixtures, [])).toEqual(["trou non documenté : I2 n'est ni une entrée ni dans ## Retirés"]);
  });

  test("un trou documenté dans ## Retirés est vert", () => {
    const fixtures = parseInvariantEntries(`${entry(1)}\n${entry(3)}`);
    expect(numberingErrors(fixtures, ["I2"])).toEqual([]);
  });

  test("un ID retiré qui réapparaît comme entrée active est rouge", () => {
    const fixtures = parseInvariantEntries(`${entry(1)}\n${entry(2)}`);
    expect(numberingErrors(fixtures, ["I2"])).toEqual(["I2 est réutilisé alors qu'il figure dans ## Retirés"]);
  });
});

describe("sabotage : fichiers cités (fixtures)", () => {
  const entry = (n: number, testLine: string) =>
    `## I${n} — Règle de test\n- Test : ${testLine}\n- Commande : c\n- Emplacement : e\n`;
  const check = (body: string) =>
    citationErrors([{ id: "I1", paths: citedPaths(body, "") }], isFile, globMatchCount);

  test("un chemin inventé est rouge", () => {
    expect(check(entry(1, "`tests/unit/inexistant.test.ts`"))).toEqual([
      "I1 : le fichier `tests/unit/inexistant.test.ts` n'existe pas",
    ]);
  });

  test("un glob sans correspondance est rouge", () => {
    expect(check(entry(1, "`tests/unit/inexistant-*.test.ts`"))).toEqual([
      "I1 : le glob `tests/unit/inexistant-*.test.ts` ne matche aucun fichier",
    ]);
  });

  test("un chemin réel est vert", () => {
    expect(check(entry(1, "`tests/architecture/docs.test.ts`"))).toEqual([]);
  });

  test("un chemin inventé dans le registre est rouge aussi", () => {
    const row = "`tests/architecture/registre-inexistant.test.ts`";
    const fixtures = citationErrors([{ id: "I1", paths: citedPaths(entry(1, "`t`"), row) }], isFile, globMatchCount);
    expect(fixtures).toEqual(["I1 : le fichier `tests/architecture/registre-inexistant.test.ts` n'existe pas"]);
  });

  test("la prose entre backticks est ignorée", () => {
    expect(citedTestPaths(entry(1, "`Foo.bar` et `un mot`"))).toEqual([]);
  });

  test("une entrée sans fichier cité est rouge", () => {
    expect(citationErrors([{ id: "I1", paths: [] }], isFile, globMatchCount)).toEqual([
      "I1 ne cite aucun fichier de vérification",
    ]);
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
