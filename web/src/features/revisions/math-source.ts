// Découpage de la source TeX, indépendant du parseur et des tables.

import { MAX_MATH_CHARS } from "./math-types";

/** Tronque la source avant analyse : le budget s'applique à l'entrée brute. */
export function boundedTex(tex: string): string {
  const normalized = tex.replace(/\r\n?/g, "\n").trim();
  return normalized.length > MAX_MATH_CHARS ? `${normalized.slice(0, MAX_MATH_CHARS - 1)}…` : normalized;
}

/** Découpe au séparateur de premier niveau, sans couper groupes ni environnements. */
export function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let env = 0;
  let start = 0;
  let i = 0;
  while (i < source.length) {
    if (source[i] === "\\" && source.startsWith("\\begin{", i)) {
      env++;
      i += 7;
      continue;
    }
    if (source[i] === "\\" && source.startsWith("\\end{", i)) {
      env = Math.max(0, env - 1);
      i += 5;
      continue;
    }
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth = Math.max(0, depth - 1);
    if (depth === 0 && env === 0 && source.startsWith(separator, i)) {
      parts.push(source.slice(start, i));
      i += separator.length;
      start = i;
      continue;
    }
    i++;
  }
  parts.push(source.slice(start));
  return parts;
}
