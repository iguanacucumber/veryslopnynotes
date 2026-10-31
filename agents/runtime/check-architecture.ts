// check-architecture.ts — garde-fous I1/I2/I3/I5 (+I4 secrets LLM). I6/I7 = tests/review.
// I1 android sans hôte Pronote ; I2 serveur sans client Pronote + frontière lue
// dans les build.gradle.kts (un seul Client) ; I3 android/core sans import
// plateforme ; I4 secrets IA refusés ; I5 LLM sans outils/réseau/secrets.
// FP: `.md`, commentaires (`//`, `/* */`, javadoc) ignorés ; un fichier
// illisible est SIGNALÉ, jamais avalé : invariant non vérifiable ≠ respecté.
// ponytail: plafond regex (upgrade AST/dependency-cruiser) ; le scan de secrets
// reste un doublon volontaire de check-secrets (upgrade gitleaks).
//
// Les artefacts GÉNÉRÉS (`assets` du bundle Vite, réécrit pendant que les
// étapes tournent en parallèle) sont exclus du parcours : sinon le verdict de
// I1 dépend de l'ordre d'exécution (faux vert ou faux rouge selon qui gagne).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { bound, repoPath } from "./output";
import { codeOnly, hasDirectFetch, platformRe, pronoteHost } from "./source-guards";

const ROOT = join(import.meta.dir, "..", "..");

/** Répertoires NON parcourus : outillage et sorties de build (Gradle écrit dans
 *  les dossiers `build` de chaque module pendant le scan). */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".gradle"]);

/** Bundle Vite généré (`assets/web`, gitignoré, réécrit à chaque build) :
 *  ignoré PAR CHEMIN, pas par nom de dossier — `web/src` doit rester scanné. */
const GENERATED_SUFFIX = ["src", "main", "assets"];

function isGenerated(path: string): boolean {
  const parts = path.split(sep);
  return GENERATED_SUFFIX.every((seg, i) => parts[parts.length - GENERATED_SUFFIX.length + i] === seg);
}

/** Fichiers du parcours, sous `dir`.
 *
 *  Trié (verdict reproductible) ; une entrée illisible (fichier supprimé entre
 *  `readdir` et `stat`, lien mort) n'abandonne pas le reste du répertoire. */
export function listFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // répertoire absent en bootstrap : rien à parcourir
  }
  for (const e of entries.sort()) {
    const p = join(dir, e);
    try {
      const st = statSync(p);
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(e)) continue;
        if (isGenerated(p)) continue;
        listFiles(p, out);
      } else if (/\.(ts|tsx|kt|kts|java|js)$/.test(e)) {
        out.push(p);
      }
    } catch {
      continue; // entrée disparue ou illisible : on continue le répertoire
    }
  }
  return out;
}

/**
 * Un répertoire scanné doit EXISTER et contenir des fichiers : sinon I1, I2 et
 * I3 seraient **vacuement vrais** (un répertoire renommé annoncerait « OK »).
 * Un invariant non vérifiable n'est pas un invariant respecté → ÉCHEC.
 *
 * `root` = racine du dépôt. `sousDossiers` = ce que cet invariant exige.
 */
function repertoiresManquants(root: string, sousDossiers: string[]): string[] {
  const manquants: string[] = [];
  for (const sous of sousDossiers) {
    const dir = join(root, sous);
    if (!existsSync(dir)) {
      manquants.push(`${sous}/ : répertoire ABSENT (invariant non vérifiable)`);
      continue;
    }
    if (listFiles(dir).length === 0) {
      manquants.push(`${sous}/ : aucun fichier à vérifier (invariant non vérifiable)`);
    }
  }
  return manquants;
}

/** Arêtes inter-modules AUTORISÉES par la frontière (ADR-003) : la vérité est
 *  dans Gradle, pas dans une liste de types. `core` et `pronote` restent purs. */
export const MODULE_EDGES: Readonly<Record<string, readonly string[]>> = {
  core: [],
  pronote: [],
  data: ["core", "pronote"],
  app: ["core", "data"],
};

