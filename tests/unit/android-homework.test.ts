import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOMEWORK_MAX_ANSWER_CHARS,
  HOMEWORK_MAX_API_KEY_CHARS,
  HOMEWORK_MAX_QUESTION_CHARS,
  HOMEWORK_MAX_SOURCE_CHARS,
  HOMEWORK_MAX_SOURCE_LABEL_CHARS,
  HOMEWORK_MAX_SOURCES,
  isHomeworkGenerateResponse,
} from "../../shared/contracts/api";
import { codeOnly } from "../../agents/runtime/source-guards";
import { readBridgeSource } from "./fixtures/bridge-source";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

// Miroir des helpers Kotlin de l'assistant devoirs (0.7.0) — ils doivent rester
// en sync : core/Homework.kt, data/HomeworkRepository.kt. Le pont WebView
// (`VsnBridge`) expose la même surface à l'UI React.
// org.json = SDK Android, le build Gradle n'est pas exécuté par `make check` :
// ces miroirs sont le seul filet sur la logique pure (bornes, citations, refus).

const DATA = join(import.meta.dir, "..", "..", "android/data/src/main/java/fr/veryslopnynotes/data");

// VRAI Kotlin exécuté : `core/HomeworkAi.kt` est compilé par le harnais et
// piloté par `agents/runtime/kotlin-parity/LlmBudgetMain.kt` (op `homework`).
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "LlmBudgetMain.kt");
const skip = parityToolchain.skipReason !== null;
let link: ParityLink | null = null;
if (!skip) link = await parityToolchain.openParityLink(DRIVER);

const src = (dir: string, file: string) => readFileSync(join(dir, file), "utf8");

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

// Miroir de `canonicalCitedLabel` (core/AiPrompts.kt) : espaces de bord, puis
// UN préambule « Libelle citable : », casse et espaces internes libres. Le
// libellé lui-même reste comparé à l'identique.
const CITABLE_PREAMBLE = /^Libelle\s+citable\s*:\s*/i;

function tsCanonicalCitedLabel(cited: string, allowedLabels: string[]): string | null {
  const trimmed = cited.trim();
  if (trimmed.length === 0) return null;
  if (allowedLabels.includes(trimmed)) return trimmed;
  const match = CITABLE_PREAMBLE.exec(trimmed);
  if (!match) return trimmed;
  const label = trimmed.slice(match[0].length).trim();
  return label.length === 0 ? null : label;
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
    const raw = strings(r["sources"]);
    if (answer.length === 0 || answer.length > HOMEWORK_MAX_ANSWER_CHARS) return null;
    if (raw.length === 0) return null;
    const sources: string[] = [];
    for (const cited of raw) {
      const label = tsCanonicalCitedLabel(cited, allowedLabels);
      // Citation vide, réduite au préambule, ou hors étiquettes = réponse
      // inventée : on jette tout.
      if (label === null || !allowedLabels.includes(label)) return null;
      sources.push(label);
    }
    return { status: "ok", answer, steps, sources };
  }
  if (r["status"] === "refused") {
    const reason = typeof r["reason"] === "string" ? r["reason"].trim() : "";
    if (reason.length === 0) return null;
    const cited = strings(r["sources"]);
    const sources: string[] = [];
    for (const item of cited) {
      const label = tsCanonicalCitedLabel(item, allowedLabels);
      if (label === null) return null;
      sources.push(label);
    }
    return { status: "refused", reason, sources };
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

  test("parse : le préambule « Libelle citable : » est retiré avant comparaison", () => {
    const labels = tsUniqueLabels(tsSourcesFor(assignment));
    const exact = tsParse({ status: "ok", answer: "a", steps: [], sources: ["Consigne"] }, labels);
    expect(exact?.status).toBe("ok");
    const prefixed = tsParse(
      { status: "ok", answer: "a", steps: [], sources: ["  Libelle  citable: Cours : Chapitre 4  "] },
      labels,
    );
    expect(prefixed).toEqual({ status: "ok", answer: "a", steps: [], sources: ["Cours : Chapitre 4"] });
    // Le libellé reste comparé tel quel : casse et accents ne sont pas repliés.
    expect(
      tsParse({ status: "ok", answer: "a", steps: [], sources: ["Libelle citable : cours : chapitre 4"] }, labels),
    ).toBeNull();
    // Préambule seul ou citation vide : jamais un libellé accepté par accident.
    expect(tsParse({ status: "ok", answer: "a", steps: [], sources: ["Libelle citable :"] }, labels)).toBeNull();
    expect(tsParse({ status: "ok", answer: "a", steps: [], sources: [" "] }, labels)).toBeNull();
  });
});

