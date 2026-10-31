// Parseur LaTeX borné, rendu en MathML par `MathFormula`. Le TeX vient d'un
// modèle : aucune commande n'est exécutée, aucun HTML n'est construit, les
// commandes inconnues retombent en texte. Budget dépassé = texte linéaire,
// jamais de boucle ouverte.

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

const SYMBOLS: Record<string, { text: string; kind?: "operator" | "identifier"; large?: boolean }> = {
  // Opérateurs et relations
  times: { text: "×", kind: "operator" },
  div: { text: "÷", kind: "operator" },
  cdot: { text: "⋅", kind: "operator" },
  pm: { text: "±", kind: "operator" },
  mp: { text: "∓", kind: "operator" },
  ast: { text: "∗", kind: "operator" },
  star: { text: "⋆", kind: "operator" },
  circ: { text: "∘", kind: "operator" },
  bullet: { text: "•", kind: "operator" },
  leq: { text: "≤", kind: "operator" },
  le: { text: "≤", kind: "operator" },
  geq: { text: "≥", kind: "operator" },
  ge: { text: "≥", kind: "operator" },
  neq: { text: "≠", kind: "operator" },
  ne: { text: "≠", kind: "operator" },
  approx: { text: "≈", kind: "operator" },
  equiv: { text: "≡", kind: "operator" },
  sim: { text: "∼", kind: "operator" },
  simeq: { text: "≃", kind: "operator" },
  congruent: { text: "≅", kind: "operator" },
  propto: { text: "∝", kind: "operator" },
  infty: { text: "∞", kind: "operator" },
  partial: { text: "∂", kind: "operator" },
  nabla: { text: "∇", kind: "operator" },
  pmb: { text: "±", kind: "operator" },
  // Flèches
  rightarrow: { text: "→", kind: "operator" },
  to: { text: "→", kind: "operator" },
  leftarrow: { text: "←", kind: "operator" },
  gets: { text: "←", kind: "operator" },
  leftrightarrow: { text: "↔", kind: "operator" },
  Rightarrow: { text: "⇒", kind: "operator" },
  Leftarrow: { text: "⇐", kind: "operator" },
  Leftrightarrow: { text: "⇔", kind: "operator" },
  mapsto: { text: "↦", kind: "operator" },
  uparrow: { text: "↑", kind: "operator" },
  downarrow: { text: "↓", kind: "operator" },
  // Ensembles
  in: { text: "∈", kind: "operator" },
  notin: { text: "∉", kind: "operator" },
  ni: { text: "∋", kind: "operator" },
  subset: { text: "⊂", kind: "operator" },
  subseteq: { text: "⊆", kind: "operator" },
  supset: { text: "⊃", kind: "operator" },
  supseteq: { text: "⊇", kind: "operator" },
  cup: { text: "∪", kind: "operator" },
  cap: { text: "∩", kind: "operator" },
  setminus: { text: "∖", kind: "operator" },
  emptyset: { text: "∅", kind: "operator" },
  varnothing: { text: "∅", kind: "operator" },
  // Logique
  forall: { text: "∀", kind: "operator" },
  exists: { text: "∃", kind: "operator" },
  neg: { text: "¬", kind: "operator" },
  lnot: { text: "¬", kind: "operator" },
  land: { text: "∧", kind: "operator" },
  wedge: { text: "∧", kind: "operator" },
  lor: { text: "∨", kind: "operator" },
  vee: { text: "∨", kind: "operator" },
  therefore: { text: "∴", kind: "operator" },
  because: { text: "∵", kind: "operator" },
  // Grands opérateurs
  sum: { text: "∑", kind: "operator", large: true },
  prod: { text: "∏", kind: "operator", large: true },
  coprod: { text: "∐", kind: "operator", large: true },
  int: { text: "∫", kind: "operator", large: true },
  iint: { text: "∬", kind: "operator", large: true },
  iiint: { text: "∭", kind: "operator", large: true },
  oint: { text: "∮", kind: "operator", large: true },
  // Grec
  alpha: { text: "α", kind: "identifier" },
  beta: { text: "β", kind: "identifier" },
  gamma: { text: "γ", kind: "identifier" },
  delta: { text: "δ", kind: "identifier" },
  epsilon: { text: "ε", kind: "identifier" },
  varepsilon: { text: "ε", kind: "identifier" },
  zeta: { text: "ζ", kind: "identifier" },
  eta: { text: "η", kind: "identifier" },
  theta: { text: "θ", kind: "identifier" },
  vartheta: { text: "ϑ", kind: "identifier" },
  iota: { text: "ι", kind: "identifier" },
  kappa: { text: "κ", kind: "identifier" },
  lambda: { text: "λ", kind: "identifier" },
  mu: { text: "μ", kind: "identifier" },
  nu: { text: "ν", kind: "identifier" },
  xi: { text: "ξ", kind: "identifier" },
  omicron: { text: "ο", kind: "identifier" },
  pi: { text: "π", kind: "identifier" },
  varpi: { text: "ϖ", kind: "identifier" },
  rho: { text: "ρ", kind: "identifier" },
  varrho: { text: "ϱ", kind: "identifier" },
  sigma: { text: "σ", kind: "identifier" },
  varsigma: { text: "ς", kind: "identifier" },
  tau: { text: "τ", kind: "identifier" },
  upsilon: { text: "υ", kind: "identifier" },
  phi: { text: "φ", kind: "identifier" },
  varphi: { text: "ϕ", kind: "identifier" },
  chi: { text: "χ", kind: "identifier" },
  psi: { text: "ψ", kind: "identifier" },
  omega: { text: "ω", kind: "identifier" },
  Gamma: { text: "Γ", kind: "identifier" },
  Delta: { text: "Δ", kind: "identifier" },
  Theta: { text: "Θ", kind: "identifier" },
  Lambda: { text: "Λ", kind: "identifier" },
  Xi: { text: "Ξ", kind: "identifier" },
  Pi: { text: "Π", kind: "identifier" },
  Sigma: { text: "Σ", kind: "identifier" },
  Upsilon: { text: "Υ", kind: "identifier" },
  Phi: { text: "Φ", kind: "identifier" },
  Psi: { text: "Ψ", kind: "identifier" },
  Omega: { text: "Ω", kind: "identifier" },
  // Ponctuation et délimiteurs
  ldots: { text: "…", kind: "operator" },
  cdots: { text: "⋯", kind: "operator" },
  vdots: { text: "⋮", kind: "operator" },
  ddots: { text: "⋱", kind: "operator" },
  langle: { text: "⟨", kind: "operator" },
  rangle: { text: "⟩", kind: "operator" },
  lfloor: { text: "⌊", kind: "operator" },
  rfloor: { text: "⌋", kind: "operator" },
  lceil: { text: "⌈", kind: "operator" },
  rceil: { text: "⌉", kind: "operator" },
  prime: { text: "′", kind: "operator" },
  degree: { text: "°", kind: "operator" },
  angle: { text: "∠", kind: "operator" },
  perp: { text: "⊥", kind: "operator" },
  parallel: { text: "∥", kind: "operator" },
};

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "log", "ln", "exp", "lim", "limsup", "liminf",
  "max", "min", "sup", "inf", "det", "gcd", "mod", "deg", "dim", "ker", "arg",
]);

