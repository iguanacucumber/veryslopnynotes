// check-architecture.ts — garde-fous I1/I2/I3/I5 (+I4 secrets LLM). I6/I7 = tests/review, pas scannables en regex.
// I1 android sans hôte Pronote — FP: .md ignorés, commentaires /* */ et // ignorés. ponytail: plafond regex, upgrade dependency-cruiser phase 1.
// I2 serveur sans client Pronote ; le scanner interdit tout accès réseau Pronote côté serveur.
// I3 domaine sans sqlite/HTTP : `server/domain/` résiduel (#199, capture) et `android/core/` (port #203, stdlib seule) — FP: block comments, javadoc *, imports multi-lignes ([^;]* couvre \n). ponytail: plafond regex, upgrade AST/dependency-cruiser.
// I4 secrets dans l'IA refusés (`server/ai/` supprimé en #210, reste `android/core/`) — commentaires ignorés. ponytail: doublon volontaire avec check-secrets, upgrade gitleaks.
// I5 LLM sans outils/réseau/secrets — FP: commentaires ignorés, tools: [] vide autorisé. ponytail: plafond regex sur android/core (`server/ai/` supprimé en #210), upgrade AST.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

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
const androidCoreFiles = listFiles(join(ROOT, "android", "core"));
const domainFiles = listFiles(join(ROOT, "server/domain"));
const serverFiles = listFiles(join(ROOT, "server"));
const allFiles = listFiles(ROOT);

let fail: string[] = [];

// I1 : Android sans URL/hôte Pronote — repointé #200 puis #205 : seul
// `android/pronote/` parle Pronote en direct (module du port) ; depuis #205,
// `data`/`ui` manipulent les TYPES du client local (dépendance
// `project(":pronote")`, ADR-003) — câblage sanctionné, pas un hôte. Le mot
// reste interdit partout ailleurs ; `settings.gradle.kts` ne le porte que
// dans sa déclaration de module. La prose (INVARIANTS, AGENTS.md) suit en #211.
const pronoteHost = /pronote/i;
const PRONOTE_DIR = join(ROOT, "android", "pronote") + "/";
const i1 = androidFiles.filter((f) => {
  if (f.endsWith(".md")) return false; // docs légitimes ignorées
  if (f.startsWith(PRONOTE_DIR)) return false; // le module lui-même
  try {
    let code = codeOnly(readFileSync(f, "utf8"));
    if (f.endsWith("settings.gradle.kts")) code = code.replace(/^include\(.*\)$/m, "");
    code = code
      // #213 : l'adresse pré-remplie de l'écran d'appairage contient
      // "pronote" (URL réelle de NOTRE établissement, choix utilisateur
      // explicite). Exception nominative — un AUTRE hôte en dur retombe ici.
      .replace("https://9741050y.index-education.net/pronote", "")
      .replace(/project\(":pronote"\)/g, "")
      .replace(/PronoteSession|PronoteClientProvider/g, "")
      .replace(/fr\.veryslopnynotes\.pronote/g, "");
    return pronoteHost.test(code);
  } catch {
    return false;
  }
});
if (i1.length) fail.push(`I1: android référence Pronote: ${i1.join(", ")}`);

// I2 : aucun accès réseau Pronote dans le serveur (il ne sert que le scraper de manuels).
// ponytail: ligne-même OU URL+réseau évite FP fetch hors Pronote. Upgrade: AST dataflow.
const netRe = /fetch\(|axios|got\(|https?\.(get|request)|Bun\.serve|XMLHttpRequest|WebSocket/;
const pronoteUrlRe = /https?:\/\/[^\s"']*(pronote)/i;
function hasDirectFetch(code: string): boolean {
  if (code.split("\n").some((l) => pronoteHost.test(l) && netRe.test(l))) return true;
  return pronoteUrlRe.test(code) && netRe.test(code);
}
const directFetch = serverFiles.filter((f) => {
  try {
    return hasDirectFetch(codeOnly(readFileSync(f, "utf8")));
  } catch {
    return false;
  }
});
if (directFetch.length) fail.push(`I2: accès réseau Pronote hors client: ${directFetch.join(", ")}`);

// I3 : domaine sans sqlite ni framework HTTP (imports/usage réel, pas commentaires).
// #210 : `server/domain/` résiduel (capture #199) ET `android/core/` (port #203,
// stdlib + plateforme seules, zéro dépendance).
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
const i3 = [...domainFiles, ...androidCoreFiles].filter((f) => {
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
if (i3.length) fail.push(`I3: domaine dépend sqlite/HTTP: ${i3.join(", ")}`);

// I5 + I4 : LLM sans outils/réseau/secrets (I6/I7 non scannables ici — voir miroirs unitaires Android + review)
// Port #204 : le module IA vit dans `android/core/` (mêmes scans, mêmes
// motifs), `server/ai/` ayant été supprimé en #210 ; `android/data/OpenRouterLlm.kt est EXCLU (c'est l'appel HTTP
// fournisseur autorisé, piné par tests/unit/android-homework.test.ts, jamais scanné
// comme du pur).
const llmFiles = listFiles(join(ROOT, "server/ai"));
const ANDROID_AI = ["Untrusted.kt", "LlmGuard.kt", "AiPrompts.kt", "HomeworkAi.kt", "RevisionAi.kt", "Humanize.kt"].map(
  (f) => join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core", f),
);
llmFiles.push(...ANDROID_AI);
const secretRe = /sk-or-v1-|OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/;
const i4 = llmFiles.filter((f) => {
  try {
    return secretRe.test(codeOnly(readFileSync(f, "utf8")));
  } catch {
    return false;
  }
});
if (i4.length) fail.push(`I4: secret dans IA: ${i4.join(", ")}`);
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
