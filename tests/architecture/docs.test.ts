// Le registre, les pins de release et les règles ne dérivent pas : ces tests
// portent sur la FORME de la documentation (IDs uniques, sections, liens,
// chemins cités, cibles `make`, versions épinglées), pour qu'un ID réutilisé ou
// un lien mort rougisse le gate sans relecture humaine.
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_TARGETS } from "../../agents/runtime/check";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const INVARIANTS = read("docs/architecture/INVARIANTS.md");
const CONTEXT = read("docs/CONTEXT.md");
const INVARIANTS_DIR = join(ROOT, "docs/architecture/invariants");
// Le registre est un INDEX : les entrées vivent par thème, pour qu'un agent ne
// lise que le fichier de l'invariant qu'il touche. `OPERATING.md` est une
// procédure, pas un thème.
const OPERATING = "OPERATING.md";
const DETAIL_FILES = readdirSync(INVARIANTS_DIR)
  .filter((f) => f.endsWith(".md") && f !== OPERATING)
  .sort();
const DETAIL_BY_FILE = Object.fromEntries(
  DETAIL_FILES.map((f) => [f, readFileSync(join(INVARIANTS_DIR, f), "utf8")]),
);
const DETAIL = DETAIL_FILES.map((f) => DETAIL_BY_FILE[f]!).join("\n");
const AGENTS = read("AGENTS.md");
const README = read("README.md");
const MAKEFILE = read("Makefile");
const RELEASE = read("docs/RELEASE.md");
// Seuls les docs du dépôt : `.agents/` est vendorisé et `node_modules/` n'est
// pas de la documentation.
const DOC_MARKDOWN = [
  ...new Glob("*.md").scanSync(ROOT),
  ...new Glob("docs/**/*.md").scanSync(ROOT),
  ...new Glob("*/README.md").scanSync(ROOT),
  ...new Glob("shared/**/*.md").scanSync(ROOT),
]
  .filter((file) => !file.startsWith(".agents/") && !file.startsWith("node_modules/"))
  .sort();

const ENTRY = /^## (I\d+(?: bis)?) — /;

interface Entry {
  id: string;
  body: string;
}

export function parseInvariantEntries(md: string): Entry[] {
  const lines = md.split("\n");
  const starts = lines.flatMap((line, i) => (ENTRY.test(line) ? [i] : []));
  return starts.map((start, k) => {
    const end = starts[k + 1] ?? lines.length;
    const id = ENTRY.exec(lines[start]!)![1]!;
    return { id, body: lines.slice(start, end).join("\n") };
  });
}

export function referencedIds(text: string): string[] {
  return [...text.matchAll(/\bI(\d+)( bis)?\b/g)].map((m) => `I${m[1]}${m[2] ?? ""}`);
}

export function parseRetiredIds(md: string): string[] {
  const lines = md.split("\n");
  const start = lines.indexOf("## Retirés");
  if (start === -1) return [];
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const body = lines.slice(start + 1, end === -1 ? lines.length : end);
  return body.flatMap((l) => (l.startsWith("| I") ? [l.split("|")[1]!.trim()] : []));
}

/** Cibles Makefile (hors variables `:=`). */
export function makeTargets(makefile: string): Set<string> {
  const targets = new Set<string>();
  for (const line of makefile.split("\n")) {
    const m = /^([a-zA-Z][\w-]*):(?!=)/.exec(line);
    if (m) targets.add(m[1]!);
  }
  return targets;
}

/** Cibles relatives d'un Markdown ; les liens externes et ancres pures sortent. */
export function relativeLinks(md: string): string[] {
  return [...md.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1]!)
    .filter((target) => !/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(target))
    .map((target) => decodeURIComponent(target.split("#")[0]!))
    .filter((target) => target.length > 0);
}

