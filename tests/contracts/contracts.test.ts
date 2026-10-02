import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  API_ROUTES,
  isAssignmentsResponse,
  isGradesResponse,
  isHealthResponse,
  isPairingConfirmRequest,
  isPairingStartRequest,
  isPairingStartResponse,
  isRevisionSheetsResponse,
  isTimetableResponse,
} from "../../shared/contracts/api";
import {
  CONTRACTS_VERSION,
  REVISION_TEMPLATE_VERSION,
  isAssignment,
  isGrade,
  isRevisionSheet,
  isTimetableEntry,
} from "../../shared/contracts/models";
import { isContractEvent } from "../../shared/contracts/events";

const CONTRACTS_DIR = join(import.meta.dir, "..", "..", "shared/contracts");
const OPENAPI = join(CONTRACTS_DIR, "api.openapi.yaml");

const grade = {
  id: "g1",
  accountId: "acc1",
  subject: "Maths",
  value: 15,
  scale: 20,
  date: "2026-09-20T10:00:00.000Z",
};
const assignment = {
  id: "a1",
  accountId: "acc1",
  subject: "Français",
  title: "Rédaction",
  dueDate: "2026-10-05T08:00:00.000Z",
  done: false,
};
const entry = {
  id: "t1",
  accountId: "acc1",
  subject: "Histoire",
  start: "2026-10-03T08:00:00.000Z",
  end: "2026-10-03T09:00:00.000Z",
};

describe("contracts", () => {
  test("openapi présent et versionnée comme CONTRACTS_VERSION", () => {
    expect(existsSync(OPENAPI)).toBe(true);
    const raw = readFileSync(OPENAPI, "utf8");
    expect(raw).toContain(`version: ${CONTRACTS_VERSION}`);
    // ponytail: substring check volontaire, pas de parser OpenAPI. Upgrade: parser dédié si routes > 20.
    for (const r of API_ROUTES) expect(raw).toContain(r.path);
    for (const s of ["Grade:", "Assignment:", "TimetableEntry:", "Device:", "ContractEvent:"]) {
      expect(raw).toContain(s);
    }
  });

  test("modèles : valide OK, invalides rejetés", () => {
    expect(isGrade(grade)).toBe(true);
    expect(isGrade({ ...grade, coefficient: 2 })).toBe(true);
    expect(isGrade({ ...grade, value: -1 })).toBe(false);
    expect(isGrade({ ...grade, scale: 0 })).toBe(false);
    expect(isGrade({ ...grade, date: "pas-une-date" })).toBe(false);
    expect(isGrade({ ...grade, id: "  " })).toBe(false);
    expect(isGrade(null)).toBe(false);
    expect(isAssignment(assignment)).toBe(true);
    expect(isAssignment({ ...assignment, done: "oui" })).toBe(false);
    expect(isTimetableEntry(entry)).toBe(true);
    expect(isTimetableEntry({ ...entry, end: "2026-10-03T07:00:00.000Z" })).toBe(false);
    expect(isTimetableEntry({ ...entry, room: 42 })).toBe(false);
  });

  test("événements : enveloppe versionnée par type", () => {
    const at = "2026-10-02T06:00:00.000Z";
    expect(isContractEvent({ v: CONTRACTS_VERSION, type: "GradeCreated", at, data: grade })).toBe(true);
    expect(isContractEvent({ v: CONTRACTS_VERSION, type: "AssignmentUpdated", at, data: assignment })).toBe(true);
    expect(
      isContractEvent({ v: CONTRACTS_VERSION, type: "TimetableUpdated", at, data: { entries: [entry] } }),
    ).toBe(true);
    expect(
      isContractEvent({
        v: CONTRACTS_VERSION,
        type: "SyncCompleted",
        at,
        data: { accountId: "acc1", grades: 1, assignments: 0 },
      }),
    ).toBe(true);
    expect(isContractEvent({ v: "9.9.9", type: "GradeCreated", at, data: grade })).toBe(false);
    expect(isContractEvent({ v: CONTRACTS_VERSION, type: "Unknown", at, data: {} })).toBe(false);
    expect(isContractEvent({ v: CONTRACTS_VERSION, type: "GradeCreated", at, data: assignment })).toBe(false);
  });

  test("api : routes et payloads", () => {
    expect(API_ROUTES.length).toBe(11);
    expect(API_ROUTES.map((r) => r.path)).toContain("/v1/revision-sheets");
    expect(API_ROUTES.map((r) => r.path)).toContain("/v1/revision-sheets/pdf");
    expect(isHealthResponse({ status: "ok", version: CONTRACTS_VERSION })).toBe(true);
    expect(isHealthResponse({ status: "ko", version: CONTRACTS_VERSION })).toBe(false);
    expect(isPairingStartRequest({ deviceName: "pixel" })).toBe(true);
    expect(isPairingStartRequest({ deviceName: "" })).toBe(false);
    expect(isPairingStartResponse({ sessionId: "s1", code: "123456" })).toBe(true);
    expect(isPairingStartResponse({ sessionId: "s1", code: "abc" })).toBe(false);
    expect(isPairingConfirmRequest({ sessionId: "s1", code: "654321" })).toBe(true);
    expect(isGradesResponse({ grades: [grade] })).toBe(true);
    expect(isGradesResponse({ grades: [{ ...grade, value: -5 }] })).toBe(false);
    expect(isAssignmentsResponse({ assignments: [assignment] })).toBe(true);
    expect(isTimetableResponse({ entries: [entry] })).toBe(true);
    expect(isTimetableResponse({ entries: "non" })).toBe(false);
  });

  test("fiches : modèle + liste validés, gabarit versionné", () => {
    const sheet = {
      id: "fiche-a1",
      examId: "a1",
      subject: "Maths",
      date: "2026-10-06T08:00:00.000Z",
      title: "Fiche révision Maths",
      body: "Résumé.\n\nSources :\n- editeur-fake • Maths-Fake 6e • p.42",
      sources: ["editeur-fake • Maths-Fake 6e • p.42"],
      templateVersion: REVISION_TEMPLATE_VERSION,
      createdAt: "2026-10-02T06:00:00.000Z",
    };
    expect(isRevisionSheet(sheet)).toBe(true);
    expect(isRevisionSheet({ ...sheet, sources: [] })).toBe(false);
    expect(isRevisionSheet({ ...sheet, templateVersion: "autre" })).toBe(false);
    expect(isRevisionSheetsResponse({ sheets: [sheet] })).toBe(true);
    expect(isRevisionSheetsResponse({ sheets: [{ ...sheet, body: "" }] })).toBe(false);
  });
});