/** Modules référencés par `project(":x")` (commentaires retirés). */
export function gradleProjectDeps(source: string): string[] {
  return [...codeOnly(source).matchAll(/project\(\s*["']:([\w.-]+)["']\s*\)/g)].map((m) => m[1]!);
}

/** Erreurs de frontière lues dans les quatre `build.gradle.kts` : arête non
 *  déclarée = échec, module absent = invariant non vérifiable. */
export function moduleBoundaryErrors(root: string): string[] {
  const errors: string[] = [];
  for (const [module, allowed] of Object.entries(MODULE_EDGES)) {
    const file = join(root, "android", module, "build.gradle.kts");
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      errors.push(`I2: frontière Gradle: ${module}/build.gradle.kts manquant (invariant non vérifiable)`);
      continue;
    }
    const interdites = gradleProjectDeps(source).filter((dep) => !allowed.includes(dep));
    if (interdites.length) {
      errors.push(`I2: frontière Gradle: ${module} dépend de ${interdites.join(", ")} (arête non déclarée)`);
    }
    if (allowed.length === 0 && /^\s*dependencies\s*\{/m.test(codeOnly(source))) {
      errors.push(`I2: frontière Gradle: ${module} déclare un bloc dependencies (module pur)`);
    }
  }
  return errors;
}

/** Scan des invariants. `root` surchargeable pour les tests (fixture). */
export function scanArchitecture(root: string = ROOT): string[] {
  const androidFiles = listFiles(join(root, "android"));
  const androidCoreFiles = listFiles(join(root, "android", "core"));
  const serverFiles = listFiles(join(root, "server"));

  const fail: string[] = [];
  /** Fichiers illisibles : invariant non vérifiable, donc signalé, pas avalé. */
  const unreadable = new Set<string>();

  /** Bloc d'un invariant : libellé + chemins BORNÉS ; le verdict porte TOUS
   *  les chemins. */
  const bloc = (label: string, paths: readonly string[]): string =>
    [
      label,
      ...bound(root, "check-architecture", paths.map((p) => `  ${repoPath(root, p)}`)),
    ].join("\n");

  /** Source sans commentaires, ou null si illisible. ENOENT = rien à vérifier ;
   *  toute autre erreur (droits, EIO) = invariant non vérifiable → signalé. */
  const readCode = (file: string): string | null => {
    try {
      return codeOnly(readFileSync(file, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") unreadable.add(file);
      return null;
    }
  };

  // I1 : seul `android/pronote/` parle Pronote ; le mot est interdit partout
  // ailleurs, sauf la déclaration de module de `settings.gradle.kts`.
  const PRONOTE_DIR = join(root, "android", "pronote") + "/";
  const i1 = androidFiles.filter((f) => {
    if (f.endsWith(".md")) return false; // docs légitimes ignorées
    if (f.startsWith(PRONOTE_DIR)) return false; // le module lui-même
    const raw = readCode(f);
    if (raw === null) return false; // illisible : signalé à part
    let code = raw;
    if (f.endsWith("settings.gradle.kts")) code = code.replace(/^include\(.*\)$/m, "");
    code = code
      .replace(/project\(":pronote"\)/g, "")
      .replace(/PronoteSession|PronoteClientProvider|PronoteAPIError|pronoteErrorCode/g, "")
      .replace(/fr\.veryslopnynotes\.pronote/g, "");
    return pronoteHost.test(code);
  });
  if (i1.length) fail.push(bloc("I1: android référence Pronote:", i1));

  // I2 : aucun accès réseau Pronote dans le serveur (il ne sert que le scraper de manuels).
  const directFetch = serverFiles.filter((f) => {
    const code = readCode(f);
    return code !== null && hasDirectFetch(code);
  });
  if (directFetch.length) fail.push(bloc("I2: accès réseau Pronote hors client:", directFetch));

  // I2 : la frontière réelle est déclarée dans Gradle ; une arête non déclarée
  // suffit à échouer.
  for (const erreur of moduleBoundaryErrors(root)) fail.push(erreur);

  // I2 surface : hors `android/pronote/`, aucun module n'implémente le
  // transport ; le module direct déclare UN SEUL `Client` (ADR-003).
  const transports: string[] = [];
  for (const mod of ["app", "core", "data"]) {
    for (const f of listFiles(join(root, "android", mod))) {
      if (!f.endsWith(".kt")) continue;
      const c = readCode(f);
      if (c !== null && /\b(HttpSession|CookieJar|ClientBase)\b/.test(c)) transports.push(f);
    }
  }
  if (transports.length) fail.push(bloc("I2: transport direct hors pronote:", transports));

  const clients = listFiles(join(root, "android", "pronote")).filter((f) => {
    const c = readCode(f);
    return c !== null && /^(?:open )?class Client\(/m.test(c);
  });
  if (clients.length !== 1) {
    fail.push(`I2: android/pronote doit déclarer UN SEUL Client (trouvé ${clients.length})`);
  }

  const i3 = androidCoreFiles.filter((f) => {
    const c = readCode(f);
    return c !== null && platformRe.test(c);
  });
  if (i3.length) fail.push(bloc("I3: android/core importe une plateforme interdite:", i3));

  // I5 + I4 : LLM sans outils/réseau/secrets (I6/I7 = tests Android + review).
  // `android/data/OpenRouterLlm.kt` est hors scan : seul appel fournisseur
  // autorisé, testé par android-homework.test.ts.
  const llmFiles = listFiles(join(root, "server/ai"));
  const ANDROID_AI = ["Untrusted.kt", "LlmGuard.kt", "AiPrompts.kt", "HomeworkAi.kt", "RevisionAi.kt", "Humanize.kt"].map(
    (f) => join(root, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core", f),
  );
  llmFiles.push(...ANDROID_AI);
  // Liste STATIQUE de fichiers IA : un fichier renommé ne doit pas rendre
  // I4/I5 vacuement vrais. Absent = invariant non vérifiable, donc ÉCHEC.
  const aiAbsents = ANDROID_AI.filter((f) => !existsSync(f));
  if (aiAbsents.length) {
    fail.push(bloc("I4/I5: fichier IA absent (invariant non vérifiable) :", aiAbsents));
  }
  const secretRe = /sk-or-v1-|OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/;
  const i4 = llmFiles.filter((f) => {
    const c = readCode(f);
    return c !== null && secretRe.test(c);
  });
  if (i4.length) fail.push(bloc("I4: secret dans IA:", i4));
  const i5 = llmFiles.filter((f) => {
    const c = readCode(f);
    if (c === null) return false;
    return (
      /tools\s*[:=]\s*\[[^\]]*[^\s\]]/.test(c) || // outils non-vides seuls ; [] vide autorisé
      /fetch\(|XMLHttpRequest|WebSocket|Bun\.serve/.test(c) ||
      /Bun\.env|process\.env/.test(c) ||
      secretRe.test(c)
    );
  });
  if (i5.length) fail.push(bloc("I5: LLM touche outils/réseau/secrets:", i5));

  // Un fichier illisible = invariant NON vérifié : signalé, pas compté comme
  // une violation.
  if (unreadable.size) {
    fail.push(bloc("fichiers illisibles (invariant non vérifiable) :", [...unreadable]));
  }

  // Rien à scanner = rien de vérifié : un répertoire renommé (ou une racine
  // vide) rendrait I1, I2 et I3 vacuement vrais.
  const vides = repertoiresManquants(root, ["android", "server"]);
  for (const v of vides) fail.push(v);
  // I3 porte sur `android/core/` : un module vide = invariant non vérifiable.
  const coreVide = repertoiresManquants(root, [join("android", "core")]);
  for (const v of coreVide) fail.push(`I3: ${v}`);

  return fail;
}

if (import.meta.main) {
  const fail = scanArchitecture();
  if (fail.length) {
    console.error("check-architecture FAIL:");
    for (const f of fail) console.error(" - " + f);
    process.exit(1);
  }
  console.log("check-architecture OK");
}
