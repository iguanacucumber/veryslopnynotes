// Contrats v0 — modèles app↔serveur (source de vérité, phase 1, issue #4).
// Les API convertissent domaine → contrats, sans logique Pronote/métier.
// Versionnée : tout changement cassant = bump majeur + PR justificative.
// Voir shared/contracts/README.md, docs/architecture/INVARIANTS.md (I7 : push
// et détection DS sur données structurées uniquement, jamais sortie LLM).

export const CONTRACTS_VERSION = "0.1.0" as const;

export interface Grade {
  readonly id: string;
  readonly accountId: string;
  readonly subject: string;
  readonly value: number;
  readonly scale: number;
  readonly coefficient?: number;
  readonly date: string; // ISO-8601
}

export interface Assignment {
  readonly id: string;
  readonly accountId: string;
  readonly subject: string;
  readonly title: string;
  readonly dueDate: string; // ISO-8601
  readonly done: boolean;
}

export interface TimetableEntry {
  readonly id: string;
  readonly accountId: string;
  readonly subject: string;
  readonly room?: string;
  readonly start: string; // ISO-8601
  readonly end: string; // ISO-8601
}

export interface Device {
  readonly id: string;
  /** Empreinte du token push, jamais le token brut (règle d'or dépôt public). */
  readonly tokenHash: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isGrade(v: unknown): v is Grade {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isNonEmptyString(v["subject"])) return false;
  if (!isFiniteNumber(v["value"]) || (v["value"] as number) < 0) return false;
  if (!isFiniteNumber(v["scale"]) || (v["scale"] as number) <= 0) return false;
  if (v["coefficient"] !== undefined && (!isFiniteNumber(v["coefficient"]) || (v["coefficient"] as number) <= 0)) return false;
  if (!isIsoDate(v["date"])) return false;
  return true;
}

export function isAssignment(v: unknown): v is Assignment {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isNonEmptyString(v["subject"]) || !isNonEmptyString(v["title"])) return false;
  if (!isIsoDate(v["dueDate"])) return false;
  if (typeof v["done"] !== "boolean") return false;
  return true;
}

export function isTimetableEntry(v: unknown): v is TimetableEntry {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isNonEmptyString(v["subject"])) return false;
  if (v["room"] !== undefined && typeof v["room"] !== "string") return false;
  if (!isIsoDate(v["start"]) || !isIsoDate(v["end"])) return false;
  if (Date.parse(v["end"] as string) < Date.parse(v["start"] as string)) return false;
  return true;
}

export function isDevice(v: unknown): v is Device {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["tokenHash"])) return false;
  return true;
}

/** Empreinte token push = hex sha256 (64 chars). Partagé jobs/infra (issue #57). */
export function isTokenHash(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/i.test(v);
}
