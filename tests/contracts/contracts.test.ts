import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  API_ROUTES,
  isHealthResponse,
  isManualsScrapeRequest,
  isManualsScrapeResponse,
} from "../../shared/contracts/api";
import { CONTRACTS_VERSION, isAssignment, isHomeworkAttachmentRef } from "../../shared/contracts/models";

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
      // #538 : le jar de session est choisi par le serveur — le contrat ne
      // déclare PLUS de champ pour le demander (l'appelant aurait pu
      // appeler la session d'un autre tenant).
      "authFile:",
    ]) {
      expect(raw).not.toContain(dead);
    }
  });

  // #422 : le contrat doit décrire les réponses que le scraper rend
  // vraiment : 503 « scraper occupé » (plafond de concurrence) et 504 pour
  // le délai dépassé (le code exact — un 502 ferait croire à une panne du
  // portail).
  test("openapi : le scrape déclare 503 (scraper occupé) et 504 (délai)", () => {
    const raw = readFileSync(OPENAPI, "utf8");
    const healthAt = raw.indexOf("/v1/health:");
    const scrapeAt = raw.indexOf("/v1/manuals/scrape:");
    expect(healthAt).toBeGreaterThan(-1);
    expect(scrapeAt).toBeGreaterThan(healthAt);
    const scrape = raw.slice(scrapeAt);
    expect(scrape).toContain("'503':");
    expect(scrape).toContain("'504':");
    // Ces codes sont ceux du SCRAPE : la sonde ne les porte pas.
    const health = raw.slice(healthAt, scrapeAt);
    expect(health).not.toContain("'503':");
    expect(health).not.toContain("'504':");
  });

  // #526 : le contrat reflète l'usage RÉEL des identifiants — le scraper ne
  // s'authentifie pas (la session est celle du serveur) : les identifiants ne
  // sont PLUS exigés, et le serveur refuse un corps qui les porte (400).
  test("openapi : les identifiants de portail ne sont plus requis", () => {
    const raw = readFileSync(OPENAPI, "utf8");
    expect(raw).toContain("required: [platform, startUrl]");
    expect(raw).not.toContain("required: [platform, username, password, startUrl]");
  });

  test("sonde : valide OK, invalides rejetés", () => {
    expect(isHealthResponse({ status: "ok", version: CONTRACTS_VERSION })).toBe(true);
    expect(isHealthResponse({ status: "ko", version: CONTRACTS_VERSION })).toBe(false);
    expect(isHealthResponse({ status: "ok" })).toBe(false);
  });

  test("scrape : gardes requête/réponse", () => {
    const body = {
      platform: "editeur-fake",
      startUrl: "https://manuels.example.invalid/6e/maths",
    };
    expect(isManualsScrapeRequest(body)).toBe(true);
    // #526 : les identifiants de portail ne sont PLUS exigés (le scraper ne
    // s'authentifie pas : la session est celle du serveur). Le contrat les
    // ignore ; c'est le SERVEUR qui refuse un corps qui les porte.
    expect(isManualsScrapeRequest({ ...body, username: "u", password: "p" })).toBe(true);
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

  // #366 : la `ref` d'une pièce jointe de devoir suit le schéma `homework:`,
  // MÊME forme que l'app (`core/Assignment.kt`) et le parseur web.
  test("`ref` de devoir : schéma `homework:` (miroir de l'app et du web)", () => {
    const att = (ref: string) => ({ id: "att1", label: "sujet.pdf", ref });
    expect(isHomeworkAttachmentRef(att("homework:0:file:0:att1"))).toBe(true);
    expect(isHomeworkAttachmentRef(att("homework:12:file:3:12-34"))).toBe(true);
    for (const ref of [
      "homework:0:file:0:12 34", // espace (identifiant Pronote exotique)
      "homework:0:file:0:a\u0001b", // caractère de contrôle
      "DATA:application/pdf;base64,AA", // casse haute
      "https://pronote/x", // URL
      "homework:", // schéma sans identifiant
      "autre:1:2", // autre schéma
    ]) {
      expect(isHomeworkAttachmentRef(att(ref))).toBe(false);
    }
    // Un devoir dont la `ref` n'est pas au schéma est refusé par le contrat.
    const assignment = {
      id: "a1",
      accountId: "e1",
      subject: "Maths",
      title: "TP",
      dueDate: "2026-10-23T18:00:00.000Z",
      done: false,
    };
    expect(isAssignment({ ...assignment, attachments: [att("homework:0:file:0:att1")] })).toBe(true);
    expect(isAssignment({ ...assignment, attachments: [att("12 34")] })).toBe(false);
  });
});
