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
  "SecurityAlert",
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

// Alertes sécurité phase 6 (#21) : injections neutralisées (I6).
// Excerpt = contenu suspect tronqué, affiché comme donnée jamais interprétée.
// Fixtures 100 % synthétiques, sans secret ni URL réelle.
export const SECURITY_ALERT_KINDS = ["injection_neutralized"] as const;

export type SecurityAlertKind = (typeof SECURITY_ALERT_KINDS)[number];

export interface SecurityAlertData {
  readonly id: string;
  readonly kind: SecurityAlertKind;
  /** Extrait suspect (1..2000 chars), donnée jamais instruction (I6). */
  readonly excerpt: string;
  /** Origine pipeline (ex. revision, homework, manuals), 1..64 chars. */
  readonly source: string;
}

export function isSecurityAlertData(v: unknown): v is SecurityAlertData {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  if (typeof d["id"] !== "string" || (d["id"] as string).trim().length === 0) return false;
  if (typeof d["kind"] !== "string" || !(SECURITY_ALERT_KINDS as readonly string[]).includes(d["kind"])) {
    return false;
  }
  if (typeof d["excerpt"] !== "string") return false;
  const excerpt = (d["excerpt"] as string).trim();
  if (excerpt.length === 0 || excerpt.length > 2000) return false;
  if (typeof d["source"] !== "string") return false;
  const source = (d["source"] as string).trim();
  if (source.length === 0 || source.length > 64) return false;
  return true;
}

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
    case "SecurityAlert":
      return isSecurityAlertData(data);
    default:
      return false;
  }
}
