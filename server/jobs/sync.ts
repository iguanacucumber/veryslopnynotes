// Jobs v0 — moteur de sync périodique (issue #16, phase 5). Ports locaux à
// server/jobs/ : n'importent ni server/domain/ ni server/infrastructure/
// (autres agents actifs dessus). La source réelle (lectures phase 2) et le
// stockage SQLite (#11) se brancheront sans changer le moteur.
// Premier sync = zéro alerte (pas de faux positifs, FEATURES.md).
// Idempotent : mêmes données rejouées → zéro événement.

import { CONTRACTS_VERSION, isAssignment, isGrade, isTimetableEntry } from "../../shared/contracts/models";
import type { Assignment, Grade, TimetableEntry } from "../../shared/contracts/models";
import type { ContractEvent } from "../../shared/contracts/events";
import { diffAgainstPrints, fingerprint } from "./grades";

export interface SyncSource {
  grades(): Promise<Grade[]>;
  assignments(): Promise<Assignment[]>;
  entries(): Promise<TimetableEntry[]>;
}

export interface SyncSnapshot {
  readonly version: number;
  readonly at: string;
  readonly gradeIds: string[];
  readonly gradePrints: Record<string, string>;
  readonly assignmentIds: string[];
  readonly entryIds: string[];
  /** #76 : empreintes des cours d'EDT (add-only : snapshot 0.2.0 sans ce champ = pas de diff). */
  readonly entryPrints?: Record<string, string>;
}

export interface SyncSink {
  loadSnapshot(): Promise<SyncSnapshot | null>;
  saveSnapshot(snapshot: SyncSnapshot): Promise<void>;
}

export interface SyncResult {
  readonly firstRun: boolean;
  readonly events: ContractEvent[];
  readonly snapshot: SyncSnapshot;
}

function ids<T extends { id: string }>(items: T[]): string[] {
  return items.map((i) => i.id).sort();
}

// #76 : empreinte d'un cours d'EDT. Le statut et les horaires d'origine
// entrent dans l'empreinte : un cours annulé ou déplacé est une correction,
// donc une information à re-notifier.
function entryPrint(e: TimetableEntry): string {
  return JSON.stringify([
    e.subject,
    e.room ?? null,
    e.teacher ?? null,
    e.status ?? null,
    e.originalStart ?? null,
    e.originalEnd ?? null,
    e.start,
    e.end,
  ]);
}

function entryPrints(entries: TimetableEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) out[e.id] = entryPrint(e);
  return out;
}

/** Cours ajoutés ou modifiés depuis le snapshot (pas de type novel côté sync). */
function changedAgainstPrints(previous: Record<string, string>, current: TimetableEntry[]): TimetableEntry[] {
  const out: TimetableEntry[] = [];
  for (const e of current) {
    const print = previous[e.id];
    if (print === undefined || print !== entryPrint(e)) out.push(e);
  }
  return out;
}

export async function runSync(source: SyncSource, sink: SyncSink, at = new Date().toISOString()): Promise<SyncResult> {
  const [grades, assignments, entries] = await Promise.all([
    source.grades(),
    source.assignments(),
    source.entries(),
  ]);
  const validGrades = grades.filter(isGrade);
  const validAssignments = assignments.filter(isAssignment);
  const validEntries = entries.filter(isTimetableEntry);

  const previous = await sink.loadSnapshot();
  const prints: Record<string, string> = {};
  for (const g of validGrades) prints[g.id] = fingerprint(g);
  const snapshot: SyncSnapshot = {
    version: (previous?.version ?? 0) + 1,
    at,
    gradeIds: ids(validGrades),
    gradePrints: prints,
    assignmentIds: ids(validAssignments),
    entryIds: ids(validEntries),
    entryPrints: entryPrints(validEntries),
  };

  if (!previous) {
    await sink.saveSnapshot({ ...snapshot, version: 1 });
    return { firstRun: true, events: [], snapshot: { ...snapshot, version: 1 } };
  }

  // Diff structurée notes (issue #17, I7) : ajouts + corrections → GradeCreated.
  const diff = diffAgainstPrints(previous.gradePrints ?? {}, validGrades);
  const events: ContractEvent[] = [...diff.added, ...diff.changed].map((data) => ({
    v: CONTRACTS_VERSION,
    type: "GradeCreated" as const,
    at,
    data,
  }));

  // #76 : même diff sur l'EDT (cours ajouté, annulé, déplacé) → UN événement
  // TimetableUpdated groupé. Données structurées Pronote uniquement, jamais de
  // sortie LLM (I7).
  const changedEntries = changedAgainstPrints(previous.entryPrints ?? {}, validEntries);
  if (changedEntries.length > 0) {
    events.push({
      v: CONTRACTS_VERSION,
      type: "TimetableUpdated" as const,
      at,
      data: { entries: changedEntries },
    });
  }

  if (events.length > 0 || snapshotChanged(previous, snapshot)) {
    await sink.saveSnapshot(snapshot);
    return { firstRun: false, events, snapshot };
  }
  return { firstRun: false, events: [], snapshot: previous };
}

function emptySnapshot(): SyncSnapshot {
  return { version: 0, at: "", gradeIds: [], gradePrints: {}, assignmentIds: [], entryIds: [] };
}

function snapshotChanged(a: SyncSnapshot, b: SyncSnapshot): boolean {
  return (
    JSON.stringify(a.gradeIds) !== JSON.stringify(b.gradeIds) ||
    JSON.stringify(a.assignmentIds) !== JSON.stringify(b.assignmentIds) ||
    JSON.stringify(a.entryIds) !== JSON.stringify(b.entryIds)
  );
}

/**
 * Boucle de sync d'arrière-plan. `maxRuns` (0 = illimité, défaut inchangé)
 * borne le nombre de tours : un sync manuel/one-shot s'arrête tout seul au lieu
 * de laisser un intervalle tourner pour rien. Le tick ne se chevauche pas
 * (jamais deux relectures simultanées, comme le refresh de session : un tick
 * déclenché pendant un tour en cours est IGNORÉ) et un échec ne crashe jamais
 * l'ordonnanceur — l'erreur du tour ET celle du `onResult` de secours sont
 * absorbées, donc aucune rejection ne s'échappe jamais.
 */
export function startSyncLoop(
  source: SyncSource,
  sink: SyncSink,
  intervalMs: number,
  onResult: (result: SyncResult) => void,
  maxRuns = 0,
): () => void {
  let stopped = false;
  let runs = 0;
  // Exclusion mutuelle : un seul tour en vol. Sans ça, deux ticks se chevauchent,
  // relisent le même snapshot et émettent deux fois le même GradeCreated.
  let enCours = false;
  const tick = async () => {
    if (stopped || enCours) return;
    enCours = true;
    runs += 1;
    try {
      onResult(await runSync(source, sink));
    } catch {
      // Le job ne crashe jamais l'ordonnanceur : run vide, snapshot conservé si dispo.
      // Le rattrapage reste DANS le try : un `onResult` KO ici ne doit pas
      // devenir une rejection non gérée (elle tuerait le process serveur).
      const kept = await sink.loadSnapshot().catch(() => null);
      try {
        onResult({ firstRun: runs === 1, events: [], snapshot: kept ?? emptySnapshot() });
      } catch {
        // Dispatcher de push KO et rattrapage KO : rien à notifier, on continue.
      }
    } finally {
      enCours = false;
    }
    // Budget de tours atteint = arrêt propre (pas de tick orphelin).
    if (maxRuns > 0 && runs >= maxRuns) {
      stopped = true;
      clearInterval(timer);
    }
  };
  const timer = setInterval(tick, intervalMs);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
