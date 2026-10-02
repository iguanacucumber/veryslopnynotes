// Fiches révision — pipeline phase 6/9 (issue #30, phase 10).
// Contenu externe = Untrusted + nonce, déclaré donnée (I6).
// Sans outils, sans réseau, sans secrets (I4/I5). Stdlib uniquement.
// Déclenchement = structuré côté jobs (I7) ; ici seul remplissage validé.
// Sortie modèle = JSON {fiche} validé, sources citées côté jobs.
import { SYSTEM_REVISION, buildRevisionPrompt } from "./prompt";
import { generateGuardedJson } from "./guard";
import { markExternal } from "./untrusted";
import type { LLMProvider, Untrusted } from "../domain/ports";
import type { ExamCandidate } from "../jobs/exams";

export interface RevisionChunkLike {
  readonly text: string;
  readonly source: string;
}

export interface RevisionAnswer {
  readonly fiche: string;
}

function isNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function isRevisionAnswer(v: unknown): v is RevisionAnswer {
  if (typeof v !== "object" || v === null) return false;
  const f = (v as Record<string, unknown>)["fiche"];
  return isNonEmpty(f) && (f as string).length <= 8000;
}

export function parseRevisionAnswer(v: unknown): string {
  if (!isRevisionAnswer(v)) throw new Error("fiche JSON invalide (I5)");
  const t = (v.fiche as string).trim();
  if (!t) throw new Error("fiche vide (I5)");
  return t;
}

// Docs brutes -> marquées Untrusted ici, nonce côté prompt.
export function buildRevisionDocs(exam: ExamCandidate, chunks: RevisionChunkLike[]): string[] {
  const head = `Matiere : ${exam.subject}\nDate : ${exam.date}\nMotif : ${exam.matched}\nId examen : ${exam.id}`;
  const bodies = chunks.map((c) => `${c.source}\n${c.text}`);
  return [head, ...bodies];
}

export function revisionPromptFor(
  exam: ExamCandidate,
  chunks: RevisionChunkLike[],
  nonce?: string,
): { system: string; body: string; nonce: string } {
  // ponytail: réutilise gabarit phase 6, jamais de consigne ad hoc.
  const docs = buildRevisionDocs(exam, chunks);
  const data = docs.map(markExternal);
  void data;
  return buildRevisionPrompt(docs, nonce);
}

// Remplissage seul : appel modèle JSON validé. Choix push = jobs (structuré).
export async function requestRevisionFiche(
  provider: LLMProvider,
  exam: ExamCandidate,
  chunks: RevisionChunkLike[],
  nonce?: string,
): Promise<string> {
  const docs = buildRevisionDocs(exam, chunks);
  const data: Untrusted<string>[] = docs.map(markExternal);
  const parsed = await generateGuardedJson<unknown>(provider, SYSTEM_REVISION, data, nonce);
  return parseRevisionAnswer(parsed);
}
