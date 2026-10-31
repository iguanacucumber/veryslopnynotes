import { createElement, type ReactNode } from "react";
import { mathToText, parseMath, type MathNode } from "./math";

// MathML natif : React construit les éléments, aucun HTML du modèle n'entre
// dans le DOM. Chromium 109+ (déjà exigé par `color-mix`) rend MathML Core.
const html = (tag: string, props: Record<string, unknown> | null, ...children: ReactNode[]) =>
  createElement(tag, props, ...children);

const ACCENT_MARKS: Record<string, string> = {
  bar: "¯",
  vec: "→",
  hat: "^",
  tilde: "~",
  dot: "˙",
  ddot: "¨",
};

function render(node: MathNode, display: boolean, key: string): ReactNode {
  switch (node.kind) {
    case "row":
      return html("mrow", { key }, ...node.children.map((child, index) => render(child, display, `${key}-${index}`)));
    case "number":
      return html("mn", { key }, node.text);
    case "identifier":
      return html(
        "mi",
        { key, mathvariant: node.variant === "normal" ? "normal" : undefined },
        node.text,
      );
    case "operator":
      return html("mo", { key, largeop: node.large ? "true" : undefined }, node.text);
    case "text":
      return html("mtext", { key }, node.text);
    case "space":
      return html("mspace", {
        key,
        width: node.width === "thin" ? "0.16em" : node.width === "thick" ? "0.55em" : "0.3em",
      });
    case "frac": {
      const fraction = html(
        "mfrac",
        { key },
        html("mrow", null, render(node.numerator, display, `${key}-n`)),
        html("mrow", null, render(node.denominator, display, `${key}-d`)),
      );
      if (!node.delimited) return fraction;
      return html(
        "mrow",
        { key },
        html("mo", { stretchy: "true", fence: "true" }, "("),
        fraction,
        html("mo", { stretchy: "true", fence: "true" }, ")"),
      );
    }
    case "sqrt":
      return node.index
        ? html(
            "mroot",
            { key },
            render(node.body, display, `${key}-b`),
            render(node.index, display, `${key}-i`),
          )
        : html("msqrt", { key }, render(node.body, display, `${key}-b`));
    case "script": {
      const base = render(node.base, display, `${key}-base`);
      const sub = node.sub ? render(node.sub, display, `${key}-sub`) : null;
      const sup = node.sup ? render(node.sup, display, `${key}-sup`) : null;
      const limits =
        display && node.base.kind === "operator" && node.base.large === true;
      if (limits) {
        if (sub && sup) return html("munderover", { key }, base, sub, sup);
        if (sub) return html("munder", { key }, base, sub);
        if (sup) return html("mover", { key }, base, sup);
      }
      if (sub && sup) return html("msubsup", { key }, base, sub, sup);
      if (sub) return html("msub", { key }, base, sub);
      return html("msup", { key }, base, sup ?? html("mrow", null));
    }
    case "accent":
      return html(
        "mover",
        { key, accent: "true" },
        render(node.base, display, `${key}-base`),
        html("mo", null, ACCENT_MARKS[node.accent] ?? "¯"),
      );
    case "table": {
      const table = html(
        "mtable",
        {
          key,
          columnalign: node.mode === "aligned" ? "left" : "center",
          rowspacing: "0.35em",
          columnspacing: "0.9em",
        },
        ...node.rows.map((row, rowIndex) =>
          html(
            "mtr",
            { key: `${key}-r${rowIndex}` },
            ...row.map((cell, cellIndex) =>
              html("mtd", { key: `${key}-r${rowIndex}c${cellIndex}` }, render(cell, display, `${key}-r${rowIndex}c${cellIndex}`)),
            ),
          ),
        ),
      );
      if (node.mode === "matrix" || node.mode === "aligned") return table;
      const open = node.mode === "cases" || node.mode === "pmatrix" ? "(" : node.mode === "bmatrix" ? "[" : "|";
      const close = node.mode === "cases" || node.mode === "pmatrix" ? ")" : node.mode === "bmatrix" ? "]" : "|";
      return html(
        "mrow",
        { key },
        html("mo", { stretchy: "true", fence: "true" }, open),
        table,
        html("mo", { stretchy: "true", fence: "true" }, close),
      );
    }
  }
}

export function MathFormula({
  tex,
  display = false,
  className,
}: {
  tex: string;
  display?: boolean;
  className?: string;
}) {
  const tree = parseMath(tex, display);
  const alttext = mathToText(tree);
  const formula = html(
    "math",
    {
      display: display ? "block" : "inline",
      alttext,
      "aria-label": alttext,
    },
    render(tree, display, "math"),
  );
  if (!display) return <span className={className ? `math-inline ${className}` : "math-inline"}>{formula}</span>;
  return <div className={className ? `math-display ${className}` : "math-display"}>{formula}</div>;
}
