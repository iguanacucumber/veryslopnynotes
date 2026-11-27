// Environnements TeX : mode de tableau et extraction du corps jusqu'au \end
// correspondant. Purement textuel, sans dépendance au parseur.

import type { MathNode } from "./math-types";

export type TableMode = Extract<MathNode, { kind: "table" }>["mode"];

export function matrixMode(name: string): TableMode {
  return name === "pmatrix" ? "pmatrix"
    : name === "bmatrix" ? "bmatrix"
    : name === "vmatrix" ? "vmatrix"
    : name === "cases" ? "cases"
    : name === "aligned" || name === "align" || name === "gathered" ? "aligned"
    : "matrix";
}

/** Corps de l'environnement (hors `\begin`/`\end`) et index qui suit le `\end` fermant. */
export function takeEnvironmentBody(
  src: string,
  start: number,
  name: string,
): { body: string; next: number } {
  let i = start;
  const stack: string[] = [name];
  while (i < src.length && stack.length > 0) {
    if (src.startsWith("\\begin{", i)) {
      i += "\\begin{".length;
      const end = src.indexOf("}", i);
      if (end === -1) break;
      stack.push(src.slice(i, end));
      i = end + 1;
      continue;
    }
    if (src.startsWith("\\end{", i)) {
      const endStart = i;
      i += "\\end{".length;
      const end = src.indexOf("}", i);
      if (end === -1) break;
      const closing = src.slice(i, end);
      i = end + 1;
      if (stack[stack.length - 1] === closing) stack.pop();
      if (stack.length === 0) {
        return { body: src.slice(start, endStart), next: i };
      }
      continue;
    }
    i++;
  }
  return { body: src.slice(start, i), next: i };
}