type HomeworkParse = {
  ok?: boolean;
  status?: string;
  cited?: string[];
  error?: string;
  message?: string;
};

async function parseHomework(body: unknown, labels: string[]): Promise<HomeworkParse> {
  return JSON.parse(
    await link!.ask({ op: "homework", raw: JSON.stringify(body), labels }, { allowError: true }),
  ) as HomeworkParse;
}

describe("android homework — citations préfixées (vrai Kotlin)", () => {
  const LABELS = ["Consigne", "Cours : Mitose"];

  test.skipIf(skip)("une citation préfixée est ramenée au libellé fourni", async () => {
    const r = await parseHomework({
      status: "ok",
      answer: "La mitose se déroule en quatre phases.",
      steps: ["lire le cours"],
      sources: [" Libelle  citable: Cours : Mitose "],
    }, LABELS);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("ok");
    expect(r.cited).toEqual(["Cours : Mitose"]);
  });

  test.skipIf(skip)("une citation exacte reste acceptée", async () => {
    const r = await parseHomework({
      status: "ok",
      answer: "La mitose se déroule en quatre phases.",
      steps: ["lire le cours"],
      sources: ["Cours : Mitose"],
    }, LABELS);
    expect(r.ok).toBe(true);
    expect(r.cited).toEqual(["Cours : Mitose"]);
  });

  test.skipIf(skip)("un libellé inconnu reste rejeté, préfixe ou pas", async () => {
    for (const sources of [["Cours : Autre"], ["Libelle citable : Cours : Autre"]]) {
      const r = await parseHomework(
        { status: "ok", answer: "a", steps: [], sources },
        LABELS,
      );
      expect({ sources, ok: r.ok, message: r.message }).toEqual({
        sources,
        ok: false,
        message: "réponse devoirs invalide (source non fournie)",
      });
    }
  });

  test.skipIf(skip)("un préambule seul ou une citation vide est rejeté", async () => {
    for (const sources of [["Libelle citable :"], ["Libelle citable :   "], [""]]) {
      const r = await parseHomework({ status: "ok", answer: "a", steps: [], sources }, LABELS);
      expect({ sources, ok: r.ok }).toEqual({ sources, ok: false });
      expect(r.message).toContain("schéma");
    }
  });

  test.skipIf(skip)("le refus applique la même normalisation", async () => {
    const prefixed = await parseHomework({
      status: "refused",
      reason: "sources_insuffisantes",
      sources: ["libelle citable : Consigne"],
    }, LABELS);
    expect(prefixed.ok).toBe(true);
    expect(prefixed.status).toBe("refused");
    expect(prefixed.cited).toEqual(["Consigne"]);
    const empty = await parseHomework({
      status: "refused",
      reason: "sources_insuffisantes",
      sources: ["Libelle citable :"],
    }, LABELS);
    expect(empty.ok).toBe(false);
  });
});

