// Scan anti-secrets : échoue si pattern secret dans fichiers trackés.
// private-key — vraie clé PEM (commentaires inclus volontairement, pas de FP à traiter).
// openrouter-key — sk-or-v1-... ; FP: masqués xxx courts ignorés par {8,}.
// env-assign — KEY=valeur réelle ; FP: .env.example ignoré, $VAR ignoré, placeholders (your/example/xxx/</TODO/dummy) ignorés. ponytail: plafond regex, upgrade gitleaks en CI.
// storageState — token/session Playwright, jamais commité.
// Les motifs vivent dans `secret-patterns.ts` : le jeu strict pour le dépôt, un
// jeu élargi (preuve au lieu d'indice) pour le contenu vendorisé `.agents/`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { matchPatterns, patternsFor } from "./secret-patterns";

// ponytail: racine en argument pour le test (fixture temporaire), défaut dépôt.
const ROOT = process.argv[2] ? resolve(process.argv[2]) : join(import.meta.dir, "..", "..");
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".bun-cache"]);
const SKIP_FILES = new Set(["bun.lock", "bun.lockb", "package-lock.json", "check-secrets.ts", "secret-patterns.ts"]);
// Chemins locaux jamais commités (gitignorés) : pas de scan contenu.
// .env.local untracked requis pour intégration -> PASS (issue #85).
const SKIP_PATH_PREFIXES = ["server/data/", "playwright/.auth/"];

let failures: string[] = [];

// Liste fichiers trackés git si dispo, fallback readdir brut sinon.
// Tout fichier untracked (.env.local, server/data, playwright/.auth)
// est ignoré : secrets locaux ne bloquent pas make check (#85).
function trackedSet(): Set<string> | null {
  try {
    const out = execSync("git ls-files -z", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] });
    const parts = String(out).split("\0").filter((s) => s.length > 0);
    return new Set(parts);
  } catch {
    return null;
  }
}

const TRACKED = trackedSet();

function isSkippedPath(absPath: string): boolean {
  const rel = relative(ROOT, absPath).replace(/\\/g, "/");
  for (const prefix of SKIP_PATH_PREFIXES) {
    if (rel === prefix.slice(0, -1) || rel.startsWith(prefix)) return true;
  }
  return false;
}

function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    // Chemins locaux gitignorés : jamais scannés, jamais FAIL.
    if (isSkippedPath(p)) continue;
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(e)) continue;
      walk(p);
      continue;
    }
    if (SKIP_FILES.has(e) || e === ".env.example") continue;
    const rel = relative(ROOT, p).replace(/\\/g, "/");
    // Fichiers .env* : FAIL uniquement si trackés git, sinon skip contenu.
    // .env.local untracked requis pour intégration -> PASS (#85).
    if (/\.env(\.|$)/.test(e) || e.endsWith(".env") || e.endsWith(".env.local")) {
      const tracked = TRACKED ? TRACKED.has(rel) : true;
      if (tracked) failures.push(`${p}: fichier .env* tracké (interdit sauf .env.example)`);
      continue;
    }
    // Hors git (fallback) : scan contenu quand même ci-dessous.
    // Sous git : seuls fichiers trackés scannés (untracked = locaux, skip).
    if (TRACKED && !TRACKED.has(rel)) continue;
    let content: string;
    try {
      content = readFileSync(p, "utf8");
    } catch {
      continue; // binaire
    }
    for (const name of matchPatterns(content, patternsFor(rel))) {
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
