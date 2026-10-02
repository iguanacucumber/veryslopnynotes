// Scan anti-secrets : échoue si pattern secret dans fichiers trackés.
// private-key — vraie clé PEM (commentaires inclus volontairement, pas de FP à traiter).
// openrouter-key — sk-or-v1-... ; FP: masqués xxx courts ignorés par {8,}.
// env-assign — KEY=valeur réelle ; FP: .env.example ignoré, $VAR ignoré, placeholders (your/example/xxx/</TODO/dummy) ignorés. ponytail: plafond regex, upgrade gitleaks en CI.
// storageState — token/session Playwright, jamais commité.
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
// ponytail: allowlist placeholders docs légitimes. Upgrade: gitleaks.
const PLACEHOLDER_RE = /your|example|placeholder|x{3,}|<[^>]*>|TODO|change-?me|dummy/i;

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
      const m = content.match(re);
      if (!m) continue;
      if (name === "env-assign") {
        // Ignore lignes placeholders (docs légitimes), échoue sinon.
        const bad = m.input!.split("\n").filter(
          (l) => re.test(l) && !PLACEHOLDER_RE.test(l.split("=").slice(1).join("=")),
        );
        if (!bad.length) continue;
      }
      failures.push(`${p}: motif suspect (${name})`);
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
