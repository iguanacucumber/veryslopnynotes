// Vérifie les invariants d'architecture par analyse statique simple.
// Chaque règle renvoie à docs/architecture/INVARIANTS.md.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;

function listFiles(dir: string, out: string[] = []): string[] {
  try {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) {
        if ([".git", "node_modules", "dist", "build"].includes(e)) continue;
        listFiles(p, out);
      } else if (/\.(ts|tsx|kt|kts|java|js)$/.test(e)) {
        out.push(p);
      }
    }
  } catch { /* dir absent en bootstrap */ }
  return out;
}

const androidFiles = listFiles(join(ROOT, "android"));
const domainFiles = listFiles(join(ROOT, "server/domain"));
const serverFiles = listFiles(join(ROOT, "server"));
const allFiles = listFiles(ROOT);

function grep(files: string[], re: RegExp): string[] {
  return files.filter((f) => {
    try {
      return re.test(readFileSync(f, "utf8"));
    } catch {
      return false;
    }
  });
}

let fail: string[] = [];

// I1 : Android sans URL/hôte Pronote/ENT
const pronoteHost = /pronote|index-education|ent\.(ac-|cas|nevers)|cas\./i;
const i1 = grep(androidFiles, pronoteHost).filter((f) => !f.endsWith(".md"));
if (i1.length) fail.push(`I1: android référence Pronote/ENT: ${i1.join(", ")}`);

// I2 : un seul PronoteHttpClient, seul à parler à Pronote
const clients = grep(serverFiles, /class PronoteHttpClient/);
if (clients.length > 1) fail.push(`I2: plusieurs PronoteHttpClient: ${clients.join(", ")}`);
const directFetch = serverFiles.filter((f) => {
  if (f.includes("PronoteHttpClient")) return false;
  try {
    const c = readFileSync(f, "utf8");
    return /pronote/i.test(c) && /fetch\(|Bun\.serve|axios|got\(|https?\.(get|request)/.test(c);
  } catch {
    return false;
  }
});
if (directFetch.length) fail.push(`I2: accès réseau Pronote hors client: ${directFetch.join(", ")}`);

// I3 : domaine sans sqlite ni framework HTTP (imports/usage réel, pas commentaires)
// ponytail: strip commentaires ligne avant match. Upgrade: vrai AST/dependency-cruiser phase 1.
function codeOnly(content: string): string {
  return content
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("#") && !t.startsWith("<!--");
    })
    .join("\n");
}
const i3 = domainFiles.filter((f) => {
  try {
    const c = codeOnly(readFileSync(f, "utf8"));
    return (
      /import\s+[^;]*sqlite|from\s+['"][^'"]*sqlite|require\s*\([^)]*sqlite|bun:sqlite|better-sqlite3/i.test(c) ||
      /from\s+['"]hono|from\s+['"]express|require\s*\([^)]*(hono|express|fastify)|Bun\.serve/.test(c)
    );
  } catch {
    return false;
  }
});
if (i3.length) fail.push(`I3: domain dépend sqlite/HTTP: ${i3.join(", ")}`);

// I5 : LLM sans outils/réseau/secrets
const llmFiles = listFiles(join(ROOT, "server/ai"));
const i5 = grep(llmFiles, /tools\s*[:=]\s*\[.+[^\]]|fetch\(|Bun\.env|process\.env\s*\[\s*['"](MASTER_KEY|OPENROUTER_API_KEY)/);
if (i5.length) fail.push(`I5: LLM touche outils/réseau/secrets: ${i5.join(", ")}`);

if (fail.length) {
  console.error("check-architecture FAIL:");
  for (const f of fail) console.error(" - " + f);
  process.exit(1);
}
console.log("check-architecture OK");
export {};
