// API fiches révision v0 (issue #30, phase 10). Orchestration I7-safe :
// déclenchement sur ExamCandidate high (structuré) uniquement ; le texte
// modèle ne décide jamais du push (voir server/jobs/revision).
// Stockage mémoire = seed/tests ; adaptateur kv persistant via RevisionKv.

import { isRevisionSheet } from "../../shared/contracts/models";
import type { RevisionSheet } from "../../shared/contracts/models";
import type { ExamCandidate } from "../jobs/exams";
import {
  assembleRevisionSheet,
  listRevisionSheets,
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

// Assemble + mémorise (texte déjà validé côté pipeline phase 6/9).
export function createAndSaveRevision(
  store: RevisionListStore,
  exam: ExamCandidate,
  ficheText: string,
  sources: string[],
  now = new Date().toISOString(),
): RevisionSheet {
  const sheet = assembleRevisionSheet(exam, ficheText, sources, now);
  store.save(sheet);
  return sheet;
}

export async function persistRevisionSheet(kv: RevisionKv, sheet: RevisionSheet): Promise<void> {
  await saveRevisionSheet(kv, sheet);
}

export async function readRevisionSheet(kv: RevisionKv, id: string): Promise<RevisionSheet | null> {
  return loadRevisionSheet(kv, id);
}

export async function readAllRevisionSheets(kv: RevisionKv): Promise<RevisionSheet[]> {
  return listRevisionSheets(kv);
}
