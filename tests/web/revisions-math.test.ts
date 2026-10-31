// Rendu MathML du TeX produit par un modèle (non fiable) : le parseur ne jette
// jamais, ne construit aucun HTML, et reste borné en taille.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBody } from "../../web/src/features/revisions/MarkdownBody";
import { MathFormula } from "../../web/src/features/revisions/MathFormula";
import {
  MAX_MATH_CHARS,
  mathToText,
  parseMath,
  type MathNode,
} from "../../web/src/features/revisions/math";
import { parseMarkdown } from "../../web/src/features/revisions/markdown";

function render(tex: string, display = false): string {
  return renderToStaticMarkup(createElement(MathFormula, { tex, display }));
}

describe("formules : parseur TeX borné", () => {
  test("fractions, racines et scripts restent lisibles en texte", () => {
    const tree = parseMath("\\frac{u_{n-1}}{2}+\\sqrt{x}");
    const text = mathToText(tree);
    expect(text).toContain("(u_(n−1))/(2)");
    expect(text).toContain("√(x)");
    expect(text).not.toContain("\\");
  });

  test("les environnements deviennent des tableaux typés", () => {
    const matrix = parseMath("\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}", true);
    expect(matrix).toMatchObject({ kind: "table", mode: "pmatrix" });
    expect((matrix as Extract<MathNode, { kind: "table" }>).rows).toHaveLength(2);

    const cases = parseMath("\\begin{cases}x&\\text{si }x>0\\\\0&\\text{sinon}\\end{cases}", true);
    expect(cases).toMatchObject({ kind: "table", mode: "cases" });
    const html = render("\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}", true);
    expect(html).toContain("<mtable");
    expect(html).toContain("<mtd>");
  });

  test("une taille absurde est coupée, sans boucle ni exception", () => {
    const huge = parseMath("x".repeat(MAX_MATH_CHARS + 5_000));
    const text = mathToText(huge);
    expect(text.length).toBeLessThanOrEqual(MAX_MATH_CHARS);
    expect(text.endsWith("…")).toBe(true);
    expect(() => parseMath("\\begin{pmatrix}1&2")).not.toThrow();
  });
});

describe("formules : rendu sûr", () => {
  test("le HTML du modèle reste du texte, jamais un nœud actif", () => {
    const html = render("\\text{<script>alert(1)</script>}");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("un bloc $$…$$ passe par MarkdownBody et produit du MathML", () => {
    const text = "$$\\begin{aligned}a&=b\\\\c&=d\\end{aligned}$$";
    const blocks = parseMarkdown(text);
    expect(blocks[0]).toMatchObject({ type: "math" });
    const html = renderToStaticMarkup(createElement(MarkdownBody, { text }));
    expect(html).toContain('<math display="block"');
    expect(html).toContain("<mtable");
    expect(html).not.toContain("\\begin");
  });
});
