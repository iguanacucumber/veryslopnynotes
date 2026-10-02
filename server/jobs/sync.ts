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

export function startSyncLoop(
  source: SyncSource,
  sink: SyncSink,
  intervalMs: number,
  onResult: (result: SyncResult) => void,
): () => void {
  let stopped = false;
  let runs = 0;
  const tick = async () => {
    if (stopped) return;
    runs += 1;
    try {
      onResult(await runSync(source, sink));
    } catch {
      // Le job ne crashe jamais l'ordonnanceur : run vide, snapshot conservé si dispo.
      const kept = await sink.loadSnapshot().catch(() => null);
      onResult({ firstRun: runs === 1, events: [], snapshot: kept ?? emptySnapshot() });
    }
  };
  const timer = setInterval(tick, intervalMs);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
