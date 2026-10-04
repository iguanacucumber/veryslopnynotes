import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOMEWORK_MAX_API_KEY_CHARS,
  HOMEWORK_MAX_QUESTION_CHARS,
  HOMEWORK_MAX_SOURCE_CHARS,
  HOMEWORK_MAX_SOURCE_LABEL_CHARS,
  HOMEWORK_MAX_SOURCES,
  isHomeworkGenerateResponse,
} from "../../shared/contracts/api";

// Miroir des helpers Kotlin de l'assistant devoirs (0.7.0) — ils doivent rester
// en sync : core/Homework.kt, data/HomeworkRepository.kt, ui/HomeworkHelp.kt.
// org.json = SDK Android, le build Gradle n'est pas exécuté par `make check` :
// ces miroirs sont le seul filet sur la logique pure (bornes, citations, refus).

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
const DATA = join(import.meta.dir, "..", "..", "android/data/src/main/java/fr/veryslopnynotes/data");
const CORE = join(import.meta.dir, "..", "..", "android/core/src/main/java/fr/veryslopnynotes/core");

const src = (dir: string, file: string) => readFileSync(join(dir, file), "utf8");

// Mêmes FP que le scan I1 : commentaires ignorés.
function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .map((l) => {
      const idx = l.search(/(?<!:)\/\//);
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join("\n");
}

type Source = { label: string; text: string };
type Lesson = { title: string; excerpt: string };
type Item = {
  subject: string;
  title: string;
  description: string;
  lessonContent: Lesson | null;
};

const SYNTHETIC_KEY = "synthetic-llm-key-UNREAL";
const assignment: Item = {
  subject: "Mathématiques",
  title: "Dérivées",
  description: "Calculer f'(3) pour f(x)=x^2.",
  lessonContent: { title: "Chapitre 4", excerpt: "f'(x)=2x." },
};

// --- core/Homework.kt ---
function tsSourceValid(s: Source): boolean {
  const l = s.label.trim();
  const t = s.text.trim();
  return l.length > 0 && l.length <= HOMEWORK_MAX_SOURCE_LABEL_CHARS &&
    t.length > 0 && t.length <= HOMEWORK_MAX_SOURCE_CHARS;
}

function tsIsRequestValid(question: string, sources: Source[], apiKey: string): boolean {
  const q = question.trim();
  const key = apiKey.trim();
  if (q.length === 0 || q.length > HOMEWORK_MAX_QUESTION_CHARS) return false;
  if (key.length === 0 || key.length > HOMEWORK_MAX_API_KEY_CHARS) return false;
  if (sources.length === 0 || sources.length > HOMEWORK_MAX_SOURCES) return false;
  return sources.every(tsSourceValid);
}

function tsUniqueLabels(sources: Source[]): string[] {
  return [...new Set(sources.map((s) => s.label.trim()).filter((l) => l.length > 0))].slice(0, HOMEWORK_MAX_SOURCES);
}

// --- data/HomeworkRepository.kt ---
function capped(raw: string, max: number): string {
  const t = raw.trim();
  return t.length > max ? t.slice(0, max) : t;
}

function tsSourcesFor(a: Item): Source[] {
  const out: Source[] = [];
  if (a.description.trim().length > 0) {
    out.push({ label: "Consigne", text: capped(a.description, HOMEWORK_MAX_SOURCE_CHARS) });
  }
  const lc = a.lessonContent;
  if (lc && lc.excerpt.trim().length > 0) {
    const label = capped(`Cours : ${lc.title}`, HOMEWORK_MAX_SOURCE_LABEL_CHARS) || "Cours";
    out.push({ label, text: capped(lc.excerpt, HOMEWORK_MAX_SOURCE_CHARS) });
  }
  return out.filter(tsSourceValid).slice(0, HOMEWORK_MAX_SOURCES);
}

function tsQuestionFor(a: Item): string {
  const head = [a.subject, a.title].filter((s) => s.trim().length > 0).join(" — ");
  const body = a.description.trim().length === 0 ? "" : `\n${a.description}`;
  return capped(head + body, HOMEWORK_MAX_QUESTION_CHARS);
}

function strings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
}

type Outcome =
  | { status: "ok"; answer: string; steps: string[]; sources: string[] }
  | { status: "refused"; reason: string; sources: string[] };

function tsParse(body: unknown, allowedLabels: string[]): Outcome | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as Record<string, unknown>;
  if (r["status"] === "ok") {
    const answer = typeof r["answer"] === "string" ? r["answer"].trim() : "";
    const steps = strings(r["steps"]);
    const sources = strings(r["sources"]);
    if (answer.length === 0 || answer.length > 8000) return null;
    if (sources.length === 0) return null;
    // Citation hors étiquettes fournies = réponse inventée : on jette tout.
    if (!sources.every((s) => allowedLabels.includes(s))) return null;
    return { status: "ok", answer, steps, sources };
  }
  if (r["status"] === "refused") {
    const reason = typeof r["reason"] === "string" ? r["reason"].trim() : "";
    if (reason.length === 0) return null;
    return { status: "refused", reason, sources: strings(r["sources"]) };
  }
  return null;
}

