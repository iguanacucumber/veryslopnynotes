import { describe, expect, test } from "bun:test";
import { createHandler } from "../../server/api/router";
import { pairedDevice } from "../unit/fixtures/pairing";
import { createMemoryStore } from "../../server/api/store";
import { isApiErrorBody } from "../../server/api/errors";
import { isAttendanceResponse, isPunishmentsResponse } from "../../shared/contracts/api";
import { isAbsenceRecord, isPunishment } from "../../shared/contracts/models";
import { CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import { syntheticAccountId, syntheticQr, syntheticSessionCredentials } from "../unit/fixtures/pronote";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import type { Untrusted } from "../../server/domain/ports";
import type { AbsenceRecord, Punishment } from "../../shared/contracts/models";
import {
  syntheticAbsences,
  syntheticAttendanceClient,
  syntheticAttendancePeriods,
  syntheticClientWithoutAttendance,
  syntheticPunishments,
} from "../unit/fixtures/attendance";

// e2e vie scolaire (#77) : store seedé -> GET /v1/attendance + /v1/punishments ->
// compteurs par période. Zéro réseau (store mémoire + client injecté), zéro
// secret, aucun LLM sur le chemin (données structurées seules, I7).

const creds = syntheticSessionCredentials;

const SEED_PERIODS = [
  { id: "p-1", name: "Trimestre 1", start: "2026-09-01T00:00:00.000Z", end: "2026-11-30T23:59:59.000Z" },
  { id: "p-2", name: "Trimestre 2", start: "2026-12-01T00:00:00.000Z", end: "2027-03-31T23:59:59.000Z" },
];

// Depuis 0.4.0 la lecture exige le bearer d'un device appairé : un seul
// appairage pour le fichier, l'en-tête voyage sur chaque requête.
const { pairing: PAIRING, auth: AUTH } = pairedDevice();

function handler() {
  return createHandler(
    createMemoryStore({ absences: syntheticAbsences, punishments: syntheticPunishments, periods: SEED_PERIODS }),
    PAIRING,
  );
}

describe("e2e vie scolaire (#77)", () => {
  test("abscences + retards publiés : compteurs par période, contrats valides", async () => {
    const res = await handler()(new Request("http://127.0.0.1/v1/attendance", { headers: AUTH }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(isAttendanceResponse(body)).toBe(true);
    expect(body.absences).toHaveLength(4);
    expect(body.absences.every(isAbsenceRecord)).toBe(true);
    // Compteurs dérivés = somme des lignes, jamais une valeur inventée.
    expect(body.periods).toEqual(syntheticAttendancePeriods);
    const kinds = body.absences.map((a: AbsenceRecord) => a.kind);
    expect(kinds.filter((k: string) => k === "late")).toHaveLength(1);
    // Aucun secret, aucune URL Pronote dans la réponse.
    expect(JSON.stringify(body)).not.toMatch(/sk-or-v1-|OPENROUTER_API_KEY|PRONOTE_PASSWORD|pronote/i);
  });

  test("filtre periodId : une période, puis période inconnue (jamais d'erreur)", async () => {
    const p1 = await handler()(new Request("http://127.0.0.1/v1/attendance?periodId=p-2", { headers: AUTH }));
    expect(p1.status).toBe(200);
    const p1Body = await p1.json();
    expect(p1Body.absences).toHaveLength(1);
    expect(p1Body.periods).toEqual([syntheticAttendancePeriods[1]]);
    const inconnu = await handler()(new Request("http://127.0.0.1/v1/attendance?periodId=p-999", { headers: AUTH }));
    expect(inconnu.status).toBe(200);
    expect((await inconnu.json()).absences).toEqual([]);
  });

  test("sanctions : liste publiée, establishment sans onglet = liste vide", async () => {
    const res = await handler()(new Request("http://127.0.0.1/v1/punishments", { headers: AUTH }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(isPunishmentsResponse(body)).toBe(true);
    expect(body.punishments.every(isPunishment)).toBe(true);
    expect(body.punishments.map((p: Punishment) => p.type)).toEqual(["Avertissement", "Exclusion temporaire"]);

    const vide = createHandler(createMemoryStore(), PAIRING);
    const videRes = await vide(new Request("http://127.0.0.1/v1/punishments", { headers: AUTH }));
    expect(videRes.status).toBe(200);
    expect((await videRes.json()).punishments).toEqual([]);
    // Cache : une réponse vide reste fraîche (état vide, pas badge d'erreur).
    expect(cacheStatus("attendance", 0, CACHE_TTL_MS.attendance)).toBe("fresh");
    expect(cacheStatus("punishments", 0, CACHE_TTL_MS.punishments)).toBe("fresh");
  });

  test("méthode invalide : 405 typée, corps d'erreur conforme", async () => {
    const res = await handler()(new Request("http://127.0.0.1/v1/punishments", { method: "DELETE", headers: AUTH }));
    expect(res.status).toBe(405);
    expect(isApiErrorBody(await res.json())).toBe(true);
  });

  test("reader : page structurée bornée, Untrusted, aucune fuite de session", async () => {
    const logs: string[] = [];
    const sessions = new PronoteSessionStore({
      clientFactory: (async () => syntheticAttendanceClient()) as never,
    });
    await sessions.authenticate({ ...creds });
    const reader = new PronoteClientReader({ sessions, logger: (m) => logs.push(m) });
    const page = await reader.getAttendance(syntheticAccountId);
    const items: Untrusted<AbsenceRecord[]> = page.items;
    expect(items.__untrusted).toBe(true);
    expect(items.value.every(isAbsenceRecord)).toBe(true);
    expect(items.value.map((r) => `${r.kind}:${r.id}`)).toEqual([
      "absence:a1",
      "late:d1",
      "late:d2",
    ]);
    const sanctions = await reader.getPunishments(syntheticAccountId);
    expect(sanctions.items.value.every(isPunishment)).toBe(true);
    const joined = logs.join("\n");
    expect(joined).not.toContain(syntheticQr.jeton);
    expect(joined).not.toContain(syntheticQr.login);
  });

  test("reader : établissement sans vie scolaire = listes vides (200 côté API)", async () => {
    const sessions = new PronoteSessionStore({
      clientFactory: (async () => syntheticClientWithoutAttendance()) as never,
    });
    await sessions.authenticate({ ...creds });
    const reader = new PronoteClientReader({ sessions });
    expect((await reader.getAttendance(syntheticAccountId)).items.value).toEqual([]);
    expect((await reader.getPunishments(syntheticAccountId)).items.value).toEqual([]);
  });
});