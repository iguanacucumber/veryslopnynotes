// Parseur LaTeX borné, rendu en MathML par `MathFormula`. Le TeX vient d'un
// modèle : aucune commande n'est exécutée, aucun HTML n'est construit, les
// commandes inconnues retombent en texte. Budget dépassé = texte linéaire,
// jamais de boucle ouverte.

import {
  MAX_MATH_DEPTH,
  MAX_MATRIX_COLS,
  MAX_MATRIX_ROWS,
  type MathNode,
} from "./math-types";
import { ACCENTS, BLACKBOARD, ESCAPED, FUNCTIONS, SYMBOLS } from "./math-symbols";
import { boundedTex, splitTopLevel } from "./math-source";
import { matrixMode, takeEnvironmentBody } from "./math-environment";

class MathParser {
  private i = 0;
  private depth = 0;

  constructor(
    private readonly src: string,
    readonly display: boolean,
  ) {}

  parse(): MathNode {
    const children = this.parseRow();
    return children.length === 1 ? children[0]! : { kind: "row", children };
  }

  private parseRow(stopAtBrace = false): MathNode[] {
    const nodes: MathNode[] = [];
    while (this.i < this.src.length) {
      const char = this.src[this.i]!;
      if (stopAtBrace && char === "}") break;
      if (char === "&") break;
      if (char === "\\" && this.src[this.i + 1] === "\\") break;
      if (char === "\\" && this.src.startsWith("\\end", this.i)) break;
      nodes.push(...this.parseAtomWithScripts());
    }
    return nodes;
  }

  private parseAtomWithScripts(): MathNode[] {
    if (this.depth > MAX_MATH_DEPTH) {
      this.i++;
      return [{ kind: "text", text: "…" }];
    }
    const base = this.parseAtom();
    let sub: MathNode | undefined;
    let sup: MathNode | undefined;
    while (this.i < this.src.length) {
      const marker = this.src[this.i];
      if (marker !== "_" && marker !== "^") break;
      this.i++;
      const argument = this.parseScriptArgument();
      if (marker === "_") sub = argument;
      else sup = argument;
    }
    const largeBase = base.kind === "operator" && base.large === true;
    if (largeBase && this.display && (sub || sup)) {
      return [{ kind: "script", base, sub, sup }];
    }
    if (sub && sup) return [{ kind: "script", base, sub, sup }];
    if (sub) return [{ kind: "script", base, sub }];
    if (sup) return [{ kind: "script", base, sup }];
    return [base];
  }

  private parseScriptArgument(): MathNode {
    while (this.src[this.i] === " ") this.i++;
    if (this.src[this.i] === "{") return this.parseGroup();
    if (this.i >= this.src.length) return { kind: "text", text: "" };
    return this.parseAtom();
  }

  private parseGroup(): MathNode {
    if (this.src[this.i] !== "{") return this.parseAtom();
    this.i++;
    this.depth++;
    const children = this.parseRow(true);
    if (this.src[this.i] === "}") this.i++;
    this.depth--;
    return children.length === 1 ? children[0]! : { kind: "row", children };
  }

  private readGroupText(): string {
    if (this.src[this.i] !== "{") return "";
    this.i++;
    const start = this.i;
    let depth = 1;
    while (this.i < this.src.length && depth > 0) {
      const char = this.src[this.i]!;
      if (char === "\\") {
        this.i += 2;
        continue;
      }
      if (char === "{") depth++;
      else if (char === "}") depth--;
      if (depth > 0) this.i++;
    }
    const text = this.src.slice(start, this.i);
    if (this.src[this.i] === "}") this.i++;
    return text;
  }

  private parseAtom(): MathNode {
    const char = this.src[this.i];
    if (char === undefined) return { kind: "text", text: "" };
    if (char === "{") return this.parseGroup();
    if (char === "\\") return this.parseCommand();
    if (char === "~") {
      this.i++;
      return { kind: "space", width: "medium" };
    }
    if (char === "&") {
      this.i++;
      return { kind: "space", width: "medium" };
    }
    if (/[0-9]/.test(char)) {
      const start = this.i;
      while (/[0-9]/.test(this.src[this.i] ?? "")) this.i++;
      return { kind: "number", text: this.src.slice(start, this.i) };
    }
    if (/[a-zA-Z]/.test(char)) {
      this.i++;
      return { kind: "identifier", text: char };
    }
    if ("+-=*/<>()[]|,;:!?'".includes(char)) {
      this.i++;
      const pretty: Record<string, string> = {
        "*": "∗", "-": "−", "'": "′", "|": "|",
      };
      return { kind: "operator", text: pretty[char] ?? char };
    }
    this.i++;
    if (char.trim() === "") return { kind: "space", width: "thin" };
    return { kind: "text", text: char };
  }

