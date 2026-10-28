/**
 * Hôte PRONOTE : le mot du produit ET le domaine de l'éditeur.
 *
 * `index-education.net` est le domaine RÉEL des établissements PRONOTE (cf. la
 * référence `pronotets` : `hubeduconnect.index-education.net`) : avec
 * `/pronote/i` seul, un hôte PRONOTE glissé dans `android/data/` passait la
 * garde I1 (#489).
 */
export const pronoteHost = /pronote|index-education/i;
export const sqliteRe =
  /import\s+[^;]*sqlite|from\s+['"][^'"]*sqlite|require\s*\([^)]*sqlite|bun:sqlite|better-sqlite3/i;
export const httpRe = /from\s+['"]hono|from\s+['"]express|require\s*\([^)]*(hono|express|fastify)|Bun\.serve/;

/**
 * Imports de PLATEFORME que Gradle ne voit pas : ils ne figurent dans aucun
 * `build.gradle.kts`, donc la frontière des modules ne peut pas les refuser.
 * `android/core/` les interdit (I3) : réseau Java, SQLite Android, Room.
 */
export const platformRe = /\bimport\s+(?:static\s+)?(?:java\.net|android\.database|androidx\.room)\b/;

const netRe = /fetch\(|axios|got\(|https?\.(get|request)|Bun\.serve|XMLHttpRequest|WebSocket/;

// ponytail: two source-text heuristics; upgrade to AST/dataflow if server gains more outbound routes.
//
// #535 : le mot de l'hôte suffit, n'importe où dans le fichier. Avant, il
// fallait que le mot ET l'appel réseau soient sur la MÊME ligne, ou que
// l'URL soit un littéral COMPLET (`https://…index-education.net…`) : une URL
// assemblée à l'exécution passait — `const h = "index-education" + ".net";
// await fetch("https://" + h);` — alors que le mot est bien dans le fichier.
//
// Le signal est déjà là : le mot `pronote`/`index-education` est INTERDIT
// hors du module `android/pronote/` (I1). Un fichier du serveur qui le
// mentionne ET appelle le réseau est donc un accès PRONOTE direct, que la
// forme de l'URL cache ou non. fail-closed : on refuse le fichier.
export function hasDirectFetch(code: string): boolean {
  if (!netRe.test(code)) return false;
  // Commentaires ignorés : une mention en prose n'est pas un accès.
  return pronoteHost.test(codeOnly(code));
}

/**
 * Types MIME EXÉCUTABLES : le lecteur qui les ouvre INTERPRÈTE le contenu
 * (script, balise, stylesheet). #398 — une pièce jointe nommée par le serveur
 * ne doit jamais en sortir : `consignes.html` partait vers un lecteur tiers
 * comme du HTML exécutable, au lieu d'octets inertes (I6).
 */
export const EXECUTABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "text/xml-external-parsed-entity",
  "application/javascript",
  "text/javascript",
  "application/ecmascript",
  "text/ecmascript",
  "application/x-shockwave-flash",
  "application/vnd.ms-htmlhelp",
]);

/**
 * Contenu d'un appel Kotlin `setOf(...)` / `mapOf(...)` — le texte entre ses
 * parenthèses. `name` = le nom de la VALEUR déclarée (`MIME_BY_EXTENSION`,
 * `TEXT_ONLY_EXTENSIONS`…) : on lit la première parenthèse après la
 * déclaration, c'est-à-dire l'appel `setOf(`/`mapOf(` qui l'initialise.
 */
function kotlinCallBody(src: string, name: string): string {
  const i = src.indexOf(name);
  if (i < 0) return "";
  const open = src.indexOf("(", i);
  const close = open < 0 ? -1 : src.indexOf(")", open);
  return open < 0 || close < 0 ? "" : src.slice(open + 1, close);
}

/** Table `extension` → `type MIME` déclarée dans une source Kotlin. */
export function parseMimeTable(src: string): Map<string, string> {
  const table = new Map<string, string>();
  for (const m of kotlinCallBody(src, "MIME_BY_EXTENSION").matchAll(/"([^"]+)"\s+to\s+"([^"]+)"/g)) {
    table.set(m[1]!.toLowerCase(), m[2]!.toLowerCase());
  }
  return table;
}

/** Littéraux d'un `setOf(...)` Kotlin (extensions, types refusés…). */
export function parseKotlinStringSet(src: string, name: string): Set<string> {
  return new Set(
    [...kotlinCallBody(src, name).matchAll(/"([^"]+)"/g)].map((m) => m[1]!.toLowerCase()),
  );
}

/** Source without comments, for lightweight architecture and Kotlin mirror tests. */
export function codeOnly(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .split("\n")
    .filter((line) => {
      const text = line.trim();
      return (
        !text.startsWith("//") &&
        !text.startsWith("*") &&
        !text.startsWith("#") &&
        !text.startsWith("<!--")
      );
    })
    .map((line) => {
      const comment = line.search(/(?<!:)\/\//);
      return comment >= 0 ? line.slice(0, comment) : line;
    })
    .join("\n");
}
