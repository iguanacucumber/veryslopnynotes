// Barrel public du parseur LaTeX borné : l'API reste stable même si les
// tables, la source, le parseur et le rendu texte vivent dans des modules
// internes séparés.

export {
  MAX_MATH_CHARS,
  MAX_MATH_DEPTH,
  MAX_MATRIX_COLS,
  MAX_MATRIX_ROWS,
} from "./math-types";
export type { MathAccent, MathNode } from "./math-types";
export { parseMath } from "./math-parse";
export { mathToText } from "./math-text";
