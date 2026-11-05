import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  API_ROUTES,
  MANUALS_SCRAPE_PAGE_MAX,
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
      { method: "GET", path: "/v1/ready" },
      { method: "POST", path: "/v1/manuals/scrape" },
      { method: "POST", path: "/v1/web/scrape" },
    ]);
  });

  test("openapi présent, versionné comme CONTRACTS_VERSION, en sync avec la table", () => {
    expect(existsSync(OPENAPI)).toBe(true);
    const raw = readFileSync(OPENAPI, "utf8");
    expect(raw).toContain(`version: ${CONTRACTS_VERSION}`);
    // ponytail: substring check volontaire, pas de parser OpenAPI. Upgrade: parser dédié si routes > 20.
    for (const r of API_ROUTES) expect(raw).toContain(r.path);
    for (const s of ["HealthResponse:", "ReadyResponse:", "ManualsScrapeRequest:", "ManualsScrapeResponse:", "ManualDoc:"]) {
      expect(raw).toContain(s);
    }
    // Routes et schémas métier retirés du contrat.
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
      // Le jar de session est choisi par le serveur : le contrat ne déclare pas
      // de champ pour le demander (l'appelant pourrait viser un autre tenant).
      "authFile:",
    ]) {
      expect(raw).not.toContain(dead);
    }
  });

  // Le contrat décrit les réponses réelles du scraper : 503 « scraper occupé »
  // (plafond de concurrence) et 504 délai dépassé — un 502 ferait croire à une
  // panne du portail.
  test("openapi : le scrape déclare 503 (scraper occupé) et 504 (délai)", () => {
    const raw = readFileSync(OPENAPI, "utf8");
    const healthAt = raw.indexOf("/v1/health:");
    const readyAt = raw.indexOf("/v1/ready:");
    const scrapeAt = raw.indexOf("/v1/manuals/scrape:");
    expect(healthAt).toBeGreaterThan(-1);
    expect(readyAt).toBeGreaterThan(healthAt);
    expect(scrapeAt).toBeGreaterThan(readyAt);
    const scrape = raw.slice(scrapeAt);
    expect(scrape).toContain("'503':");
    expect(scrape).toContain("'504':");
    const health = raw.slice(healthAt, readyAt);
    expect(health).not.toContain("'503':");
    expect(health).not.toContain("'504':");
    // `/v1/ready` répond 503 quand un contrôle (jar, navigateur, drain) échoue.
    const ready = raw.slice(readyAt, scrapeAt);
    expect(ready).toContain("'503':");
    expect(ready).not.toContain("'504':");
  });

  // Le scraper ne s'authentifie pas (la session est celle du serveur) : les
  // identifiants ne sont pas requis, et le serveur refuse un corps qui les porte.
  test("openapi : les identifiants de portail ne sont plus requis", () => {
    const raw = readFileSync(OPENAPI, "utf8");
    expect(raw).toContain("required: [platform, startUrl]");
    expect(raw).not.toContain("required: [platform, username, password, startUrl]");
  });

  // `page` optionnelle : le schéma OpenAPI déclare la MÊME borne que le
  // validateur TS, sinon un client généré enverrait une page que le serveur
  // refuse (400).
  test("openapi : le scrape déclare page bornée comme le validateur", () => {
    const raw = readFileSync(OPENAPI, "utf8");
    expect(raw).toContain(
      `page: { type: integer, minimum: 1, maximum: ${MANUALS_SCRAPE_PAGE_MAX} }`,
    );
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
    expect(isManualsScrapeRequest({ ...body, username: "u", password: "p" })).toBe(true);
    expect(isManualsScrapeRequest({ ...body, startUrl: "ftp://hote.invalid/x" })).toBe(false);
    expect(isManualsScrapeRequest(null)).toBe(false);
    expect(isManualsScrapeRequest({ ...body, page: 1 })).toBe(true);
    expect(isManualsScrapeRequest({ ...body, page: MANUALS_SCRAPE_PAGE_MAX })).toBe(true);
    expect(isManualsScrapeRequest({ ...body, page: 0 })).toBe(false);
    expect(isManualsScrapeRequest({ ...body, page: MANUALS_SCRAPE_PAGE_MAX + 1 })).toBe(false);
    expect(isManualsScrapeRequest({ ...body, page: 1.5 })).toBe(false);
    expect(isManualsScrapeRequest({ ...body, page: "12" })).toBe(false);
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

  // Le scraper ne s'authentifie jamais : `user:pass@` doit être refusé par le
  // contrat, comme par `ManualUrl.kt`, avant toute requête réseau.
  test("scrape : userinfo dans startUrl refusé, extrait vide refusé", () => {
    const body = {
      platform: "editeur-fake",
      startUrl: "https://manuels.example.invalid/6e/maths",
    };
    for (const startUrl of [
      "https://user:pass@manuels.example.invalid/6e/maths",
      "https://user@manuels.example.invalid/6e/maths",
      "https://:pass@manuels.example.invalid/6e/maths",
    ]) {
      expect(isManualsScrapeRequest({ ...body, startUrl })).toBe(false);
    }
    const doc = {
      id: "scrape-1",
      platform: "editeur-fake",
      title: "Maths-Fake 6e",
      subject: "Maths-Fake",
      page: 1,
      excerpt: "Extrait synthétique.",
    };
    for (const excerpt of ["", "   ", "\n\t"]) {
      expect(isManualsScrapeResponse({ docs: [{ ...doc, excerpt }] })).toBe(false);
    }
    expect(isManualsScrapeResponse({ docs: [{ ...doc, excerpt: "x" }] })).toBe(true);
  });

  test("chaque route servie est déclarée (health, ready, scrape)", async () => {
    const { createApp } = await import("../../server/infrastructure/http");
    const app = createApp({
      readiness: () => ({ jar: true, browser: true }),
      scrape: async () => [],
      scrapeWeb: async () => [],
    });
    for (const route of API_ROUTES) {
      const res = await app.handler(
        new Request(`http://127.0.0.1${route.path}`, {
          method: route.method,
          headers: route.method === "POST" ? { "content-type": "application/json" } : undefined,
          body: route.method === "POST" ? "{}" : undefined,
        }),
      );
      // 400 (corps invalide) prouve que la route existe ; 404 la contredirait.
      expect({ path: route.path, status: res.status }).not.toEqual({ path: route.path, status: 404 });
    }
    expect((await app.handler(new Request("http://127.0.0.1/v1/inconnue"))).status).toBe(404);
    // Réciproque : tout chemin `/v1/...` en dur dans le serveur doit être
    // déclaré (les routes vivantes viennent des constantes du contrat).
    const httpSource = readFileSync(join(CONTRACTS_DIR, "..", "..", "server", "infrastructure", "http.ts"), "utf8");
    const literals = new Set([...httpSource.matchAll(/["'](\/v1\/[^"']+)["']/g)].map((m) => m[1]!));
    for (const literal of literals) expect(API_ROUTES.map((r) => r.path)).toContain(literal);
  });

  // La `ref` d'une pièce jointe suit le schéma `homework:`, MÊME forme que
  // `core/Assignment.kt` et le parseur web.
  test("`ref` de devoir : schéma `homework:` (miroir de l'app et du web)", () => {
    const att = (ref: string) => ({ id: "att1", label: "sujet.pdf", ref });
    expect(isHomeworkAttachmentRef(att("homework:0:file:0:att1"))).toBe(true);
    expect(isHomeworkAttachmentRef(att("homework:12:file:3:12-34"))).toBe(true);
    for (const ref of [
      "homework:0:file:0:12 34",
      "homework:0:file:0:a\u0001b",
      "DATA:application/pdf;base64,AA",
      "https://pronote/x",
      "homework:",
      "autre:1:2",
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