/** Un lien relatif doit résoudre depuis le fichier qui le porte. */
export function brokenDocLinks(
  files: { path: string; text: string }[],
  resolves: (path: string) => boolean,
): string[] {
  return files.flatMap(({ path, text }) =>
    relativeLinks(text)
      .filter((link) => !resolves(join(dirname(path), link)))
      .map((link) => `${path} : lien \`${link}\` introuvable`),
  );
}

/** Colonne « Version » des lignes du tableau `## Versions épinglées` de RELEASE.md. */
export function releasePins(md: string): Map<string, string> {
  const pins = new Map<string, string>();
  const lines = md.split("\n");
  const start = lines.indexOf("## Versions épinglées");
  if (start === -1) return pins;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const cells = line.split("|").map((cell) => cell.trim());
    const component = cells[1];
    const version = cells[2];
    if (!component || !version || component === "Composant" || /^-+$/.test(component)) continue;
    pins.set(component, version);
  }
  return pins;
}

/**
 * Raccourci documenté dans `OPERATING.md` : `android/<module>/<Fichier>.kt`
 * désigne la source Gradle du module.
 */
export function expandKotlinShorthand(path: string): string | null {
  const m = /^android\/(core|data|app|pronote)\/(.+)$/.exec(path);
  return m ? `android/${m[1]}/src/main/java/fr/veryslopnynotes/${m[1]}/${m[2]}` : null;
}

/** Chemins cités par la ligne `Emplacement :` ; les cibles make n'en sont pas. */
export function emplacementPaths(body: string, makeTargetNames: Set<string>): string[] {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.startsWith("- Emplacement :"));
  if (start === -1) return [];
  const block: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (i > start && (line.startsWith("- ") || line === "" || line.startsWith("<a "))) break;
    block.push(line);
  }
  return codeSpans(block.join("\n")).filter((span) => !makeTargetNames.has(span));
}

export function pathErrors(id: string, paths: string[], resolves: (path: string) => boolean): string[] {
  return paths.filter((path) => !resolves(path)).map((path) => `${id} : Emplacement \`${path}\` introuvable`);
}

/**
 * Un trou entre I1 et la dernière entrée active n'est toléré que si l'ID figure
 * dans `## Retirés`, et un ID retiré ne réapparaît jamais comme entrée active.
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

/** Colonne `Vérification principale` (4e) par ID, hors `## Retirés`. */
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

export interface DetailLink {
  id: string;
  file: string;
  anchor: string;
}

export interface ContextPointer {
  file: string;
  anchor: string;
}

export function contextPointers(text: string): ContextPointer[] {
  return [...text.matchAll(/invariants\/([\w-]+)\.md#([\w-]+)/g)].map((m) => ({
    file: `${m[1]}.md`,
    anchor: m[2]!,
  }));
}