const BLACKBOARD: Record<string, string> = {
  C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ",
};

const ACCENTS: Record<string, MathAccent> = {
  bar: "bar",
  overline: "bar",
  vec: "vec",
  hat: "hat",
  widehat: "hat",
  tilde: "tilde",
  widetilde: "tilde",
  dot: "dot",
  ddot: "ddot",
};

const ESCAPED: Record<string, string> = {
  "%": "%", "&": "&", "$": "$", "#": "#", "_": "_", "{": "{", "}": "}",
  "|": "∥", "\\": " ",
};

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
    const body = this.takeEnvironmentBody(name);
    const mode =
      name === "pmatrix" ? "pmatrix"
      : name === "bmatrix" ? "bmatrix"
      : name === "vmatrix" ? "vmatrix"
      : name === "cases" ? "cases"
      : name === "aligned" || name === "align" || name === "gathered" ? "aligned"
      : "matrix";
    const rows = splitTopLevel(body, "\\\\")
      .map((row) => splitTopLevel(row, "&").slice(0, MAX_MATRIX_COLS))
      .filter((row) => row.some((cell) => cell.trim() !== ""))
      .slice(0, MAX_MATRIX_ROWS)
      .map((row) => row.map((cell) => new MathParser(cell.trim(), this.display).parse()));
    return { kind: "table", rows, mode };
  }

  private takeEnvironmentBody(name: string): string {
    const start = this.i;
    const stack: string[] = [name];
    while (this.i < this.src.length && stack.length > 0) {
      if (this.src.startsWith("\\begin{", this.i)) {
        this.i += "\\begin{".length;
        const end = this.src.indexOf("}", this.i);
        if (end === -1) break;
        stack.push(this.src.slice(this.i, end));
        this.i = end + 1;
        continue;
      }
      if (this.src.startsWith("\\end{", this.i)) {
        const endStart = this.i;
        this.i += "\\end{".length;
        const end = this.src.indexOf("}", this.i);
        if (end === -1) break;
        const closing = this.src.slice(this.i, end);
        this.i = end + 1;
        if (stack[stack.length - 1] === closing) stack.pop();
        if (stack.length === 0) {
          return this.src.slice(start, endStart);
        }
        continue;
      }
      this.i++;
    }
    return this.src.slice(start, this.i);
  }
}

function splitTopLevel(source: string, separator: string): string[] {
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

function boundedTex(tex: string): string {
  const normalized = tex.replace(/\r\n?/g, "\n").trim();
  return normalized.length > MAX_MATH_CHARS ? `${normalized.slice(0, MAX_MATH_CHARS - 1)}…` : normalized;
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
