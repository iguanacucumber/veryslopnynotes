// Scan anti-secrets : échoue si pattern secret dans fichiers trackés.
// ponytail: plafond volontairement simple (regex). Upgrade: gitleaks en CI.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".bun-cache"]);
const SKIP_FILES = new Set(["bun.lock", "bun.lockb", "package-lock.json", "check-secrets.ts"]);

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "private-key", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "openrouter-key", re: /sk-or-v1-[A-Za-z0-9]{8,}/ },
  { name: "env-assign", re: /(OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD|MANUAL_PASSWORD)\s*=\s*[^$\s][^\n]{3,}/ },
  { name: "storageState", re: /storageState.*(token|session|cookie)/i },
];

let failures: string[] = [];

function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(e)) continue;
      walk(p);
      continue;
    }
    if (SKIP_FILES.has(e) || e === ".env.example") continue;
    if (e.endsWith(".env") || e.endsWith(".env.local")) {
      failures.push(`${p}: fichier .env* tracké (interdit sauf .env.example)`);
      continue;
    }
    let content: string;
    try {
      content = readFileSync(p, "utf8");
    } catch {
      continue; // binaire
    }
    for (const { name, re } of PATTERNS) {
      if (re.test(content)) failures.push(`${p}: motif suspect (${name})`);
    }
  }
}

walk(ROOT);

if (failures.length > 0) {
  console.error("check-secrets FAIL:");
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
console.log("check-secrets OK");