describe("android homework — le credential reste dans l'app", () => {
  test("la clé part en en-tête Bearer direct fournisseur, jamais en URL ni en log", () => {
    // #205 : plus de route serveur (`POST /v1/homework/generate` morte) — la
    // génération passe par `OpenRouterHomework` + `OpenRouterLlm` direct.
    const hw = codeOnly(src(DATA, "OpenRouterLlm.kt"));
    // Clé relue du store à CHAQUE appel, jamais mémorisée : pas de champ.
    expect(hw).toMatch(/val apiKey = keys\.apiKey\(\)/);
    expect(hw).not.toMatch(/private val apiKey|var apiKey/);
    // Sans clé, pas d'appel.
    expect(hw).toMatch(/if \(apiKey\.isNullOrEmpty\(\)\)/);
    // Seule interpolation de la clé de tout le fichier : l'en-tête Bearer.
    expect(hw).toMatch(/\.header\("Authorization", "Bearer \$key"\)/);
    // Aucune clé dans une URL/query : les `?` du fichier sont des types
    // nullables (`apiKey: String?`), jamais une query — donc on exige
    // l'absence de `?`/`&` APRES un usage de la clé sur la même ligne.
    expect(hw).not.toMatch(/\$key[^\n]*[?&]|\?[^:\n]*apiKey|=.*\?.*apiKey/);
    expect(hw).not.toMatch(/Log\.|println|printStackTrace/);
    // Client NU (jamais api.client()) : un 401 fournisseur n'invalide jamais
    // la session d'appareil.
    expect(hw).toMatch(/client: OkHttpClient = OkHttpClient\(\)/);
    expect(hw).not.toMatch(/api\.client\(\)/);
    expect(hw).not.toMatch(/DeviceAuth/);
    // HomeworkRepository ne garde que les contrats partagés (question,
    // sources, parse) : aucune génération, aucun HTTP.
    const repo = codeOnly(src(DATA, "HomeworkRepository.kt"));
    expect(repo).not.toMatch(/buildPost|OkHttp|newCall|ServerConfig/);
    expect(repo).toMatch(/fun sourcesFor/);
    expect(repo).toMatch(/fun questionFor/);
    expect(repo).toMatch(/fun parse/);
  });

  test("clé chiffrée au repos, jamais en prefs simples", () => {
    const store = codeOnly(src(DATA, "LlmKeyStore.kt"));
    expect(store).toMatch(/encryptedPrefs\(context, PREFS\)/);
    // Un seul point de construction des prefs chiffrées (session + clé LLM).
    expect(store).not.toMatch(/getSharedPreferences/);
    expect(store).not.toMatch(/EncryptedSharedPreferences\.create/);
    const sessions = codeOnly(src(DATA, "SessionStore.kt"));
    expect(sessions).toMatch(/internal fun encryptedPrefs\(context: Context, name: String\)/);
    // #206 : plus de repli en clair — un Keystore KO jette, il n'écrit pas.
    expect(sessions).not.toMatch(/MODE_PRIVATE/);
    // Bornes de credential + messages d'erreur sans la clé. Depuis #749 le
    // contrat et sa validation vivent dans un fichier PUR (exécuté par la
    // parité) : une seule définition des bornes, jamais deux copies.
    const policy = codeOnly(src(DATA, "LlmKeyFallback.kt"));
    expect(policy).toMatch(/require\(isValidLlmKey\(secret\)\)/);
    expect(policy).toContain("Homework.MAX_API_KEY_CHARS");
    expect(store).not.toMatch(/Log\.|println/);
    expect(policy).not.toMatch(/Log\.|println/);
    // Un store unique pour tout le process, comme la session.
    expect(store).toMatch(/object LlmKeys/);
    expect(store).toMatch(/@Volatile/);
  });

  test("le logout n'efface PAS la clé : c'est celle de l'utilisateur, pas une session", () => {
    const store = codeOnly(src(DATA, "AccountStore.kt"));
    expect(store).toMatch(/fun logout\(\)[\s\S]*sessions\.clear\(\)/);
    // Le secret de session part, la clé LLM reste (elle n'est pas reconstructible
    // par le serveur : un ré-appairage ne doit pas coûter une nouvelle saisie).
    expect(store).not.toMatch(/llmKeys|LlmKeys|LlmKeyStore/);
  });

  test("l'aide texte porte le délai du pont (#594), comme les chemins photo", () => {
    const bridge = codeOnly(readBridgeSource());
    // Le défaut OkHttp (20 s) tuait un modèle lent alors que le pont attend
    // AWAIT_LLM_MS (45 s) : le constructeur porte désormais ce délai.
    expect(bridge).toMatch(/OpenRouterHomework\(OpenRouterLlm\(timeoutMs = AWAIT_LLM_MS\), llmKeys\)/);
    // Les trois chemins LLM sont alignés : la photo l'était déjà (#588).
    expect(bridge).toMatch(/provider = OpenRouterLlm\(timeoutMs = AWAIT_LLM_MS\)/);
  });

  test("la clé enregistrée est bornée à l'ASCII imprimable (#595)", () => {
    const bridge = codeOnly(readBridgeSource());
    // OkHttp refuse tout caractère hors 0x20..0x7E dans un en-tête : une clé
    // collée avec NBSP (invisible, et isWhitespace ne le voit PAS) ou une
    // lettre accentuée passait l'ancien filtre puis cassait CHAQUE appel.
    expect(bridge).toMatch(/it\.isISOControl\(\) \|\| it\.isWhitespace\(\) \|\| it > '~'/);
  });

  test("un en-tête refusé par OkHttp nomme la clé, pas « réseau » (#595)", () => {
    const llm = codeOnly(src(DATA, "OpenRouterLlm.kt"));
    // Le build de la requête est DANS le try : l'IAE du validateur d'en-tête
    // est interceptée au lieu de s'échapper vers le repli générique.
    // (lastIndexOf : LlmError, plus haut dans le fichier, a SON companion.)
    const send = llm.slice(llm.indexOf("private fun send"), llm.lastIndexOf("companion object"));
    expect(send).toContain("try");
    expect(send.indexOf("try")).toBeLessThan(send.indexOf("Request.Builder()"));
    expect(llm).toContain("Clé LLM invalide : corrige-la dans Réglages.");
  });
});
