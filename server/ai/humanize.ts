// Humanize devoirs : VALIDATE -> RENDER avec gabarit versionné (issue #28, phase 9).
// Contenu = donnée, jamais instruction (I6/I7) : RENDER pur, sans eval,
// sans Function, sans exécution du contenu, sans réseau/outils/secrets (I4/I5).
// Version gabarit stockée par corrigé -> reproductibilité (FEATURES.md).
// Voir docs/security/PIPELINE.md (GENERATE -> VALIDATE -> RENDER),
// docs/architecture/INVARIANTS.md (I4/I5/I6/I7), server/ai/guard.ts (I4/I5).
import { markExternal } from "./untrusted";
import type { StorageProvider, Untrusted } from "../domain/ports";

// ponytail: version en constante, jamais depuis externe. Upgrade: registre v2 si gabarit évolue.
export const HUMANIZE_TEMPLATE_VERSION = "humanize-v1" as const;
export const HUMANIZE_TEMPLATE_HISTORY: readonly string[] = [HUMANIZE_TEMPLATE_VERSION] as const;

export const MAX_CORRIGE_CHARS = 8000;
const MAX_SOURCES = 20;
const MAX_SOURCE_CHARS = 500;

export interface ValidatedCorrige {
  readonly answer: string;
  readonly sources: readonly string[];
}

export interface RenderedCorrige {
  readonly text: string;
  readonly templateVersion: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// VALIDATE : JSON déjà parsé -> corrigé typé. Rejette vide/trop long/sources invalides.
// Refus propre (#27) : appelant refuse avant si sources insuffisantes ; ici sources
// vides autorisées (rendu "aucune") pour rester pur et reproductible.
export function validateCorrigeForRender(input: unknown): ValidatedCorrige {
  if (!isRecord(input)) throw new Error("corrigé invalide (VALIDATE)");
  const { answer, sources } = input;
  if (!isNonEmptyString(answer)) throw new Error("corrigé invalide : answer vide (VALIDATE)");
  if (answer.length > MAX_CORRIGE_CHARS) throw new Error("corrigé trop long (VALIDATE)");
  const src: readonly unknown[] = Array.isArray(sources) ? sources : [];
  if (src.length > MAX_SOURCES) throw new Error("corrigé invalide : trop de sources (VALIDATE)");
  const clean: string[] = [];
  for (const s of src) {
    if (!isNonEmptyString(s)) throw new Error("corrigé invalide : source vide (VALIDATE)");
    if ((s as string).length > MAX_SOURCE_CHARS)
      throw new Error("corrigé invalide : source trop longue (VALIDATE)");
    clean.push((s as string).trim());
  }
  return { answer: (answer as string).trim(), sources: clean };
}

// I6 : corrigé validé re-marqué donnée avant tout usage IA/affichage.
// Utilise buildSafePrompt côté appelant ; ici marquage seul (server/ai/untrusted).
export function markCorrigeForHumanize(corrige: ValidatedCorrige): Untrusted<string>[] {
  return [markExternal(corrige.answer), ...corrige.sources.map((s) => markExternal(s))];
}

// RENDER pur (I7) : gabarit fixe, contenu inséré littéralement.
// Aucune interpolation du contenu comme gabarit : `answer`/`sources` ne sont
// jamais évalués (pas de eval/Function/replace à pattern sur contenu).
// Consommateur doit afficher `text` comme texte brut, jamais comme HTML/code.
function renderV1(corrige: ValidatedCorrige): string {
  const head = "Corrigé (gabarit humanize-v1)";
  const srcBlock =
    corrige.sources.length === 0
      ? "Sources : aucune (corpus vide)."
      : `Sources :\n${corrige.sources.map((s) => `- ${s}`).join("\n")}`;
  return `${head}\n\n${corrige.answer}\n\n${srcBlock}`;
}

const RENDERERS: Record<string, (c: ValidatedCorrige) => string> = {
  [HUMANIZE_TEMPLATE_VERSION]: renderV1,
};

export function listTemplateVersions(): string[] {
  return [...HUMANIZE_TEMPLATE_HISTORY];
}

// templateVersion omis = courant. Version inconnue = rejet (reproductibilité stricte).
// Même entrée + même version = même sortie (déterministe, sans aléatoire/date).
export function renderCorrige(
  corrige: ValidatedCorrige,
  templateVersion: string = HUMANIZE_TEMPLATE_VERSION,
): RenderedCorrige {
  const fn = RENDERERS[templateVersion];
  if (!fn) throw new Error(`gabarit inconnu : ${templateVersion}`);
  return { text: fn(corrige), templateVersion };
}

// VALIDATE -> RENDER en un appel (entrée = JSON parsé, ex. sortie GENERATE #27).
export function humanizeCorrige(input: unknown, templateVersion?: string): RenderedCorrige {
  return renderCorrige(validateCorrigeForRender(input), templateVersion);
}

const CORRIGE_PREFIX = "homework:corrige:";
const enc = new TextEncoder();
const dec = new TextDecoder();

function corrigeKey(id: string): string {
  if (!isNonEmptyString(id) || id.length > 200 || /[\s]/.test(id))
    throw new Error("id corrigé invalide");
  return `${CORRIGE_PREFIX}${id.trim()}`;
}

// Version stockée par corrigé : JSON {text, templateVersion} via StorageProvider (phase 3, kv).
export async function saveRenderedCorrige(
  store: StorageProvider,
  id: string,
  rendered: RenderedCorrige,
): Promise<void> {
  if (!isNonEmptyString(rendered.text)) throw new Error("rendu vide");
  if (!RENDERERS[rendered.templateVersion]) throw new Error(`gabarit inconnu : ${rendered.templateVersion}`);
  await store.set(corrigeKey(id), enc.encode(JSON.stringify(rendered)));
}

export async function loadRenderedCorrige(
  store: StorageProvider,
  id: string,
): Promise<RenderedCorrige | null> {
  const raw = await store.get(corrigeKey(id));
  if (!raw) return null;
  try {
    const v = JSON.parse(dec.decode(raw)) as unknown;
    if (!isRecord(v)) return null;
    if (!isNonEmptyString(v["text"]) || typeof v["templateVersion"] !== "string") return null;
    if (!RENDERERS[v["templateVersion"] as string]) return null;
    return { text: v["text"] as string, templateVersion: v["templateVersion"] as string };
  } catch {
    return null;
  }
}
