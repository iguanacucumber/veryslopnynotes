// Rendu linéaire d'un arbre mathématique, sans dépendance au parseur.

import type { MathNode } from "./math-types";

/** Texte linéaire : alttext MathML, repli et tests. */
export function mathToText(node: MathNode): string {
  switch (node.kind) {
    case "row":
      return node.children.map(mathToText).join("");
    case "number":
    case "identifier":
    case "operator":
    case "text":
      return node.text;
    case "space":
      return " ";
    case "frac":
      return `${node.delimited ? "(" : ""}(${mathToText(node.numerator)})/(${mathToText(node.denominator)})${node.delimited ? ")" : ""}`;
    case "sqrt":
      return `${node.index ? `${mathToText(node.index)}√` : "√"}(${mathToText(node.body)})`;
    case "script":
      return [
        mathToText(node.base),
        node.sub ? `_(${mathToText(node.sub)})` : "",
        node.sup ? `^(${mathToText(node.sup)})` : "",
      ].join("");
    case "accent":
      return mathToText(node.base);
    case "table":
      return node.rows.map((row) => row.map(mathToText).join(" ")).join(" ; ");
  }
}
