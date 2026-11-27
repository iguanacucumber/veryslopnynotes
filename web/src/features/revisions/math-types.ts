// Types et budgets du parseur LaTeX borné, partagés sans dépendre du parseur.

export const MAX_MATH_CHARS = 4_000;
export const MAX_MATH_DEPTH = 12;
export const MAX_MATRIX_ROWS = 24;
export const MAX_MATRIX_COLS = 8;

export type MathAccent = "bar" | "vec" | "hat" | "tilde" | "dot" | "ddot";

export type MathNode =
  | { kind: "row"; children: MathNode[] }
  | { kind: "number"; text: string }
  | { kind: "identifier"; text: string; variant?: "normal" | "blackboard" | "script" }
  | { kind: "operator"; text: string; large?: boolean }
  | { kind: "text"; text: string }
  | { kind: "space"; width: "thin" | "medium" | "thick" }
  | { kind: "frac"; numerator: MathNode; denominator: MathNode; delimited?: boolean }
  | { kind: "sqrt"; body: MathNode; index?: MathNode }
  | { kind: "script"; base: MathNode; sub?: MathNode; sup?: MathNode }
  | { kind: "accent"; base: MathNode; accent: MathAccent }
  | { kind: "table"; rows: MathNode[][]; mode: "matrix" | "pmatrix" | "bmatrix" | "vmatrix" | "cases" | "aligned" };
