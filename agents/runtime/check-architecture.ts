// check-architecture.ts — garde-fous I1/I2/I3/I5 (+I4 secrets LLM). I6/I7 = tests/review, pas scannables en regex.
// I1 android sans hôte Pronote — FP: .md ignorés, commentaires /* */ et // ignorés. ponytail: plafond regex, upgrade dependency-cruiser phase 1.
// I2 serveur sans client Pronote + frontière des modules lue dans les build.gradle.kts ; un seul Client Android.
// I3 android/core sans import plateforme interdit (java.net/android.database/androidx.room) — FP: block comments, javadoc *, imports multi-lignes ([^;]* couvre \n). ponytail: plafond regex, upgrade AST/dependency-cruiser.
// I4 secrets dans l'IA refusés (`server/ai/` supprimé en #210, reste `android/core/`) — commentaires ignorés. ponytail: doublon volontaire avec check-secrets, upgrade gitleaks.
// I5 LLM sans outils/réseau/secrets — FP: commentaires ignorés, tools: [] vide autorisé. ponytail: plafond regex sur android/core (`server/ai/` supprimé en #210), upgrade AST.
//
// #368 : le parcours ne mange plus les artefacts générés et ne se tait plus sur
// une erreur de lecture.
//   - `assets` (bundle Vite écrit par `web-build` dans
//     `android/app/src/main/assets/web/`) : artifact GITIGNORÉ, réécrit
//     pendant le scan — check.ts lance les étapes EN PARALLÈLE, donc le
//     verdict de I1 dépendait de l'ordre d'exécution (faux vert ou faux
//     rouge selon qui gagne la course). Une source, elle, ne bouge pas.
//   - erreurs : un `catch` global autour du parcours avalait TOUT le
//     répertoire (un fichier supprimé entre `readdir` et `stat` → rien
//     n'était scanné, verdict vert). Maintenant : erreur fichier par
//     fichier, on CONTINUE, et un fichier illisible est SIGNALÉ (invariant
//     non vérifiable ≠ invariant respecté).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { codeOnly, hasDirectFetch, platformRe, pronoteHost } from "./source-guards";

const ROOT = join(import.meta.dir, "..", "..");

/** Répertoires NON parcourus : outillage, caches, sorties de build.
 *  `node_modules`/`.git` = outillage ; `build`/`dist`/`.gradle` = sorties de
 *  build (Gradle écrit dans les dossiers `build` de chaque module pendant le
 *  scan). */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".gradle"]);

/** Artefact GÉNÉRÉ : le bundle Vite écrit par `web-build` dans
 *  `android/app/src/main/assets/web/` (gitignoré, réécrit à chaque build).
 *  On l'ignore PAR CHEMIN (`src` puis `main` puis `assets`), pas par nom de
 *  dossier : les sources de l'interface sont dans `web/src` (scannées par
 *  `tests/architecture/web.test.ts`), le bundle n'en est qu'une copie
 *  générée — le laisser dans le scan rendait le verdict de I1 dépendant de
 *  l'ordre d'exécution des étapes. */
const GENERATED_SUFFIX = ["src", "main", "assets"];

/** Le chemin finit-il par `src`, `main`, `assets` ? */
function isGenerated(path: string): boolean {
  const parts = path.split(sep);
  return GENERATED_SUFFIX.every((seg, i) => parts[parts.length - GENERATED_SUFFIX.length + i] === seg);
}

/** Fichiers du parcours, sous `dir`.
 *
 *  Les entrées sont triées (parcours déterministe, verdict reproductible) et
 *  chaque entrée est traitée POUR ELLE : un `stat` qui échoue (fichier
 *  supprimé entre `readdir` et `stat`, lien mort) ne doit pas faire
 *  abandonner le reste du répertoire — avant, le `catch` global perdait le
 *  répertoire entier, en silence, donc en vert. */
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
 * Un répertoire scanné doit EXISTER et contenir des fichiers.
 *
 * #532 : les scanners passaient au VERT quand ils n'avaient rien à scanner.
 * `listFiles` renvoyait une liste VIDE pour un répertoire absent (renommé,
 * déplacé), donc I1, I2 et I3 devenaient **vacuement vrais** : chaque
 * étape du gate annonçait « OK » sans avoir rien vérifié. Un invariant non
 * vérifiable n'est pas un invariant respecté — donc c'est un ÉCHEC, bruyant.
 *
 * `root` = racine du dépôt. `sousDossiers` = ce que cet invariant exige
 * d'avoir trouvé. Un répertoire absent est distingué d'un répertoire vide :
 * les deux sont des échecs, mais le message doit nommer la cause.
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
 *  dans Gradle, pas dans une liste de types. `core` et `pronote` restent purs
 *  (aucun bloc `dependencies`) ; `data` consomme le port, `app` l'interface. */
export const MODULE_EDGES: Readonly<Record<string, readonly string[]>> = {
  core: [],
  pronote: [],
  data: ["core", "pronote"],
  app: ["core", "data"],
};

/** Modules référencés par `project(":x")` dans un build.gradle.kts (commentaires
 *  retirés : une arête commentée n'existe pas). */