describe("android homework — client de /v1/homework/generate (0.7.0)", () => {
  test("borne la requête comme le contrat serveur", () => {
    const sources = tsSourcesFor(assignment);
    expect(tsIsRequestValid(tsQuestionFor(assignment), sources, SYNTHETIC_KEY)).toBe(true);
    // Le serveur refuse (400) ce que l'app laisse dépasser : inutile de payer l'appel.
    expect(tsIsRequestValid("", sources, SYNTHETIC_KEY)).toBe(false);
    expect(tsIsRequestValid("q", sources, "")).toBe(false);
    expect(tsIsRequestValid("q", [], SYNTHETIC_KEY)).toBe(false);
    expect(tsIsRequestValid("q".repeat(HOMEWORK_MAX_QUESTION_CHARS + 1), sources, SYNTHETIC_KEY)).toBe(false);
    expect(tsIsRequestValid("q", sources, "k".repeat(HOMEWORK_MAX_API_KEY_CHARS + 1))).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, text: "t" }));
    expect(tsIsRequestValid("q", nine, SYNTHETIC_KEY)).toBe(false);
    expect(tsIsRequestValid("q", [{ label: "", text: "t" }], SYNTHETIC_KEY)).toBe(false);
    // Les bornes viennent du contrat, pas d'un copie-colle local.
    expect(HOMEWORK_MAX_API_KEY_CHARS).toBe(512);
  });

  test("sources = le devoir, jamais la pièce jointe (une ref n'a pas de texte)", () => {
    const sources = tsSourcesFor(assignment);
    expect(sources.map((s) => s.label)).toEqual(["Consigne", "Cours : Chapitre 4"]);
    // Zéro source = refus SANS appel modèle : l'écran doit pouvoir le dire.
    expect(tsSourcesFor({ subject: "S", title: "T", description: "", lessonContent: null })).toEqual([]);
    // Étiquettes distinctes même si l'enseignant titre son cours comme la consigne
    // (le préfixe "Cours : " évite la collision), et bornées à 200 caractères.
    const dupes = tsSourcesFor({ ...assignment, lessonContent: { title: "Consigne", excerpt: "x" } });
    expect(tsUniqueLabels(dupes)).toEqual(["Consigne", "Cours : Consigne"]);
    // `uniqueLabels` déduplique quand même : une citation ambiguë est pire qu'absente.
    expect(tsUniqueLabels([{ label: "L", text: "a" }, { label: " L ", text: "b" }])).toEqual(["L"]);
    const longLabel = tsSourcesFor({ ...assignment, lessonContent: { title: "T".repeat(400), excerpt: "x" } });
    expect(longLabel[1]?.label.length).toBe(HOMEWORK_MAX_SOURCE_LABEL_CHARS);
  });

  test("parse : ok sourcé, refus motivé, citation inventée rejetée", () => {
    const sources = tsSourcesFor(assignment);
    const labels = tsUniqueLabels(sources);
    const ok = tsParse(
      { status: "ok", answer: "f'(3)=6", steps: ["dériver", "évaluer"], sources: ["Consigne"] },
      labels,
    );
    expect(ok?.status).toBe("ok");
    // Cohérence avec le validateur du contrat partagé (le même JSON des deux côtés).
    expect(isHomeworkGenerateResponse({ status: "ok", answer: "f'(3)=6", steps: [], sources: ["Consigne"] })).toBe(true);
    expect(tsParse({ status: "ok", answer: "", steps: [], sources: ["Consigne"] }, labels)).toBeNull();
    expect(tsParse({ status: "ok", answer: "a", steps: [], sources: [] }, labels)).toBeNull();
    // Une source non fournie = citation inventée : rien ne s'affiche.
    expect(tsParse({ status: "ok", answer: "a", steps: [], sources: ["Manuel X"] }, labels)).toBeNull();
    expect(tsParse({ status: "refused", reason: "sources_insuffisantes", sources: [] }, labels)?.status).toBe(
      "refused",
    );
    expect(tsParse({ status: "refused", reason: "", sources: [] }, labels)).toBeNull();
    expect(tsParse({ status: "unknown" }, labels)).toBeNull();
    expect(tsParse(null, labels)).toBeNull();
  });
});

