import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  API_ROUTES,
  isHealthResponse,
  isManualsScrapeRequest,
  isManualsScrapeResponse,
} from "../../shared/contracts/api";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";

const CONTRACTS_DIR = join(import.meta.dir, "..", "..", "shared/contracts");
const OPENAPI = join(CONTRACTS_DIR, "api.openapi.yaml");

describe("contracts", () => {
  test("surface #210 : le contrat ne liste plus que le scraper", () => {
    expect(API_ROUTES).toEqual([
      { method: "GET", path: "/v1/health" },
      { method: "POST", path: "/v1/manuals/scrape" },
    ]);
  });

  test("openapi présent, versionné comme CONTRACTS_VERSION, en sync avec la table", () => {
    expect(existsSync(OPENAPI)).toBe(true);
    const raw = readFileSync(OPENAPI, "utf8");
    expect(raw).toContain(`version: ${CONTRACTS_VERSION}`);
    // ponytail: substring check volontaire, pas de parser OpenAPI. Upgrade: parser dédié si routes > 20.
    for (const r of API_ROUTES) expect(raw).toContain(r.path);
    for (const s of ["HealthResponse:", "ManualsScrapeRequest:", "ManualsScrapeResponse:", "ManualDoc:"]) {
      expect(raw).toContain(s);
    }
    // Les 31 routes métier sont parties du contrat avec leurs schémas.
    for (const dead of [
      "/v1/pairing/start",
      "/v1/setup",
      "/v1/grades",
      "/v1/assignments",
      "/v1/homework/generate",
      "/v1/revision-sheets",
      "/v1/subjects/prefs",
      "/v1/discussions",
      "/v1/sync/refresh",
      "PairingStartRequest:",
      "SetupRequest:",
      "AssignmentsToggleRequest:",
    ]) {
      expect(raw).not.toContain(dead);
    }
  });

  test("sonde : valide OK, invalides rejetés", () => {
    expect(isHealthResponse({ status: "ok", version: CONTRACTS_VERSION })).toBe(true);
    expect(isHealthResponse({ status: "ko", version: CONTRACTS_VERSION })).toBe(false);
    expect(isHealthResponse({ status: "ok" })).toBe(false);
  });

  test("scrape : gardes requête/réponse", () => {
    const body = {
      platform: "editeur-fake",
      username: "u",
      password: "p",
      startUrl: "https://manuels.example.invalid/6e/maths",
    };
    expect(isManualsScrapeRequest(body)).toBe(true);
    expect(isManualsScrapeRequest({ ...body, password: "" })).toBe(false);
    expect(isManualsScrapeRequest({ ...body, startUrl: "ftp://hote.invalid/x" })).toBe(false);
    expect(isManualsScrapeRequest(null)).toBe(false);
    const doc = {
      id: "scrape-1",
      platform: "editeur-fake",
      title: "Maths-Fake 6e",
      subject: "Maths-Fake",
      page: 1,
      excerpt: "Extrait synthétique.",
    };
    expect(isManualsScrapeResponse({ docs: [doc] })).toBe(true);
    expect(isManualsScrapeResponse({ docs: [] })).toBe(true);
    expect(isManualsScrapeResponse({ docs: [{ ...doc, page: 0 }] })).toBe(false);
  });
});
