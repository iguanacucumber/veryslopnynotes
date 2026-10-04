// check-kotlin.ts — garde-fou structurel sur android/**/*.kt (sans SDK ni Gradle, sans réseau).
// K1 android: aucun `fun` redéclaré (même nom + mêmes types de paramètres) dans un même scope
//    (fichier, class/object/interface/companion). C'est l'erreur compilateur "conflicting
//    declarations" qui a cassé core en PR #114 (deux `private fun urlEncode`). Un class-like
//    ouvre son propre scope ; une fonction locale (corps de fun, if, when, lambda, init) est
//    IGNORÉE, donc deux `fun a()` dans deux blocs différents ne sont jamais signalés à tort.
// K2 android: idem `val`/`var`/`typealias` et `class`/`object`/`interface` dans un même scope.
// K3 android: accolades et parenthèses équilibrées en fin de fichier (KDoc et chaînes ignorés).
// K4 android: commentaire de bloc toujours refermé. Kotlin IMBRIQUE les commentaires de bloc,
//    donc un début de commentaire dans un KDoc (un chemin comme `/v1/pairing/` suivi d'une
//    étoile) en ouvre un second que la fin de commentaire suivante ne referme pas
//    suivant ne referme pas : tout le reste du fichier devient commentaire. Défaut rencontré
//    à la compilation après l'ajout du garde-fou 401 — le script, écrit façon Java, le ratait.
// Ce que la passe VOIT : doublons de signature exacts au niveau scope (le défaut PR #114),
//    accolades cassées, commentaire jamais refermé. Ce qu'elle ne VOIT PAS (le compilateur, lui) :
//    surcharge et ambiguïtés (`fun f(x: String)` + `fun f(x: String, y: Int = 1)` = appel ambigu),
//    nullabilité, types de retour, imports, résolution de symboles, elvis/`until` (autre défaut
//    PR #114, invisible ici), toute sémantique d'expression.
// ponytail: lecture mot à mot, pas de parser Kotlin ni de résolution de types ; un class-like
//    sans corps (`class A : B`) est invisible. Upgrade: ktlint (le compilateur, lui, est déjàbranché : `make android-compile`).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
// ponytail: chemin en argument pour le test (fixture temporaire), défaut android/.
const TARGET = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "android");

function listFiles(dir: string, out: string[] = []): string[] {
  try {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) {
        if ([".git", "node_modules", "build", "dist", ".gradle"].includes(e)) continue;
        listFiles(p, out);
      } else if (/\.(kt|kts)$/.test(e)) {
        out.push(p);
      }
    }
  } catch { /* dir absent en bootstrap */ }
  return out;
}

/** Vide commentaires et littéraux en conservant longueur et sauts de ligne : un `{`
 *  de KDoc ou de chaîne ne doit pas compter comme bloc.
 *  K4 : Kotlin IMBRIQUE les commentaires de bloc, Java non. Un début de commentaire
 *  écrit DANS un KDoc — par exemple un chemin `/v1/pairing/` suivi d'une étoile —
 *  en ouvre un second, que la première fermeture ne referme pas : tout le reste du
 *  fichier passe alors pour un commentaire et le fichier ne compile plus. D'où le
 *  comptage de profondeur ci-dessous, et le signalement d'un commentaire jamais
 *  refermé. (Défaut rencontré à la compilation après l'ajout du garde-fou 401 :
 *  ce script, écrit façon Java, le ratait.) */
function blank(src: string): { text: string; unterminated: boolean } {
  const out = src.split("");
  const n = src.length;
  const hole = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < n) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      let k = i + 2;
      while (k < n && depth > 0) {
        if (src[k] === "/" && src[k + 1] === "*") { depth++; k += 2; continue; }
        if (src[k] === "*" && src[k + 1] === "/") { depth--; k += 2; continue; }
        k++;
      }
      if (depth > 0) return { text: out.join(""), unterminated: true };
      hole(i, k);
      i = k;
      continue;
    }
    if (c === '"') {
      const raw = src.startsWith('"""', i); // chaîne brute multi-lignes
      const sep = raw ? '"""' : '"';
      let k = i + sep.length;
      while (k < n) {
        if (src[k] === "\\") { k += 2; continue; }
        if (raw ? src.startsWith(sep, k) : src[k] === '"') {
          k += sep.length;
          break;
        }
        if (!raw && src[k] === "\n") { k++; break; }
        k++;
      }
      hole(i, k);
      i = k;
      continue;
    }
    if (c === "'") {
      // littéral caractère : on mange tout jusqu'au apostrophe fermant (échappée ou non)
      let k = i + 1;
      while (k < n && src[k] !== "'" && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
      if (src[k] === "'") {
        hole(i, k + 1);
        i = k + 1;
        continue;
      }
      i++; // apostrophe hors littéral : on avance, aucun bloc touché
      continue;
    }
    i++;
  }
  return { text: out.join(""), unterminated: false };
}

/** Types de paramètres normalisés : nom de paramètre et valeur par défaut retirés. */
function paramTypes(raw: string): string {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of raw) {
    if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c)) depth--;
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts
    .map((p) => {
      const t = p.includes(":") ? p.slice(p.lastIndexOf(":") + 1) : p;
      const eq = t.indexOf("=");
      return (eq >= 0 ? t.slice(0, eq) : t)
        .replace(/\b(crossinline|noinline|vararg)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
    })
    .filter((t) => t.length > 0)
    .join(",");
}

const wordAt = (src: string, i: number): string => {
  let k = i;
  while (k < src.length && /[A-Za-z0-9_]/.test(src[k]!)) k++;
  return src.slice(i, k);
};

