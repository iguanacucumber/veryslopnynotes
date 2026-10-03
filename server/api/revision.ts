// API fiches révision v0 (issue #30, phase 10). Orchestration I7-safe :
// déclenchement sur ExamCandidate high (structuré) uniquement ; le texte
// modèle ne décide jamais du push (voir server/jobs/revision).
// Stockage mémoire = seed/tests ; adaptateur kv persistant via RevisionKv.

import { localDay } from "../../shared/contracts/api";
import { isRevisionSheet } from "../../shared/contracts/models";
import type { RevisionSheet } from "../../shared/contracts/models";
import type { ExamCandidate } from "../jobs/exams";
import {
  assembleRevisionSheet,
  loadRevisionSheet,
  saveRevisionSheet,
} from "../jobs/revision";
import type { RevisionKv } from "../jobs/revision";

export interface RevisionListStore {
  list(): RevisionSheet[];
  get(id: string): RevisionSheet | undefined;
  save(sheet: RevisionSheet): void;
}

export function createRevisionMemoryStore(seed: RevisionSheet[] = []): RevisionListStore {
  const map = new Map<string, RevisionSheet>();
  for (const s of seed) if (isRevisionSheet(s)) map.set(s.id, structuredClone(s));
  return {
    list: () => [...map.values()].map((s) => structuredClone(s)),
    get: (id: string) => {
      const v = map.get(id);
      return v ? structuredClone(v) : undefined;
    },
    save: (sheet: RevisionSheet) => {
      if (!isRevisionSheet(sheet)) throw new Error("fiche invalide (contrat)");
      map.set(sheet.id, structuredClone(sheet));
    },
  };
}

// Déclencheurs auto : high seuls. needs_confirm = retour app, zéro effet.
export function selectRevisionTriggers(exams: ExamCandidate[]): ExamCandidate[] {
  return exams.filter((e) => e?.confidence === "high");
}

/** Titre retitré au jour local (helper `localDay`) : l'assemblage tronque
 *  l'ISO en UTC, donc un DS du 15 à 00h30 locales y serait daté du 14. */
function localDayTitle(title: string, isoDate: string): string {
  const jourUtc = isoDate.slice(0, 10);
  const jourLocal = localDay(isoDate);
  return jourLocal === jourUtc ? title : title.replace(jourUtc, jourLocal);
}

// Assemble + mémorise (texte déjà validé côté pipeline phase 6/9).
export function createAndSaveRevision(
  store: RevisionListStore,
  exam: ExamCandidate,
  ficheText: string,
  sources: string[],
  now = new Date().toISOString(),
): RevisionSheet {
  const assembled = assembleRevisionSheet(exam, ficheText, sources, now);
  const sheet: RevisionSheet = { ...assembled, title: localDayTitle(assembled.title, exam.date) };
  store.save(sheet);
  return sheet;
}

// Journal APPEND-ONLY des ids écrits : un index réécrit « à vide » (JSON
// illisible : écriture partielle, quota) faisait disparaître des fiches
// toujours présentes dans le kv. `reconcileIndex` ré-unionne les deux listes,
// donc l'index peut être réparé sans jamais perdre un id.
const INDEX_KEY = "revision:index";
const INDEX_JOURNAL_KEY = "revision:index:journal";
const enc = new TextEncoder();
const dec = new TextDecoder();

/** ids d'un index : `[]` si absent, `null` si ILLISIBLE (à ne pas écraser). */
async function readIdIndex(kv: RevisionKv, key: string): Promise<string[] | null> {
  const raw = await kv.get(key);
  if (!raw) return [];
  try {
    const v = JSON.parse(dec.decode(raw)) as unknown;
    if (!Array.isArray(v)) return null;
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

async function reconcileIndex(kv: RevisionKv): Promise<void> {
  const journal = (await readIdIndex(kv, INDEX_JOURNAL_KEY)) ?? [];
  const index = (await readIdIndex(kv, INDEX_KEY)) ?? [];
  const ids = [...new Set([...journal, ...index])].sort();
  const encoded = enc.encode(JSON.stringify(ids));
  await kv.set(INDEX_KEY, encoded);
  // Le journal ne perd jamais d'id : union des deux, il ne fait que grossir.
  if (ids.length > journal.length) await kv.set(INDEX_JOURNAL_KEY, encoded);
}

export async function persistRevisionSheet(kv: RevisionKv, sheet: RevisionSheet): Promise<void> {
  await saveRevisionSheet(kv, sheet);
  await reconcileIndex(kv);
}

export async function readRevisionSheet(kv: RevisionKv, id: string): Promise<RevisionSheet | null> {
  return loadRevisionSheet(kv, id);
}

export async function readAllRevisionSheets(kv: RevisionKv): Promise<RevisionSheet[]> {
  // Index illisible = secours sur le journal, jamais une liste vide muette :
  // les fiches existent dans le kv, l'API ne doit pas mentir sur le stock.
  const ids = (await readIdIndex(kv, INDEX_KEY)) ?? (await readIdIndex(kv, INDEX_JOURNAL_KEY)) ?? [];
  const out: RevisionSheet[] = [];
  for (const id of ids) {
    const sheet = await loadRevisionSheet(kv, id);
    if (sheet) out.push(sheet);
  }
  return out;
}