export function gradleProjectDeps(source: string): string[] {
  return [...codeOnly(source).matchAll(/project\(\s*["']:([\w.-]+)["']\s*\)/g)].map((m) => m[1]!);
}

/** Erreurs de frontière lues dans les quatre fichiers `build.gradle.kts`.
 *  Une arête non déclarée est un échec ; un module absent aussi (invariant
 *  non vérifiable). */
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

/** Scan des invariants. `root` = racine du dépôt (surchargeable pour les
 *  tests : un fixture temporaire). */
export function scanArchitecture(root: string = ROOT): string[] {
  const androidFiles = listFiles(join(root, "android"));
  const androidCoreFiles = listFiles(join(root, "android", "core"));
  const serverFiles = listFiles(join(root, "server"));

  const fail: string[] = [];
  /** Fichiers illisibles : l'invariant ne peut pas être vérifié dessus, donc
   *  ce n'est PAS un « respecté ». Ils sont signalés, pas avalés. */
  const unreadable = new Set<string>();

  /** Source sans commentaires, ou null si le fichier n'a pas pu être lu.
   *  ENOENT = le fichier n'existe (plus) : rien à vérifier, on passe. Autre
   *  erreur (droits, EIO) = l'invariant n'est PAS vérifiable → signalé. */
  const readCode = (file: string): string | null => {
    try {
      return codeOnly(readFileSync(file, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") unreadable.add(file);
      return null;
    }
  };

  // I1 : Android sans URL/hôte Pronote — repointé #200 puis #205 : seul
  // `android/pronote/` parle Pronote en direct (module du port) ; depuis #205,
  // `data`/`ui` manipulent les TYPES du client local (dépendance
  // `project(":pronote")`, ADR-003) — câblage sanctionné, pas un hôte. Le mot
  // reste interdit partout ailleurs ; `settings.gradle.kts` ne le porte que
  // dans sa déclaration de module. La prose (INVARIANTS, AGENTS.md) suit en #211.
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
  if (i1.length) fail.push(`I1: android référence Pronote: ${i1.join(", ")}`);

  // I2 : aucun accès réseau Pronote dans le serveur (il ne sert que le scraper de manuels).
  const directFetch = serverFiles.filter((f) => {
    const code = readCode(f);
    return code !== null && hasDirectFetch(code);
  });
  if (directFetch.length) fail.push(`I2: accès réseau Pronote hors client: ${directFetch.join(", ")}`);

  // I2 : la frontière réelle est déclarée dans Gradle. Le scan de source ne
  // recopie plus les types du port : une arête non déclarée suffit à échouer.
  for (const erreur of moduleBoundaryErrors(root)) fail.push(erreur);

  // I2 surface : hors `android/pronote/`, aucun module n'implémente le
  // transport (le port expose `Client`, ses types et ses erreurs) ; le module
  // direct déclare UN SEUL `Client` (ADR-003).
  const transports: string[] = [];
  for (const mod of ["app", "core", "data"]) {
    for (const f of listFiles(join(root, "android", mod))) {
      if (!f.endsWith(".kt")) continue;
      const c = readCode(f);
      if (c !== null && /\b(HttpSession|CookieJar|ClientBase)\b/.test(c)) transports.push(f);
    }
  }
  if (transports.length) fail.push(`I2: transport direct hors pronote: ${transports.join(", ")}`);

  const clients = listFiles(join(root, "android", "pronote")).filter((f) => {
    const c = readCode(f);
    return c !== null && /^(?:open )?class Client\(/m.test(c);
  });
  if (clients.length !== 1) {
    fail.push(`I2: android/pronote doit déclarer UN SEUL Client (trouvé ${clients.length})`);
  }

  // I3 : android/core sans import de plateforme que Gradle ne voit pas.
  const i3 = androidCoreFiles.filter((f) => {
    const c = readCode(f);
    return c !== null && platformRe.test(c);
  });
  if (i3.length) fail.push(`I3: android/core importe une plateforme interdite: ${i3.join(", ")}`);

  // I5 + I4 : LLM sans outils/réseau/secrets (I6/I7 non scannables ici — voir miroirs unitaires Android + review).
  // Port #204 : l'IA vit dans `android/core/`; `server/ai/` a été supprimé en #210.
  // `android/data/OpenRouterLlm.kt` est hors scan : seul appel fournisseur autorisé, testé par android-homework.test.ts.
  const llmFiles = listFiles(join(root, "server/ai"));
  const ANDROID_AI = ["Untrusted.kt", "LlmGuard.kt", "AiPrompts.kt", "HomeworkAi.kt", "RevisionAi.kt", "Humanize.kt"].map(
    (f) => join(root, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core", f),
  );
  llmFiles.push(...ANDROID_AI);
  // Liste STATIQUE de fichiers IA : un fichier renommé ne doit pas rendre
  // I4/I5 vacuement vrais. Absent = invariant non vérifiable, donc ÉCHEC.
  const aiAbsents = ANDROID_AI.filter((f) => !existsSync(f));
  if (aiAbsents.length) {
    fail.push(`I4/I5: fichier IA absent (invariant non vérifiable) : ${aiAbsents.join(", ")}`);
  }
  const secretRe = /sk-or-v1-|OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/;
  const i4 = llmFiles.filter((f) => {
    const c = readCode(f);
    return c !== null && secretRe.test(c);
  });
  if (i4.length) fail.push(`I4: secret dans IA: ${i4.join(", ")}`);
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
  if (i5.length) fail.push(`I5: LLM touche outils/réseau/secrets: ${i5.join(", ")}`);

  // Un fichier illisible = invariant NON vérifié : on le dit (faux vert
  // interdit), on ne le compte pas comme une violation d'invariant.
  if (unreadable.size) {
    fail.push(`fichiers illisibles (invariant non vérifiable) : ${[...unreadable].join(", ")}`);
  }

  // #532 : rien à scanner = rien de vérifié. Un répertoire renommé (ou une
  // racine vide) rendait I1, I2 et I3 vacuement vrais : le gate annonçait
  // « OK » sans avoir lu une seule ligne.
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
