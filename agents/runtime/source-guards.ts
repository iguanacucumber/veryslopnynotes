export const pronoteHost = /pronote/i;
export const sqliteRe =
  /import\s+[^;]*sqlite|from\s+['"][^'"]*sqlite|require\s*\([^)]*sqlite|bun:sqlite|better-sqlite3/i;
export const httpRe = /from\s+['"]hono|from\s+['"]express|require\s*\([^)]*(hono|express|fastify)|Bun\.serve/;

const netRe = /fetch\(|axios|got\(|https?\.(get|request)|Bun\.serve|XMLHttpRequest|WebSocket/;
const pronoteUrlRe = /https?:\/\/[^\s"']*(pronote)/i;

// ponytail: two source-text heuristics; upgrade to AST/dataflow if server gains more outbound routes.
export function hasDirectFetch(code: string): boolean {
  if (code.split("\n").some((line) => pronoteHost.test(line) && netRe.test(line))) return true;
  return pronoteUrlRe.test(code) && netRe.test(code);
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
