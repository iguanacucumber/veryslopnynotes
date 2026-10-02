// check-architecture.ts — garde-fous I1/I2/I3/I5 (+I4 secrets LLM). I6/I7 = tests/review, pas scannables en regex.
// I1 android sans hôte Pronote/ENT — FP: .md ignorés, commentaires /* */ et // ignorés. ponytail: plafond regex, upgrade dependency-cruiser phase 1.
// I2 unique PronoteHttpClient, seul accès réseau — FP: commentaires ignorés, fetch hors Pronote ignoré (exige hôte+réseau même ligne OU URL Pronote + réseau). ponytail: plafond regex, upgrade AST phase 1.
// I3 domain sans sqlite/HTTP — FP: block comments, javadoc *, imports multi-lignes ([^;]* couvre \n). ponytail: plafond regex, upgrade AST/dependency-cruiser.
// I4 secrets dans server/ai refusés — commentaires ignorés. ponytail: doublon volontaire avec check-secrets, upgrade gitleaks.
// I5 LLM sans outils/réseau/secrets — FP: commentaires ignorés, tools: [] vide autorisé. ponytail: plafond regex sur server/ai, upgrade AST.
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
const i1 = androidFiles.filter((f) => {
  if (f.endsWith(".md")) return false; // docs légitimes ignorées
  try {
    return pronoteHost.test(codeOnly(readFileSync(f, "utf8")));
  } catch {
    return false;
  }
});
if (i1.length) fail.push(`I1: android référence Pronote/ENT: ${i1.join(", ")}`);

// I2 : un seul PronoteHttpClient, seul à parler à Pronote
const clients = grep(serverFiles, /class PronoteHttpClient/);
if (clients.length > 1) fail.push(`I2: plusieurs PronoteHttpClient: ${clients.join(", ")}`);
// ponytail: ligne-même OU URL+réseau évite FP fetch hors Pronote. Upgrade: AST dataflow.
const netRe = /fetch\(|axios|got\(|https?\.(get|request)|Bun\.serve|XMLHttpRequest|WebSocket/;
const pronoteUrlRe = /https?:\/\/[^\s"']*(pronote|index-education|ent\.(ac-|cas|nevers))/i;
function hasDirectFetch(code: string): boolean {
  if (code.split("\n").some((l) => pronoteHost.test(l) && netRe.test(l))) return true;
  return pronoteUrlRe.test(code) && netRe.test(code);
}
const directFetch = serverFiles.filter((f) => {
  if (f.includes("PronoteHttpClient")) return false;
  try {
    return hasDirectFetch(codeOnly(readFileSync(f, "utf8")));
  } catch {
    return false;
  }
});
if (directFetch.length) fail.push(`I2: accès réseau Pronote hors client: ${directFetch.join(", ")}`);

// I3 : domaine sans sqlite ni framework HTTP (imports/usage réel, pas commentaires)
// ponytail: strip block //ligne avant match. Upgrade: vrai AST/dependency-cruiser phase 1.
function codeOnly(content: string): string {
  const noBlock = content
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "\n");
  return noBlock
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("#") && !t.startsWith("<!--");
    })
    .map((l) => {
      const idx = l.search(/(?<!:)\/\//);
      return idx >= 0 ? l.slice(0, idx) : l;
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

// I5 + I4 : LLM sans outils/réseau/secrets (I6/I7 non scannables ici — voir tests/security + review/e2e)
const llmFiles = listFiles(join(ROOT, "server/ai"));
const secretRe = /sk-or-v1-|OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/;
const i4 = llmFiles.filter((f) => {
  try {
    return secretRe.test(codeOnly(readFileSync(f, "utf8")));
  } catch {
    return false;
  }
});
if (i4.length) fail.push(`I4: secret dans server/ai: ${i4.join(", ")}`);
const i5 = llmFiles.filter((f) => {
  try {
    const c = codeOnly(readFileSync(f, "utf8"));
    return (
      /tools\s*[:=]\s*\[[^\]]*[^\s\]]/.test(c) || // outils non-vides seuls ; [] vide autorisé
      /fetch\(|XMLHttpRequest|WebSocket|Bun\.serve/.test(c) ||
      /Bun\.env|process\.env/.test(c) ||
      secretRe.test(c)
    );
  } catch {
    return false;
  }
});
if (i5.length) fail.push(`I5: LLM touche outils/réseau/secrets: ${i5.join(", ")}`);

if (fail.length) {
  console.error("check-architecture FAIL:");
  for (const f of fail) console.error(" - " + f);
  process.exit(1);
}
console.log("check-architecture OK");
export {};
