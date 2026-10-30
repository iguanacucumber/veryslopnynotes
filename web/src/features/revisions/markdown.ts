// Parseur markdown borné des fiches de révision (#630).
//
// Pourquoi maison plutôt qu'une bibliothèque : le corps d'une fiche est du
// contenu de modèle, donc NON FIABLE. Un parseur markdown qui accepte le HTML
// brut obligerait à assainir ensuite ; ici le HTML n'est jamais interprété :
// tout ce qui n'est pas explicitement reconnu reste du texte. Le rendu React
// échappe déjà ce texte : aucun rendu HTML brut n'est possible.
//
// Sous-ensemble volontairement petit : titres, paragraphes, gras, italique,
// listes ordonnées/non ordonnées, citations, code inline, tableaux simples.
// Les liens sont désactivés (le libellé reste du texte, l'URL est jetée).
//
// Bornes : taille, nombre de lignes, profondeur des citations, profondeur
// d'emboîtement inline, nombre de nœuds. Un document qui dépasse le budget de
// nœuds retombe en texte plat : jamais de rendu partiel ni de boucle ouverte.
// Un markdown invalide (tableau sans séparateur, marqueur non fermé) reste du
// texte, marqueurs compris.

export const MAX_MARKDOWN_CHARS = 20_000;
export const MAX_MARKDOWN_LINES = 2_000;
export const MAX_INLINE_DEPTH = 4;
export const MAX_MARKDOWN_NODES = 4_000;
export const MAX_QUOTE_DEPTH = 6;
export const MAX_TABLE_COLUMNS = 12;
export const MAX_TABLE_ROWS = 200;

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; children: InlineNode[] };

export type MarkdownBlock =
  | { type: "heading"; level: HeadingLevel; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; start: number; items: InlineNode[][] }
  | { type: "quote"; depth: number; children: InlineNode[] }
  | { type: "table"; header: InlineNode[][]; rows: InlineNode[][][] };

type ListMarker = { ordered: boolean; start: number; text: string };

const ESCAPABLE = "\\`*_{}[]()#+-.!|>";

/** Découpe une ligne de tableau simple. `null` si elle n'a aucun `|`. */
function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  let inner = trimmed;
  if (inner.startsWith("|")) inner = inner.slice(1);
  if (inner.endsWith("|")) inner = inner.slice(0, -1);
  const cells = inner.split("|").map((cell) => cell.trim());
  return cells.length > 0 ? cells : null;
}

/** Tableau seulement si l'en-tête et le séparateur ont le même nombre de
 *  cellules, dans les bornes. Sinon la zone reste un paragraphe (texte). */
function tableAt(
  lines: string[],
  index: number,
): { header: string[]; rows: string[][]; end: number } | null {
  const header = tableCells(lines[index] ?? "");
  if (!header || header.length === 0 || header.length > MAX_TABLE_COLUMNS) return null;
  const separator = tableCells(lines[index + 1] ?? "");
  if (!separator || separator.length !== header.length || !separator.every((cell) => /^:?-{1,}:?$/.test(cell))) {
    return null;
  }
  const rows: string[][] = [];
  let end = index + 2;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (!line.trim()) break;
    const row = tableCells(line);
    if (!row || row.length !== header.length) break;
    rows.push(row);
    end++;
  }
  if (rows.length > MAX_TABLE_ROWS) return null;
  return { header, rows, end };
}

function headingAt(line: string): { level: HeadingLevel; text: string } | null {
  const match = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
  if (!match) return null;
  const text = match[2]!.replace(/\s+#+\s*$/, "").trim();
  if (!text) return null;
  return { level: Math.min(6, Math.max(1, match[1]!.length)) as HeadingLevel, text };
}

function quoteAt(line: string): { depth: number; text: string } | null {
  const match = /^ {0,3}(>+)[ \t]?(.*)$/.exec(line);
  if (!match) return null;
  return { depth: Math.min(match[1]!.length, MAX_QUOTE_DEPTH), text: match[2]!.trim() };
}

function listAt(line: string): ListMarker | null {
  const unordered = /^ {0,3}[-+*][ \t]+(.+)$/.exec(line);
  if (unordered) return { ordered: false, start: 1, text: unordered[1]!.trim() };
  const ordered = /^ {0,3}(\d{1,9})[.)][ \t]+(.+)$/.exec(line);
  if (ordered) {
    const start = Number(ordered[1]);
    return { ordered: true, start: Number.isFinite(start) && start > 0 ? start : 1, text: ordered[2]!.trim() };
  }
  return null;
}

function pushText(nodes: InlineNode[], text: string): void {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") last.text += text;
  else nodes.push({ type: "text", text });
}

/** Analyse inline. `depth` borne l'emboîtement (gras dans italique, etc.) :
 *  au-delà, les marqueurs restent du texte au lieu d'ouvrir un nouveau niveau. */