export function pointerErrors(
  pointers: ContextPointer[],
  files: Record<string, string | undefined>,
): string[] {
  return pointers.flatMap(({ file, anchor }) => {
    const body = files[file];
    if (body === undefined) return [`${file} n'existe pas`];
    if (!body.includes(`<a id="${anchor}"></a>`)) return [`${file}#${anchor} : ancre absente`];
    return [];
  });
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

/** Un backtick est un chemin s'il contient un séparateur de dossier. */
export function isCitedPath(span: string): boolean {
  return span.includes("/");
}

export function isGlobPattern(path: string): boolean {
  return /[*?[]/.test(path);
}

export function testBlock(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.startsWith("- Test :"));
  if (start === -1) return "";
  const end = lines.findIndex((l, i) => i > start && /^- (Commande|Emplacement) :/.test(l));
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

export function citedTestPaths(body: string): string[] {
  return codeSpans(testBlock(body)).filter(isCitedPath);
}

export function citedPaths(detailBody: string, registryRow: string): string[] {
  return [...citedTestPaths(detailBody), ...codeSpans(registryRow).filter(isCitedPath)];
}

/**
 * Un chemin littéral doit exister, un glob doit matcher au moins un fichier, et
 * une entrée doit citer au moins un fichier réel : la prose entre backticks
 * n'est jamais vérifiée.
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
const isDirectory = (path: string) => {
  try {
    return statSync(join(ROOT, path)).isDirectory();
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
    // Un agent lit l'index + un seul thème ; une entrée recollée ici ramènerait
    // les 33 Ko dans chaque lecture.
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
    expect([...new Set(links.map((l) => `${l.file}.md`))].sort()).toEqual(DETAIL_FILES);
  });

  test("l'index et les détails restent sous leur budget de lecture", () => {
    // Budgets de CONTEXTE, pas de style : dépasser = revenir au registre monolithique.
    expect({ fichier: "INVARIANTS.md", sousBudget: INVARIANTS.length <= 5_500 }).toEqual({
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
    // Budgets de CONTEXTE. Les plafonds serrent ~20 % au-dessus du réel : les
    // relever est un diff visible, pas une dérive silencieuse.
    expect({ fichier: "AGENTS.md", sousBudget: AGENTS.length <= 5_000 }).toEqual({
      fichier: "AGENTS.md",
      sousBudget: true,
    });
    expect({ fichier: "Makefile", sousBudget: MAKEFILE.length <= 9_000 }).toEqual({
      fichier: "Makefile",
      sousBudget: true,
    });
    expect({ fichier: "README.md", sousBudget: README.length <= 5_500 }).toEqual({
      fichier: "README.md",
      sousBudget: true,
    });
  });

  test("le reste du chemin de lecture reste borné", () => {
    const ceilings: [string, number][] = [
      // +600 pour la politique anti-flake (#924), qui appartient au build CI.
      // +1 150 pour la mesure, la marge et le seuil de couverture (#895).
      // +1 450 smoke émulateur (#891), +350 axe/captures (#970). Marge : 7 600.
      ["docs/architecture/BUILD.md", 7_600],
      // +1 000 mort du rendu (#866), +580 FLAG_SECURE (#898), +600 réseau
      // local (#896). Marge : 12 000.
      ["android/README.md", 12_000],
      ["web/README.md", 4_000],
      // +1000 pour le sandbox Chromium et le profil seccomp, +3800 pour
      // l'opérabilité (sondes, drain, cgroups, CA/HSTS).
      ["server/README.md", 9_600],
      ["shared/contracts/README.md", 1_000],
      // +500 pour la publication loopback et le digest Docker (#921),
      // +900 pour la politique de deep links et la preuve adb (SEC-10).
      ["docs/RELEASE.md", 8_400],
      ["docs/HUMAN_INPUTS.md", 4_500],
      ["docs/PRODUCT.md", 7_500],
    ];
    for (const [file, max] of ceilings) {
      expect({ file, sousBudget: read(file).length <= max }).toEqual({ file, sousBudget: true });
    }
    for (const file of readdirSync(join(ROOT, "docs/adr")).filter((f) => f.endsWith(".md"))) {
      expect({ file, sousBudget: readFileSync(join(ROOT, "docs/adr", file), "utf8").length <= 9_000 }).toEqual({
        file,
        sousBudget: true,
      });
    }
  });

  test("chaque entrée d'invariant tient en 120 mots maximum", () => {
    // Une entrée au-delà force l'agent à relire le détail à chaque tour : le
    // récit appartient à l'issue, au commit ou à l'ADR.
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

describe("versions épinglées (RELEASE.md)", () => {
  const pkg = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const dep = (name: string) => pkg.dependencies[name] ?? pkg.devDependencies[name] ?? "";
  const toml = (key: string) =>
    new RegExp(`^${key} = "([^"]+)"`, "m").exec(read("android/gradle/libs.versions.toml"))?.[1] ?? "";
  const gradle = /gradle-([\d.]+)-bin\.zip/.exec(read("android/gradle/wrapper/gradle-wrapper.properties"))?.[1] ?? "";

  // Composant → version lue dans son manifeste. Une ligne absente de cette
  // table doit être déclarée transitive : sinon un pin peut dériver sans test.
  const SOURCES: Record<string, () => string> = {
    "bun (runtime)": () => /oven\/bun:([\d.]+)/.exec(read("Dockerfile.server"))?.[1] ?? "",
    typescript: () => dep("typescript"),
    "@types/bun": () => dep("@types/bun"),
    "Gradle / AGP / Kotlin": () => [gradle, toml("agp"), toml("kotlin")].join(" / "),
    "compileSdk/targetSdk/minSdk": () => {
      const build = read("android/app/build.gradle.kts");
      const sdk = (key: string) => new RegExp(`\\b${key} = (\\d+)`).exec(build)?.[1] ?? "";
      return [sdk("compileSdk"), sdk("targetSdk"), sdk("minSdk")].join(" / ");
    },
    "activity-ktx / OkHttp": () => [toml("activity-ktx"), toml("okhttp")].join(" / "),
    "zxing-android-embedded": () => toml("zxing-android-embedded"),
    "react / react-dom": () => {
      const [react, dom] = [dep("react"), dep("react-dom")];
      return react === dom ? react : `${react} / ${dom}`;
    },
    "react-router-dom": () => dep("react-router-dom"),
    "vite / @vitejs/plugin-react": () => [dep("vite"), dep("@vitejs/plugin-react")].join(" / "),
    "tough-cookie": () => dep("tough-cookie"),
  };
  // Lues dans `bun.lock` : un manifeste racine ne les déclare pas.
  const TRANSITIVE = new Set([
    "bun-types (transitif)",
    "@types/node (transitif)",
    "undici-types (transitif)",
    "rolldown (transitif)",
    "lightningcss (transitif)",
  ]);

  test("chaque version de la table correspond au manifeste", () => {
    const pins = releasePins(RELEASE);
    for (const [component, source] of Object.entries(SOURCES)) {
      const manifeste = source();
      expect({ component, table: pins.get(component), manifeste }).toEqual({
        component,
        table: manifeste,
        manifeste,
      });
    }
  });

  test("aucune ligne épinglée n'échappe au contrôle", () => {
    const unchecked = [...releasePins(RELEASE).keys()].filter(
      (component) => !(component in SOURCES) && !TRANSITIVE.has(component),
    );
    expect(unchecked).toEqual([]);
  });

  test("le digest Docker de RELEASE.md est celui du Dockerfile", () => {
    // Un tag seul n'épingle rien : le digest de l'index multi-arch est la preuve.
    const ref = /oven\/bun:([\d.]+@sha256:[0-9a-f]{64})/.exec(read("Dockerfile.server"))?.[1] ?? "";
    expect({ ref, cité: RELEASE.includes(`oven/bun:${ref}`) }).toEqual({ ref, cité: true });
    expect(ref).not.toBe("");
  });

  test("sabotage : un pin dérivé ne correspond plus au manifeste", () => {
    const drift = releasePins(RELEASE.replace("8.3.5 / 6.1.2", "8.3.4 / 6.1.2"));
    expect(drift.get("vite / @vitejs/plugin-react")).toBe("8.3.4 / 6.1.2");
    expect(drift.get("vite / @vitejs/plugin-react")).not.toBe(SOURCES["vite / @vitejs/plugin-react"]!());
  });
});

describe("carte de contexte", () => {
  test("CONTEXT.md reste sous son budget de lecture", () => {
    // Une carte qu'on relit à chaque tâche coûte plus qu'elle ne rapporte.
    // +110 pour la déclaration d'accessibilité (#981), +80 pour le glossaire (#1072).
    expect({ fichier: "docs/CONTEXT.md", sousBudget: CONTEXT.length <= 2_700 }).toEqual({
      fichier: "docs/CONTEXT.md",
      sousBudget: true,
    });
  });

  test("chaque invariant actif figure dans CONTEXT.md", () => {
    // Un invariant absent de la carte est un invariant qu'aucun agent ne trouve.
    for (const id of ids) {
      expect({ id, carte: new RegExp(`\\b${id}\\b`).test(CONTEXT) }).toEqual({ id, carte: true });
    }
  });

  test("chaque pointeur de CONTEXT.md résout vers une ancre réelle", () => {
    // La carte doit mener à l'entrée, pas au thème.
    const pointers = contextPointers(CONTEXT);
    expect(pointers.length).toBeGreaterThan(0);
    expect({ bad: pointerErrors(pointers, DETAIL_BY_FILE) }).toEqual({ bad: [] });
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

describe("emplacements des invariants", () => {
  const targets = makeTargets(MAKEFILE);
  const resolves = (path: string) => {
    if (isGlobPattern(path)) return globMatchCount(path) > 0;
    if (path.endsWith("/")) return isDirectory(path);
    if (isFile(path)) return true;
    const expanded = expandKotlinShorthand(path);
    return expanded !== null && isFile(expanded);
  };

  test("chaque `Emplacement :` résout vers un fichier, un dossier ou un glob", () => {
    for (const { id, body } of entries) {
      expect({ id, bad: pathErrors(id, emplacementPaths(body, targets), resolves) }).toEqual({ id, bad: [] });
    }
  });

  test("le raccourci Kotlin documenté résout vers la source du module", () => {
    expect(expandKotlinShorthand("android/core/LlmGuard.kt")).toBe(
      "android/core/src/main/java/fr/veryslopnynotes/core/LlmGuard.kt",
    );
    expect(expandKotlinShorthand("docs/README.md")).toBeNull();
  });

  test("les cibles make citées restent des commandes, pas des chemins", () => {
    const body = "## I1 — x\n- Emplacement : `Makefile` (`check` / `check-run`)\n";
    expect(emplacementPaths(body, targets)).toEqual(["Makefile"]);
  });

  test("sabotage : un emplacement inventé est rouge", () => {
    expect(pathErrors("I1", ["android/core/Inexistant.kt"], resolves)).toEqual([
      "I1 : Emplacement `android/core/Inexistant.kt` introuvable",
    ]);
  });
});

describe("commandes citées", () => {
  test("chaque `make <cible>` des docs de référence existe", () => {
    const targets = makeTargets(MAKEFILE);
    const docs: [string, string][] = [
      ["AGENTS.md", AGENTS],
      ["README.md", README],
      ["INVARIANTS.md", INVARIANTS],
      ...DETAIL_FILES.map((file) => [file, DETAIL_BY_FILE[file]!] as [string, string]),
    ];
    for (const [name, text] of docs) {
      for (const m of text.matchAll(/`make ([a-zA-Z][\w-]*)`/g)) {
        const target = m[1]!;
        expect({ name, target, exists: targets.has(target) }).toEqual({ name, target, exists: true });
      }
    }
  });
});

describe("check-fast", () => {
  const recipe =
    /^check-fast:\n\tCHECK_HARNESS=1 CHECK_TARGETS="([^"]+)"/m.exec(MAKEFILE)?.[1]?.split(" ") ?? [];
  const skipped = ["android-compile", "audit"];

  test("saute exactement les étapes Kotlin et réseau du gate", () => {
    // Ajouter une étape à DEFAULT_TARGETS sans l'ajouter ici la ferait
    // silencieusement disparaître de la boucle rapide.
    expect([...recipe].sort()).toEqual(
      DEFAULT_TARGETS.filter((target) => !skipped.includes(target)).sort(),
    );
    for (const target of skipped) expect(recipe).not.toContain(target);
  });

  test("toutes les cibles de la recette existent dans le Makefile", () => {
    const targets = makeTargets(MAKEFILE);
    for (const target of recipe) {
      expect({ target, exists: targets.has(target) }).toEqual({ target, exists: true });
    }
  });

  test("la documentation nomme les deux étapes sautées", () => {
    const docs: [string, string][] = [
      ["AGENTS.md", AGENTS],
      ["CONTRIBUTING.md", read("CONTRIBUTING.md")],
      ["docs/architecture/BUILD.md", read("docs/architecture/BUILD.md")],
    ];
    for (const [name, text] of docs) {
      const section = text.slice(text.indexOf("check-fast"));
      for (const target of skipped) {
        expect({ name, target, cité: section.includes(target) }).toEqual({
          name,
          target,
          cité: true,
        });
      }
    }
  });
});

describe("liens et doublons des docs", () => {
  const exists = (path: string) => {
    try {
      statSync(join(ROOT, path));
      return true;
    } catch {
      return false;
    }
  };

  test("chaque lien relatif des docs résout depuis son fichier", () => {
    const files = DOC_MARKDOWN.map((path) => ({ path, text: read(path) }));
    expect({ bad: brokenDocLinks(files, exists) }).toEqual({ bad: [] });
  });

  test("sabotage : un lien mort est rouge", () => {
    expect(brokenDocLinks([{ path: "docs/CONTEXT.md", text: "[x](../inexistant.md)" }], exists)).toEqual([
      "docs/CONTEXT.md : lien `../inexistant.md` introuvable",
    ]);
  });

  test("PRODUCT.md n'existe qu'à un endroit", () => {
    // Deux PRODUCT.md = deux vérités produit ; `docs/` est la source canonique.
    expect({ racine: exists("PRODUCT.md"), docs: exists("docs/PRODUCT.md") }).toEqual({
      racine: false,
      docs: true,
    });
  });
});

describe("matrice QA (#939)", () => {
  const FILE = "docs/QA-MATRIX.md";
  const QA = read(FILE);
  // Cas exigés par l'issue : l'ID et le libellé exact de la colonne « Cas ».
  const REQUIRED: [string, string][] = [
    ["QA-01", "Android 8.0 (API 26)"],
    ["QA-02", "Android 12 (API 31)"],
    ["QA-03", "Android 15 (API 35)"],
    ["QA-04", "Android 16 (API 36)"],
    ["QA-05", "WebView ancienne"],
    ["QA-06", "2 Go de RAM"],
    ["QA-07", "Police 200 %"],
    ["QA-08", "Premier lancement hors-ligne"],
    ["QA-09", "Stockage plein"],
    ["QA-10", "Horloge fausse — contrat de fraîcheur"],
    ["QA-12", "Portail captif"],
  ];
  const STATUTS = ["Réussi", "Échec", "Bloqué"];
  const rows = QA.split("\n").filter((line) => /^\| QA-\d+ \|/.test(line));
  const cells = (line: string) => line.split("|").map((cell) => cell.trim());
  const byId = new Map(rows.map((line) => [cells(line)[1]!, cells(line)]));
  const exists = (path: string) => {
    try {
      statSync(join(ROOT, path));
      return true;
    } catch {
      return false;
    }
  };

  test("chaque cas requis par l'issue a sa ligne", () => {
    for (const [id, cas] of REQUIRED) {
      expect({ id, cas: byId.get(id)?.[2] ?? null }).toEqual({ id, cas });
    }
  });

  test("chaque ligne porte un statut borné et une raison quand elle est bloquée", () => {
    expect(rows.length).toBeGreaterThanOrEqual(REQUIRED.length);
    for (const line of rows) {
      const [, id, , , raw, execution] = cells(line);
      const statut = (raw ?? "").replaceAll("`", "");
      expect({ id, statut: STATUTS.includes(statut) }).toEqual({ id, statut: true });
      // Une ligne bloquée sans raison ne dit rien : elle ne doit pas passer.
      if (statut === "Bloqué") expect({ id, raison: (execution ?? "").length > 20 }).toEqual({ id, raison: true });
    }
  });

  test("ses liens résolvent et l'index des docs pointe dessus", () => {
    expect(relativeLinks(QA).length).toBeGreaterThan(0);
    expect({ bad: brokenDocLinks([{ path: FILE, text: QA }], exists) }).toEqual({ bad: [] });
    expect(relativeLinks(CONTEXT)).toContain("QA-MATRIX.md");
  });
});

describe("modèle de menace", () => {
  const FILE = "docs/THREAT-MODEL.md";
  // Les cinq menaces nommées par #904 : un identifiant stable, un titre lisible.
  const THREATS = [
    { id: "T1", titre: "Appareil partagé" },
    { id: "T2", titre: "Charge scolaire malveillante" },
    { id: "T3", titre: "Dépendance compromise" },
    { id: "T4", titre: "Scraper local" },
    { id: "T5", titre: "Clé perdue" },
  ] as const;
  const SECTIONS = [
    "Actifs",
    "Attaquant",
    "Point d'entrée",
    "Mitigations existantes",
    "Risque résiduel",
    "Preuves",
  ];
  const exists = (path: string) => {
    try {
      statSync(join(ROOT, path));
      return true;
    } catch {
      return false;
    }
  };
  const block = (text: string, id: string) => {
    const start = text.indexOf(`## ${id} — `);
    if (start === -1) return "";
    const end = text.indexOf("\n## ", start + 1);
    return text.slice(start, end === -1 ? undefined : end);
  };

  test("le fichier existe et couvre les cinq menaces nommées", () => {
    expect({ fichier: FILE, existe: exists(FILE) }).toEqual({ fichier: FILE, existe: true });
    const text = read(FILE);
    for (const { id, titre } of THREATS) {
      expect({ id, titre, présent: new RegExp(`^## ${id} — ${titre}$`, "m").test(text) }).toEqual({
        id,
        titre,
        présent: true,
      });
    }
  });

  test("chaque menace porte actifs, attaquant, entrée, mitigations, risque et preuve", () => {
    const text = read(FILE);
    for (const { id } of THREATS) {
      const body = block(text, id);
      expect({ id, nonVide: body.length > 0 }).toEqual({ id, nonVide: true });
      for (const section of SECTIONS) {
        expect({ id, section, présent: body.includes(`**${section}**`) }).toEqual({
          id,
          section,
          présent: true,
        });
      }
    }
  });

  test("ses liens relatifs résolvent depuis le fichier", () => {
    const text = read(FILE);
    const links = relativeLinks(text);
    expect(links.length).toBeGreaterThan(0);
    expect({ bad: brokenDocLinks([{ path: FILE, text }], exists) }).toEqual({ bad: [] });
  });
});

describe("métadonnées du dépôt (#979)", () => {
  const FILE = "docs/REPOSITORY.md";
  const REPO = read(FILE);
  const DESCRIPTION =
    "Client Android open source pour Pronote : session locale, IA sans relais, hors-ligne d’abord. Kotlin, React, Bun.";
  const TOPICS = [
    "android",
    "bun",
    "education",
    "kotlin",
    "offline-first",
    "open-source",
    "privacy",
    "pronote",
    "react",
    "typescript",
    "webview",
  ];
  const section = (heading: string) => {
    const start = REPO.indexOf(`${heading}\n`);
    if (start === -1) return "";
    const end = REPO.indexOf("\n## ", start + heading.length + 1);
    return REPO.slice(start, end === -1 ? undefined : end);
  };

  test("les sections et la description sont présentes", () => {
    for (const heading of [
      "## Description",
      "## Sujets",
      "## Site",
      "## Aperçu social",
      "## Bonnes premières issues",
      "## Vérification",
    ]) {
      expect({ heading, présente: REPO.includes(heading) }).toEqual({ heading, présente: true });
    }
    // Le blockquote coupe la description : on compare la prose aplatie.
    expect(REPO.replace(/\s+/g, " ")).toContain(DESCRIPTION);
    expect(REPO.toLowerCase()).toContain("homepage");
    expect(REPO).toContain("vide");
  });

  test("les sujets sont ceux de GitHub et respectent son format", () => {
    const listed = [...section("## Sujets").matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]!);
    expect([...listed].sort()).toEqual([...TOPICS].sort());
    expect(listed.length).toBeLessThanOrEqual(20);
    for (const topic of listed) {
      expect({ topic, valide: /^[a-z0-9][a-z0-9-]{0,49}$/.test(topic) }).toEqual({
        topic,
        valide: true,
      });
    }
  });

  test("exactement cinq issues distinctes sont listées", () => {
    const numbers = [...REPO.matchAll(/^\| [1-5] \| #(\d+) \|/gm)].map((m) => m[1]!);
    expect(numbers.length).toBe(5);
    expect(new Set(numbers).size).toBe(5);
    // Chaque ligne porte le label qui rend l'issue découvrable.
    expect((REPO.match(/`good first issue`/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  test("CONTRIBUTING renvoie vers le fichier", () => {
    expect(read("CONTRIBUTING.md")).toContain("docs/REPOSITORY.md");
  });

  test("la vérification cite les commandes gh", () => {
    const verification = section("## Vérification");
    expect(verification).toContain("gh repo view");
    expect(verification).toContain("gh api repos/iguanacucumber/veryslopnynotes/topics");
    expect(verification).toContain('label "good first issue"');
  });
});

describe("glossaire (#1072)", () => {
  const FILE = "docs/GLOSSARY.md";
  const GLOSSARY = read(FILE);
  const REQUIRED = ["ADR", "AAB", "APK", "DCO", "ENT", "MFA", "PIN", "QR", "SSRF", "TTL", "WebView"];
  const rows = GLOSSARY.split("\n").filter((line) => /^\| [A-Za-z]+ \|/.test(line));
  const cells = (line: string) => line.split("|").map((cell) => cell.trim());
  const byTerm = new Map(rows.map((line) => [cells(line)[1]!, cells(line)[2]!]));
  const exists = (path: string) => {
    try {
      statSync(join(ROOT, path));
      return true;
    } catch {
      return false;
    }
  };

  test("chaque acronyme requis a sa ligne et sa phrase", () => {
    for (const term of REQUIRED) {
      expect({ term, phrase: (byTerm.get(term) ?? "").length > 20 }).toEqual({ term, phrase: true });
    }
  });

  test("chaque définition cite un lien relatif qui résout", () => {
    for (const term of REQUIRED) {
      expect({ term, lien: relativeLinks(byTerm.get(term) ?? "").length > 0 }).toEqual({ term, lien: true });
    }
    expect({ bad: brokenDocLinks([{ path: FILE, text: GLOSSARY }], exists) }).toEqual({ bad: [] });
  });

  test("CONTEXT.md pointe vers le glossaire", () => {
    expect(relativeLinks(CONTEXT)).toContain("GLOSSARY.md");
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

describe("parité : fichiers de test découpés", () => {
  test("chaque fichier de parité reste sous son budget de lecture", () => {
    // Un échec ne doit pas obliger à relire 56 Ko de tests : runner mince,
    // chaque thème dans son fichier, fixtures partagées bornées.
    for (const file of new Glob("tests/unit/parity/*.ts").scanSync(ROOT)) {
      expect({ file, sousBudget: statSync(join(ROOT, file)).size <= 30_000 }).toEqual({
        file,
        sousBudget: true,
      });
    }
    for (const file of new Glob("tests/unit/fixtures/pronote-*.ts").scanSync(ROOT)) {
      expect({ file, sousBudget: statSync(join(ROOT, file)).size <= 20_000 }).toEqual({
        file,
        sousBudget: true,
      });
    }
    for (const file of new Glob("tests/unit/kotlin-pronote-*-parity.test.ts").scanSync(ROOT)) {
      expect({ file, sousBudget: statSync(join(ROOT, file)).size <= 10_000 }).toEqual({
        file,
        sousBudget: true,
      });
    }
  });
});