  private parseCommand(): MathNode {
    this.i++;
    if (this.i >= this.src.length) return { kind: "text", text: "\\" };
    const first = this.src[this.i]!;
    if (!/[a-zA-Z]/.test(first)) {
      this.i++;
      if (first === "\\") return { kind: "space", width: "medium" };
      if (first === " " || first === "," || first === ";" || first === ":") {
        return { kind: "space", width: first === " " || first === "," ? "thin" : "medium" };
      }
      if (first === "!") return { kind: "space", width: "thin" };
      const escaped = ESCAPED[first];
      return escaped ? { kind: "text", text: escaped } : { kind: "operator", text: first };
    }
    const start = this.i;
    while (/[a-zA-Z]/.test(this.src[this.i] ?? "")) this.i++;
    const name = this.src.slice(start, this.i);
    const symbol = SYMBOLS[name];
    if (symbol) {
      return symbol.kind === "identifier"
        ? { kind: "identifier", text: symbol.text, variant: "normal" }
        : { kind: "operator", text: symbol.text, large: symbol.large === true };
    }
    if (FUNCTIONS.has(name)) {
      return { kind: "identifier", text: name, variant: "normal" };
    }
    switch (name) {
      case "frac":
      case "dfrac":
      case "tfrac":
        return {
          kind: "frac",
          numerator: this.parseGroup(),
          denominator: this.parseGroup(),
        };
      case "binom": {
        const numerator = this.parseGroup();
        const denominator = this.parseGroup();
        return { kind: "frac", numerator, denominator, delimited: true };
      }
      case "sqrt": {
        let index: MathNode | undefined;
        if (this.src[this.i] === "[") {
          this.i++;
          const start = this.i;
          while (this.i < this.src.length && this.src[this.i] !== "]") this.i++;
          const raw = this.src.slice(start, this.i);
          if (this.src[this.i] === "]") this.i++;
          index = new MathParser(raw, this.display).parse();
        }
        return { kind: "sqrt", body: this.parseGroup(), index };
      }
      case "text":
      case "textrm":
      case "textnormal":
      case "mathrm":
      case "mathbf":
      case "mathit":
      case "mathsf":
      case "texttt":
      case "operatorname": {
        const raw = this.readGroupText();
        return { kind: "identifier", text: raw.replace(/\s+/g, " "), variant: "normal" };
      }
      case "mathbb":
      case "mathcal":
      case "mathscr": {
        const raw = this.readGroupText();
        const mapped = [...raw].map((char) => BLACKBOARD[char] ?? char).join("");
        return {
          kind: "identifier",
          text: mapped,
          variant: name === "mathbb" ? "blackboard" : "script",
        };
      }
      case "overline":
      case "bar":
      case "vec":
      case "hat":
      case "widehat":
      case "tilde":
      case "widetilde":
      case "dot":
      case "ddot":
        return { kind: "accent", base: this.parseGroup(), accent: ACCENTS[name] ?? "bar" };
      case "overset":
      case "underset": {
        const annotation = this.parseGroup();
        const body = this.parseGroup();
        return name === "overset"
          ? { kind: "script", base: body, sup: annotation }
          : { kind: "script", base: body, sub: annotation };
      }
      case "left":
      case "right":
      case "middle":
      case "big":
      case "Big":
      case "bigg":
      case "Bigg":
      case "bigl":
      case "bigr":
      case "Bigl":
      case "Bigr":
        return { kind: "operator", text: this.readDelimiter() };
      case "begin":
        return this.parseEnvironment();
      case "end":
        return { kind: "text", text: "" };
      case "quad":
        return { kind: "space", width: "medium" };
      case "qquad":
        return { kind: "space", width: "thick" };
      case "enspace":
      case "thinspace":
        return { kind: "space", width: "thin" };
      case "medspace":
        return { kind: "space", width: "medium" };
      case "thickspace":
        return { kind: "space", width: "thick" };
      case "hspace":
      case "vspace":
        this.readGroupText();
        return { kind: "space", width: "medium" };
      case "color":
      case "textcolor":
        this.readGroupText();
        return { kind: "text", text: "" };
      case "displaystyle":
      case "textstyle":
      case "scriptstyle":
      case "scriptscriptstyle":
      case "limits":
      case "nolimits":
        return { kind: "text", text: "" };
      case "not": {
        const body = this.parseAtom();
        return { kind: "row", children: [{ kind: "operator", text: "¬" }, body] };
      }
      default:
        return { kind: "identifier", text: name, variant: "normal" };
    }
  }

  private readDelimiter(): string {
    if (this.i >= this.src.length) return "";
    if (this.src[this.i] === "\\") {
      this.i++;
      const first = this.src[this.i];
      this.i++;
      if (first === "{") return "{";
      if (first === "}") return "}";
      if (first === "|") return "∥";
      return first ?? "";
    }
    const char = this.src[this.i]!;
    this.i++;
    return char === "." ? "" : char;
  }

  private parseEnvironment(): MathNode {
    const name = this.readGroupText().trim();
    if (name === "array") this.readGroupText();
    const { body, next } = takeEnvironmentBody(this.src, this.i, name);
    this.i = next;
    const rows = splitTopLevel(body, "\\\\")
      .map((row) => splitTopLevel(row, "&").slice(0, MAX_MATRIX_COLS))
      .filter((row) => row.some((cell) => cell.trim() !== ""))
      .slice(0, MAX_MATRIX_ROWS)
      .map((row) => row.map((cell) => new MathParser(cell.trim(), this.display).parse()));
    return { kind: "table", rows, mode: matrixMode(name) };
  }
}

/** Analyse une expression TeX. Ne jette jamais : une entrée vide ou absurde
 *  devient du texte, et le rendu reste borné. */
export function parseMath(tex: string, display = false): MathNode {
  const source = boundedTex(tex);
  if (!source) return { kind: "text", text: "" };
  try {
    return new MathParser(source, display).parse();
  } catch {
    return { kind: "text", text: source };
  }
}