function checkFile(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  const { text: src, unterminated } = blank(raw);
  const rel = relative(ROOT, path) || path;
  const problems: string[] = [];
  if (unterminated) {
    return [`${rel}: commentaire de bloc jamais refermé (Kotlin imbrique les commentaires de bloc)`];
  }
  const lineAt = (i: number) => src.slice(0, i).split("\n").length;

  type Scope = { label: string; decl: boolean; names: Map<string, number> };
  const stack: Scope[] = [{ label: rel, decl: true, names: new Map() }];
  // Portée d'enregistrement : le scope courant doit être class-like ; sinon la
  // déclaration est locale (corps de fun, if, lambda, init) et on l'ignore.
  const scope = (): Scope | null => (stack[stack.length - 1]!.decl ? stack[stack.length - 1]! : null);
  const declare = (key: string, at: number) => {
    const s = scope();
    if (!s) return;
    const prev = s.names.get(key);
    if (prev !== undefined) {
      problems.push(`${rel}:${lineAt(at)}: déclaration en double dans ${s.label}: ${key} (déjà vue ligne ${prev})`);
    } else {
      s.names.set(key, lineAt(at));
    }
  };

  let pending: { kind: string; name: string; start: number } | null = null;
  let braces = 0;
  let parens = 0;
  // Entre parenthèses on est dans une liste de paramètres/valeurs : `data class
  // Foo(val id: String)` déclare un paramètre de constructeur, pas une propriété.
  let depthParens = 0;
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i]!;
    if (c === "{") {
      const header = pending ? src.slice(pending.start, i) : "";
      const named = pending && !/=|->/.test(header);
      if (named) {
        declare(`class ${pending!.name}`, pending!.start);
        stack.push({ label: `${pending!.kind} ${pending!.name}`, decl: true, names: new Map() });
      } else {
        stack.push({ label: "bloc", decl: false, names: new Map() });
      }
      pending = null;
      braces++;
      i++;
      continue;
    }
    if (c === "}") {
      if (stack.length > 1) stack.pop();
      pending = null;
      braces--;
      i++;
      continue;
    }
    if (c === ";") { pending = null; i++; continue; }
    if (c === "(") { parens++; depthParens++; i++; continue; }
    if (c === ")") { parens--; depthParens--; i++; continue; }
    if (!/[A-Za-z0-9_]/.test(c)) { i++; continue; }

    const w = wordAt(src, i);
    const after = i + w.length;
    // `Foo::class` et `a.b` ne sont pas des déclarations.
    const prev = i > 0 ? src[i - 1]! : "";
    if (prev === "." || prev === ":" || depthParens > 0) { i = after; continue; }

    if (w === "fun") {
      let j = after;
      const ws = () => { while (j < n && /\s/.test(src[j]!)) j++; };
      ws();
      if (src[j] === "<") { // paramètres de type (peuvent contenir `->` et `()`)
        let d = 0;
        for (; j < n; j++) {
          if (src[j] === "<") d++;
          else if (src[j] === ">" && --d === 0) break;
        }
        ws();
      }
      const open = src.indexOf("(", j);
      const head = open === -1 ? "" : src.slice(j, open);
      const name = /([A-Za-z_]\w*)\s*$/.exec(head)?.[1];
      if (open === -1 || !name) { i = after; continue; }
      let d = 0;
      let k = open;
      for (; k < n; k++) {
        if (src[k] === "(") d++;
        else if (src[k] === ")" && --d === 0) { k++; break; }
      }
      const dot = head.lastIndexOf(".");
      const recv = dot >= 0 ? head.slice(dot + 1).trim() : "";
      declare(`${recv ? recv + "." : ""}${name}(${paramTypes(src.slice(open + 1, k - 1))})`, i);
      i = k;
      continue;
    }
    if (w === "val" || w === "var" || w === "typealias") {
      let j = after;
      while (j < n && /\s/.test(src[j]!)) j++;
      // déstructuration `val (a, b) = ...` : pas de nom simple, ignorée.
      const name = src[j] === "(" ? null : (/^[A-Za-z_]\w*/.exec(src.slice(j))?.[0] ?? null);
      if (name) declare(`prop ${name}`, i);
      i = after;
      continue;
    }
    if (w === "class" || w === "interface") {
      let j = after;
      while (j < n && /\s/.test(src[j]!)) j++;
      // `class A`, `class A<T>`, `interface A : B` : un nom est obligatoire, et
      // le `{` qui suit doit être le corps (pas une valeur par défaut).
      if (/^[A-Za-z_]\w*(?:<[^<>]*>)?\s*(?=\(|:|\{)/.test(src.slice(j))) {
        const name = /^[A-Za-z_]\w*/.exec(src.slice(j))![0];
        pending = { kind: w, name, start: i };
      }
      i = after;
      continue;
    }
    if (w === "object") {
      let j = after;
      while (j < n && /\s/.test(src[j]!)) j++;
      const name = /^[A-Za-z_]\w*/.exec(src.slice(j))?.[0];
      // `object Foo {` et `companion object {` ouvrent un scope ; `object : X {`
      // est une expression anonyme : scope non nommé, Declarations ignorées.
      pending = { kind: "object", name: name ?? "<anonyme>", start: i };
      i = after;
      continue;
    }
    i = after;
  }

  if (braces !== 0) problems.push(`${rel}: accolades déséquilibrées (${braces > 0 ? "+" : ""}${braces})`);
  if (parens !== 0) problems.push(`${rel}: parenthèses déséquilibrées (${parens > 0 ? "+" : ""}${parens})`);
  return problems;
}

const files = listFiles(TARGET);
const failures = files.flatMap(checkFile);

if (failures.length) {
  console.error("check-kotlin FAIL:");
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
console.log(`check-kotlin OK (${files.length} fichiers .kt/.kts)`);
export {};