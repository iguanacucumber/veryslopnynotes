// #630 : le corps d'une fiche est du contenu de modèle (non fiable). Le
// renderer doit afficher un markdown lisible sans jamais interpréter le HTML.
//
// Les tests purs portent sur l'AST borné ; les tests DOM rendent le vrai
// composant (`react-dom/server`) et lisent ce que l'utilisateur voit. Un
// `<script>` ou un `javascript:` ne doit jamais devenir un nœud actif.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBody } from "../../web/src/features/revisions/MarkdownBody";
import {
  countMarkdownNodes,
  MAX_INLINE_DEPTH,
  MAX_MARKDOWN_CHARS,
  MAX_MARKDOWN_NODES,
  MAX_QUOTE_DEPTH,
  parseMarkdown,
  type InlineNode,
  type MarkdownBlock,
} from "../../web/src/features/revisions/markdown";

function inlineDepth(nodes: InlineNode[]): number {
  let depth = 0;
  for (const node of nodes) {
    if (node.type === "strong" || node.type === "em" || node.type === "link") {
      depth = Math.max(depth, 1 + inlineDepth(node.children));
    }
  }
  return depth;
}

function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "code") return node.text;
      return inlineText(node.children);
    })
    .join("");
}

function blockText(blocks: MarkdownBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
        case "paragraph":
        case "quote":
          return inlineText(block.children);
        case "list":
          return block.items.map(inlineText).join(" ");
        case "table":
          return [...block.header, ...block.rows.flat()].map(inlineText).join(" ");
      }
    })
    .join("\n");
}

function render(text: string): string {
  return renderToStaticMarkup(createElement(MarkdownBody, { text }));
}

describe("parseur markdown borné (#630)", () => {
  test("reconnaît le sous-ensemble attendu", () => {
    const blocks = parseMarkdown(
      [
        "## Titre",
        "",
        "Un **gras**, une *italique* et du `code`.",
        "",
        "- puce un",
        "- puce deux",
        "",
        "1. étape un",
        "2. étape deux",
        "",
        "> citation",
        "",
        "| Colonne A | Colonne B |",
        "| --- | --- |",
        "| 1 | 2 |",
      ].join("\n"),
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "quote",
      "table",
    ]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[3]).toMatchObject({ type: "list", ordered: true, start: 1 });
    expect(blocks[4]).toMatchObject({ type: "quote", depth: 1 });
    expect(blocks[5]).toMatchObject({ type: "table" });
  });

  test("un markdown invalide reste du texte, marqueurs compris", () => {
    const unclosed = parseMarkdown("**gras non fermé");
    expect(unclosed).toHaveLength(1);
    expect(unclosed[0]).toMatchObject({ type: "paragraph" });
    expect(blockText(unclosed)).toBe("**gras non fermé");

    const badTable = parseMarkdown("| a | b |\n| --- |");
    expect(badTable).toHaveLength(1);
    expect(badTable[0]).toMatchObject({ type: "paragraph" });
    expect(blockText(badTable)).toContain("|");
    expect(blockText(badTable)).toContain("---");

    const html = parseMarkdown("<script>alert(1)</script>");
    expect(blockText(html)).toBe("<script>alert(1)</script>");
  });

  test("la taille est bornée, avec une marque de troncature", () => {
    const blocks = parseMarkdown("x".repeat(MAX_MARKDOWN_CHARS + 5_000));
    const text = blockText(blocks);
    expect(text.length).toBeLessThanOrEqual(MAX_MARKDOWN_CHARS);
    expect(text.endsWith("…")).toBe(true);
  });

  test("la profondeur des citations est bornée", () => {
    const blocks = parseMarkdown(`${">".repeat(40)} citation profonde`);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "quote", depth: MAX_QUOTE_DEPTH });
    expect(blockText(blocks)).toBe("citation profonde");
  });

  test("l'emboîtement inline est borné", () => {
    const blocks = parseMarkdown("__a **b *c _d e_ d* e** f__");
    expect(blocks).toHaveLength(1);
    const paragraph = blocks[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") throw new Error("paragraphe attendu");
    expect(inlineDepth(paragraph.children)).toBe(MAX_INLINE_DEPTH);
    expect(inlineText(paragraph.children)).toBe("a b c d e d e f");
  });

  test("le nombre de nœuds est borné : au-delà, repli en texte plat", () => {
    const dense = "**a** ".repeat(3_000);
    const blocks = parseMarkdown(dense);
    expect(countMarkdownNodes(blocks)).toBeLessThanOrEqual(MAX_MARKDOWN_NODES);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
  });

  test("un corps CRLF (Windows) se parse comme un corps LF", () => {
    // Les expressions sont ancrées en `$` et `.` ne franchit pas `\r` : sans
    // normalisation à l'entrée, `## Titre\r` restait un paragraphe littéral.
    const lines = [
      "## Titre",
      "",
      "- puce un",
      "- puce deux",
      "",
      "1. étape un",
      "2. étape deux",
      "",
      "> citation",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ];
    const crlf = parseMarkdown(lines.join("\r\n"));
    const lf = parseMarkdown(lines.join("\n"));
    expect(crlf.map((block) => block.type)).toEqual(["heading", "list", "list", "quote", "table"]);
    expect(crlf).toEqual(lf);
    // Et le rendu ne laisse aucun marqueur littéral.
    const html = render(lines.join("\r\n"));
    expect(html).toContain("<h4");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).not.toContain("## Titre");
    // Un `\r` seul (vieux Mac) est normalisé de la même façon.
    expect(parseMarkdown("## Titre\r- puce").map((block) => block.type)).toEqual(["heading", "list"]);
  });
});

describe("rendu markdown de fiche : lisible et sûr (#630)", () => {
  test("titres, listes, gras, code et tableau deviennent des éléments réels", () => {
    const html = render(
      [
        "## Titre principal",
        "### Sous-titre",
        "",
        "Un **gras**, une *italique* et du `code`.",
        "",
        "- puce un",
        "- puce deux",
        "",
        "1. étape un",
        "2. étape deux",
        "",
        "> citation",
        "",
        "| Colonne A | Colonne B |",
        "| --- | --- |",
        "| 1 | 2 |",
      ].join("\n"),
    );

    expect(html).toContain("<h4");
    expect(html).toContain("Titre principal");
    expect(html).toContain("<h5");
    expect(html).toContain("Sous-titre");
    expect(html).toContain("<strong>gras</strong>");
    expect(html).toContain("<em>italique</em>");
    expect(html).toContain("<code");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain("<li>");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<th");
    expect(html).toContain('scope="col"');
    expect(html).toContain("<tbody");
    expect(html).toContain("<td>");
    expect(html).toContain("revision-markdown__table-wrap");
  });

  test("<script>, <img onerror> et javascript: restent inertes", () => {
    const html = render(
      [
        "## Sécurité",
        "",
        "<script>alert(1)</script>",
        "",
        '<img src=x onerror="alert(1)">',
        "",
        "[clique](javascript:alert(1))",
        "[data](data:text/html,evil)",
      ].join("\n"),
    );

    // Les balises sont échappées : aucun élément script/img ne naît du texte.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    // Les liens sont désactivés : libellé seul, URL absente, aucun href.
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html).toContain("clique");
    expect(html).toContain("data");
  });
});