describe("android homework — le credential reste dans l'app", () => {
  test("la clé part dans le CORPS, jamais en URL ni en log", () => {
    const repo = stripComments(src(DATA, "HomeworkRepository.kt"));
    // Corps : c'est le seul endroit autorisé.
    expect(repo).toMatch(/\.put\("apiKey", apiKey\)/);
    expect(repo).toMatch(/buildPost\(ServerConfig\.homeworkGeneratePath\(\)/);
    // Aucune URL/query qui transporte la clé, aucun log.
    expect(repo).not.toMatch(/apiKey[^\n]*[?&]/);
    expect(repo).not.toMatch(/homeworkGenerateUrl/);
    expect(repo).not.toMatch(/Log\.|println|printStackTrace/);
    // Relue à CHAQUE appel (elle change quand l'utilisateur la réécrit) et jamais
    // mémorisée dans le dépôt : pas de champ `apiKey` ni de `var`.
    expect(repo).toMatch(/val apiKey = keys\.apiKey\(\)/);
    expect(repo).not.toMatch(/private val apiKey|var apiKey/);
    // Sans clé, pas d'appel : le serveur refuserait (400) l'aller-retour.
    expect(repo).toMatch(/if \(apiKey\.isNullOrEmpty\(\)\)/);
  });

  test("clé chiffrée au repos, jamais en prefs simples", () => {
    const store = stripComments(src(DATA, "LlmKeyStore.kt"));
    expect(store).toMatch(/encryptedPrefs\(context, PREFS\)/);
    // Un seul point de construction des prefs chiffrées (TokenStore + clé LLM).
    expect(store).not.toMatch(/getSharedPreferences/);
    expect(store).not.toMatch(/EncryptedSharedPreferences\.create/);
    const tokens = stripComments(src(DATA, "TokenStore.kt"));
    expect(tokens).toMatch(/internal fun encryptedPrefs\(context: Context, name: String\)/);
    // Bornes de credential + messages d'erreur sans la clé.
    expect(store).toMatch(/require\(secret\.length <= Homework\.MAX_API_KEY_CHARS\)/);
    expect(store).not.toMatch(/Log\.|println/);
    // Un store unique pour tout le process, comme le bearer.
    expect(store).toMatch(/object LlmKeys/);
    expect(store).toMatch(/@Volatile/);
  });

  test("le logout n'efface PAS la clé : c'est celle de l'utilisateur, pas une session", () => {
    const store = stripComments(src(DATA, "AccountStore.kt"));
    expect(store).toMatch(/fun logout\(\)[\s\S]*tokenStore\.clear\(\)/);
    // Le secret de session part, la clé LLM reste (elle n'est pas reconstructible
    // par le serveur : un ré-appairage ne doit pas coûter une nouvelle saisie).
    expect(store).not.toMatch(/llmKeys|LlmKeys|LlmKeyStore/);
  });

  test("l'écran n'affiche ni fournisseur ni clé, et n'exécute rien", () => {
    const help = stripComments(src(UI, "HomeworkHelp.kt"));
    // Contenu serveur = DONNÉE : Text() seul, jamais WebView/HTML (I6).
    expect(help).not.toMatch(/WebView|AndroidView|Html/);
    expect(help).not.toMatch(/sk-or-v1|openrouter/i);
    // La clé n'est ni affichée ni journalisée par l'écran.
    expect(help).not.toMatch(/apiKey/);
    // Pas de source affichée = pas d'envoi possible (le serveur refuserait sans appel).
    expect(help).toMatch(/Homework\.uniqueLabels\(sources\)/);
    expect(help).toMatch(/SOURCES_REQUIRED_MESSAGE/);
  });

  test("ServerConfig expose le chemin, et il n'est public QUE si la route l'est", () => {
    const config = stripComments(src(CORE, "ServerConfig.kt"));
    expect(config).toMatch(/const val HOMEWORK_GENERATE_PATH = "\/v1\/homework\/generate"/);
    const api = stripComments(src(DATA, "ApiClient.kt"));
    // Route protégée : le bearer d/device part avec, comme toute autre route.
    expect(api).not.toMatch(/HOMEWORK_GENERATE_PATH/);
  });

  test("l'écran Tâches expose le déclencheur et le dialogue, câblés par AppNav", () => {
    const assignments = stripComments(src(UI, "Assignments.kt"));
    // #161 : le déclencheur n'est plus le `Button` vert pleine largeur de
    // `HomeworkHelp.kt`, c'est une PUCE posée dans l'écran (dialogue inchangé).
    expect(assignments).toMatch(/HomeworkHelpChip \{ onHelp\(a\) \}/);
    expect(assignments).toMatch(/HomeworkHelpDialog\(/);
    // Pas de repository injecté = pas de bouton (pas d'état vide, pas de 400).
    expect(assignments).toMatch(/if \(helpRepo == null\) null else/);
    const nav = stripComments(src(UI, "AppNav.kt"));
    expect(nav).toMatch(/llmKeys = llmKeys/);
    expect(nav).toMatch(/onForgetLlmKey/);
  });
});