function parseInline(source: string, depth = 0): InlineNode[] {
  const nodes: InlineNode[] = [];
  let text = "";
  let i = 0;
  const flush = () => {
    pushText(nodes, text);
    text = "";
  };

  while (i < source.length) {
    const char = source[i]!;

    // Échappement markdown : le caractère suivant est littéral.
    if (char === "\\" && i + 1 < source.length && ESCAPABLE.includes(source[i + 1]!)) {
      text += source[i + 1]!;
      i += 2;
      continue;
    }

    // Code inline : contenu brut, jamais réinterprété.
    if (char === "`") {
      const end = source.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        nodes.push({ type: "code", text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Lien/image : le libellé reste du texte, l'URL n'est même pas conservée.
    if (char === "[" || (char === "!" && source[i + 1] === "[")) {
      const start = char === "!" ? i + 1 : i;
      const match = /^\[([^\]\n]{0,500})\]\(([^)\n]{0,2000})\)/.exec(source.slice(start));
      if (match) {
        flush();
        nodes.push({ type: "link", children: parseInline(match[1]!, depth + 1) });
        i = start + match[0].length;
        continue;
      }
    }

    if (depth < MAX_INLINE_DEPTH) {
      if (source.startsWith("**", i)) {
        const end = source.indexOf("**", i + 2);
        if (end > i + 2) {
          flush();
          nodes.push({ type: "strong", children: parseInline(source.slice(i + 2, end), depth + 1) });
          i = end + 2;
          continue;
        }
      }
      if (source.startsWith("__", i)) {
        const end = source.indexOf("__", i + 2);
        if (end > i + 2) {
          flush();
          nodes.push({ type: "strong", children: parseInline(source.slice(i + 2, end), depth + 1) });
          i = end + 2;
          continue;
        }
      }
      if (char === "*" && source[i + 1] !== "*") {
        const end = source.indexOf("*", i + 1);
        if (end > i + 1 && source[end + 1] !== "*") {
          flush();
          nodes.push({ type: "em", children: parseInline(source.slice(i + 1, end), depth + 1) });
          i = end + 1;
          continue;
        }
      }
      if (char === "_" && source[i + 1] !== "_") {
        const end = source.indexOf("_", i + 1);
        if (end > i + 1 && source[end + 1] !== "_") {
          flush();
          nodes.push({ type: "em", children: parseInline(source.slice(i + 1, end), depth + 1) });
          i = end + 1;
          continue;
        }
      }
    }

    text += char;
    i++;
  }
  flush();
  return nodes;
}

function boundSource(markdown: string): string {
  let source = markdown;
  if (source.length > MAX_MARKDOWN_CHARS) {
    source = `${source.slice(0, MAX_MARKDOWN_CHARS - 1)}…`;
  }
  const lines = source.split("\n");
  if (lines.length > MAX_MARKDOWN_LINES) {
    return [...lines.slice(0, MAX_MARKDOWN_LINES - 1), "…"].join("\n");
  }
  return source;
}

function parseBlocks(source: string): MarkdownBlock[] {
  const lines = source.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = headingAt(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading.level, children: parseInline(heading.text) });
      i++;
      continue;
    }

    const quote = quoteAt(line);
    if (quote) {
      if (quote.text) blocks.push({ type: "quote", depth: quote.depth, children: parseInline(quote.text) });
      i++;
      continue;
    }

    const table = tableAt(lines, i);
    if (table) {
      blocks.push({
        type: "table",
        header: table.header.map((cell) => parseInline(cell)),
        rows: table.rows.map((row) => row.map((cell) => parseInline(cell))),
      });
      i = table.end;
      continue;
    }

    const marker = listAt(line);
    if (marker) {
      const items: InlineNode[][] = [];
      const start = marker.start;
      while (i < lines.length) {
        const next = listAt(lines[i] ?? "");
        if (!next || next.ordered !== marker.ordered) break;
        items.push(parseInline(next.text));
        i++;
      }
      blocks.push({ type: "list", ordered: marker.ordered, start, items });
      continue;
    }

    // Paragraphe : lignes consécutives non vides, hors début de bloc reconnu.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? "";
      if (!current.trim()) break;
      if (headingAt(current) || quoteAt(current) || listAt(current) || tableAt(lines, i)) break;
      paragraph.push(current.trim());
      i++;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
  }
  return blocks;
}

/** Compte les nœuds AST (bloc, inline, item de liste, cellule de tableau). */
export function countMarkdownNodes(blocks: MarkdownBlock[]): number {
  let count = 0;
  const countInline = (nodes: InlineNode[]) => {
    for (const node of nodes) {
      count++;
      if (node.type === "strong" || node.type === "em" || node.type === "link") countInline(node.children);
    }
  };
  for (const block of blocks) {
    count++;
    switch (block.type) {
      case "heading":
      case "paragraph":
      case "quote":
        countInline(block.children);
        break;
      case "list":
        for (const item of block.items) {
          count++;
          countInline(item);
        }
        break;
      case "table":
        for (const cell of block.header) {
          count++;
          countInline(cell);
        }
        for (const row of block.rows) {
          for (const cell of row) {
            count++;
            countInline(cell);
          }
        }
        break;
    }
  }
  return count;
}

/**
 * Parse un corps de fiche en blocs markdown sûrs. Le résultat ne contient
 * jamais de HTML : le rendu React échappe le texte.
 */
export function parseMarkdown(markdown: string): MarkdownBlock[] {
  // Un corps Windows (CRLF) ou vieux Mac (CR) rendrait ses marqueurs : les
  // expressions sont ancrées en `$` et `.` ne franchit pas `\r`. Normalisation
  // en UN seul point d'entrée, avant toute analyse.
  const source = boundSource(markdown.replace(/\r\n?/g, "\n"));
  const blocks = parseBlocks(source);
  if (countMarkdownNodes(blocks) <= MAX_MARKDOWN_NODES) return blocks;
  // Trop de nœuds : repli en texte plat, borné par la taille source. Mieux
  // vaut une fiche entière en texte qu'un rendu partiel ou une structure
  // pathologique qui fait exploser le DOM.
  return [{ type: "paragraph", children: [{ type: "text", text: source }] }];
}
