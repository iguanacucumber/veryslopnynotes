// Contrats v0 — événements serveur→app (SSE, source de vérité, issues #4, #18).
// Enveloppe versionnée {v, type, at, data}. Détection nouvelle note / DS
// sur données structurées uniquement (I7), jamais sur sortie libre LLM.

import { CONTRACTS_VERSION, isAssignment, isGrade, isTimetableEntry } from "./models";
import type { Assignment, Grade, TimetableEntry } from "./models";
import { isCacheableResource } from "./cache";
import type { CacheableResource } from "./cache";

export const EVENT_TYPES = [
  "GradeCreated",
  "AssignmentUpdated",
  "TimetableUpdated",
  "SyncCompleted",
  "CacheInvalidated",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface ContractEvent<T extends EventType = EventType, D = unknown> {
  readonly v: typeof CONTRACTS_VERSION;
  readonly type: T;
  readonly at: string; // ISO-8601
  readonly data: D;
}

export type GradeCreatedData = Grade;
export type AssignmentUpdatedData = Assignment;
export type TimetableUpdatedData = { readonly entries: TimetableEntry[] };
export type SyncCompletedData = {
  readonly accountId: string;
  readonly grades: number;
  readonly assignments: number;
};
export type CacheInvalidatedData = {
  readonly resource: CacheableResource;
  readonly reason: "sync" | "expiry" | "manual";
};

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export function isContractEvent(v: unknown): v is ContractEvent {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  if (e["v"] !== CONTRACTS_VERSION) return false;
  if (typeof e["type"] !== "string" || !(EVENT_TYPES as readonly string[]).includes(e["type"])) return false;
  if (!isIsoDate(e["at"])) return false;
  const data = e["data"];
  switch (e["type"] as EventType) {
    case "GradeCreated":
      return isGrade(data);
    case "AssignmentUpdated":
      return isAssignment(data);
    case "TimetableUpdated": {
      if (typeof data !== "object" || data === null) return false;
      const entries = (data as Record<string, unknown>)["entries"];
      return Array.isArray(entries) && entries.every(isTimetableEntry);
    }
    case "SyncCompleted": {
      if (typeof data !== "object" || data === null) return false;
      const d = data as Record<string, unknown>;
      return (
        typeof d["accountId"] === "string" &&
        (d["accountId"] as string).trim().length > 0 &&
        isNonNegativeInt(d["grades"]) &&
        isNonNegativeInt(d["assignments"])
      );
    }
    case "CacheInvalidated": {
      if (typeof data !== "object" || data === null) return false;
      const d = data as Record<string, unknown>;
      return (
        isCacheableResource(d["resource"]) &&
        (d["reason"] === "sync" || d["reason"] === "expiry" || d["reason"] === "manual")
      );
    }
    default:
      return false;
  }
}
