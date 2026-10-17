// check-architecture.ts — garde-fous I1/I2/I3/I5 (+I4 secrets LLM). I6/I7 = tests/review, pas scannables en regex.
// I1 android sans hôte Pronote — FP: .md ignorés, commentaires /* */ et // ignorés. ponytail: plafond regex, upgrade dependency-cruiser phase 1.
// I2 serveur sans client Pronote ; le scanner interdit tout accès réseau Pronote côté serveur.
// I3 android/core sans sqlite/HTTP — FP: block comments, javadoc *, imports multi-lignes ([^;]* couvre \n). ponytail: plafond regex, upgrade AST/dependency-cruiser.
// I4 secrets dans l'IA refusés (`server/ai/` supprimé en #210, reste `android/core/`) — commentaires ignorés. ponytail: doublon volontaire avec check-secrets, upgrade gitleaks.
// I5 LLM sans outils/réseau/secrets — FP: commentaires ignorés, tools: [] vide autorisé. ponytail: plafond regex sur android/core (`server/ai/` supprimé en #210), upgrade AST.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly, hasDirectFetch, httpRe, pronoteHost, sqliteRe } from "./source-guards";

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
const serverFiles = listFiles(join(ROOT, "server"));

let fail: string[] = [];

// I1 : Android sans URL/hôte Pronote — repointé #200 puis #205 : seul
// `android/pronote/` parle Pronote en direct (module du port) ; depuis #205,
// `data`/`ui` manipulent les TYPES du client local (dépendance
// `project(":pronote")`, ADR-003) — câblage sanctionné, pas un hôte. Le mot
// reste interdit partout ailleurs ; `settings.gradle.kts` ne le porte que
// dans sa déclaration de module. La prose (INVARIANTS, AGENTS.md) suit en #211.
const PRONOTE_DIR = join(ROOT, "android", "pronote") + "/";
const i1 = androidFiles.filter((f) => {
  if (f.endsWith(".md")) return false; // docs légitimes ignorées
  if (f.startsWith(PRONOTE_DIR)) return false; // le module lui-même
  try {
    let code = codeOnly(readFileSync(f, "utf8"));
    if (f.endsWith("settings.gradle.kts")) code = code.replace(/^include\(.*\)$/m, "");
    code = code
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
const directFetch = serverFiles.filter((f) => {
  try {
    return hasDirectFetch(codeOnly(readFileSync(f, "utf8")));
  } catch {
    return false;
  }
});
if (directFetch.length) fail.push(`I2: accès réseau Pronote hors client: ${directFetch.join(", ")}`);

// I3 : android/core sans sqlite ni framework HTTP (imports/usage réel, pas commentaires).
// ponytail: strip block //ligne avant match. Upgrade: vrai AST/dependency-cruiser phase 1.
const i3 = androidCoreFiles.filter((f) => {
  try {
    const c = codeOnly(readFileSync(f, "utf8"));
    return sqliteRe.test(c) || httpRe.test(c);
  } catch {
    return false;
  }
});
if (i3.length) fail.push(`I3: android/core dépend sqlite/HTTP: ${i3.join(", ")}`);

// I5 + I4 : LLM sans outils/réseau/secrets (I6/I7 non scannables ici — voir miroirs unitaires Android + review).
// Port #204 : l'IA vit dans `android/core/`; `server/ai/` a été supprimé en #210.
// `android/data/OpenRouterLlm.kt` est hors scan : seul appel fournisseur autorisé, testé par android-homework.test.ts.
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
