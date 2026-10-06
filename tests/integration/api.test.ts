import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  isAssignmentsResponse,
  isGradesResponse,
  isPairingConfirmResponse,
  isPeriodsResponse,
  isHealthResponse,
  isPairingStartResponse,
  isTimetableResponse,
} from "../../shared/contracts/api";
import { isContractEvent } from "../../shared/contracts/events";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import { isApiErrorBody } from "../../server/api/errors";
import { createMemoryStore } from "../../server/api/store";
import { serve } from "../../server/api/router";
import { pairedDevice } from "../unit/fixtures/pairing";

// API locale, zéro secret, zéro credential : ce test tourne toujours.
// Lancement : `make integration-api` (ou `bun test tests/integration`).
describe("integration api", () => {
  let base = "";
  let stop = () => {};
  // Depuis 0.4.0, seule l'appairage + /v1/health restent ouvertes : le serveur
  // est donc monté AVEC un device appairé, et chaque fetch porte son bearer.
  const { pairing, auth } = pairedDevice();

  beforeAll(() => {
    const server = serve(createMemoryStore(), 0, pairing);
    base = `http://127.0.0.1:${server.port}`;
    stop = () => server.stop(true);
  });
  afterAll(() => stop());

  test("health + listes validées par contrats", async () => {
    const health = await (await fetch(`${base}/v1/health`)).json();
    expect(isHealthResponse(health)).toBe(true);
    expect(health.version).toBe(CONTRACTS_VERSION);

    const grades = await (await fetch(`${base}/v1/grades`, { headers: auth })).json();
    expect(isGradesResponse(grades)).toBe(true);
    expect(grades.grades.length).toBeGreaterThan(0);
    // #74 : moyennes dans la même réponse, defaut = algorithme subject Papillon.
    expect(grades.averages.algorithm).toBe("subject");
    expect(grades.averages.general.origin).toBe("estimated");
    expect(grades.averages.subjects.length).toBe(1);

    const periods = await (await fetch(`${base}/v1/periods`, { headers: auth })).json();
    expect(isPeriodsResponse(periods)).toBe(true);
    expect(periods.periods.length).toBeGreaterThan(0);

    const assignments = await (await fetch(`${base}/v1/assignments`, { headers: auth })).json();
    expect(isAssignmentsResponse(assignments)).toBe(true);

    const timetable = await (await fetch(`${base}/v1/timetable`, { headers: auth })).json();
    expect(isTimetableResponse(timetable)).toBe(true);
  });

  test("events SSE : premier événement SyncCompleted valide", async () => {
    const res = await fetch(`${base}/v1/events`, { headers: auth });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (let i = 0; i < 20; i++) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      const m = buf.match(/data: (\{.*\})\n\n/);
      if (m) {
        const evt = JSON.parse(m[1]);
        expect(isContractEvent(evt)).toBe(true);
        expect(evt.type).toBe("SyncCompleted");
        break;
      }
      if (done) break;
    }
    await reader.cancel();
    expect(buf).toContain("data: ");
  });

  test("#74 : choix d'algorithme, période filtrée, algo inconnu rejeté", async () => {
    const weighted = await (await fetch(`${base}/v1/grades?algorithm=weighted`, { headers: auth })).json();
    expect(isGradesResponse(weighted)).toBe(true);
    expect(weighted.averages.algorithm).toBe("weighted");

    const median = await (await fetch(`${base}/v1/grades?algorithm=median`, { headers: auth })).json();
    expect(median.averages.algorithm).toBe("median");

    // Période inconnue = rapport vide, jamais une moyenne d'une autre période.
    const scoped = await (await fetch(`${base}/v1/grades?periodId=inconnue`, { headers: auth })).json();
    expect(isGradesResponse(scoped)).toBe(true);
    expect(scoped.averages.periodId).toBe("inconnue");
    expect(scoped.averages.subjects).toEqual([]);
    expect(scoped.averages.general.value).toBeNull();

    const bad = await fetch(`${base}/v1/grades?algorithm=moyenne`, { headers: auth });
    expect(bad.status).toBe(400);
    expect(isApiErrorBody(await bad.json())).toBe(true);
  });

  test("#74 : moyennes fournies prioritaires, PAR PÉRIODE", async () => {
    const server = serve(
      createMemoryStore({
        grades: [
          {
            id: "s1",
            accountId: "seed-acc",
            subject: "Maths",
            value: 12,
            scale: 20,
            date: "2026-09-20T10:00:00.000Z",
            periodId: "p-1",
          },
          {
            id: "s2",
            accountId: "seed-acc",
            subject: "Anglais",
            value: 16,
            scale: 20,
            date: "2026-09-21T10:00:00.000Z",
            periodId: "p-1",
          },
        ],
        providedAverages: { "p-1": { periodId: "p-1", general: 14, subjects: { maths: 12 } } },
      }),
      0,
    );
    try {
      // Ce serveur a son PROPRE PairingService : on y apparie son device.
      const url = `http://127.0.0.1:${server.port}`;
      const start2 = await (
        await fetch(`${url}/v1/pairing/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceName: "pixel-moyennes" }),
        })
      ).json();
      const conf = await (
        await fetch(`${url}/v1/pairing/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: start2.sessionId, code: start2.code }),
        })
      ).json();
      const res = await (
        await fetch(`${url}/v1/grades?periodId=p-1`, { headers: { authorization: `Bearer ${conf.token}` } })
      ).json();
      expect(isGradesResponse(res)).toBe(true);
      expect(res.averages.general).toEqual({ value: 14, origin: "provided", subjectCount: 2 });
      const maths = res.averages.subjects.find((s: { subject: string }) => s.subject === "Maths");
      expect(maths.origin).toBe("provided");
      expect(maths.value).toBe(12);
      const anglais = res.averages.subjects.find((s: { subject: string }) => s.subject === "Anglais");
      expect(anglais.origin).toBe("estimated");
      expect(anglais.value).toBeCloseTo(16, 9);
      // Le bulletin d'un trimestre ne vaut PAS pour l'année : sans periodId
      // demandé, aucune fournie n'est eligible (une moyenne d'année n'existe
      // pas chez Pronote), donc tout reste estimé.
      const annee = await (
        await fetch(`${url}/v1/grades`, { headers: { authorization: `Bearer ${conf.token}` } })
      ).json();
      expect(annee.averages.general.origin).toBe("estimated");
      expect(annee.averages.general.value).toBeCloseTo(14, 9);
      expect(annee.averages.subjects.every((s: { origin: string }) => s.origin === "estimated")).toBe(true);
      // Période demandée que l'établissement ne publie pas : estimée, jamais
      // la moyenne d'une autre période.
      const inconnue = await (
        await fetch(`${url}/v1/grades?periodId=p-9`, { headers: { authorization: `Bearer ${conf.token}` } })
      ).json();
      expect(inconnue.averages.general).toEqual({ value: null, origin: "estimated", subjectCount: 0 });
    } finally {
      server.stop(true);
    }
  });

  test("erreurs typées : 404, 405 + Allow, 400, HEAD", async () => {
    const nf = await fetch(`${base}/v1/nope`, { headers: auth });
    expect(nf.status).toBe(404);
    expect(isApiErrorBody(await nf.json())).toBe(true);

    const met = await fetch(`${base}/v1/grades`, { method: "POST", headers: auth });
    expect(met.status).toBe(405);
    // 405 = en-tête Allow obligatoire (RFC 9110 §15.5.6).
    expect(met.headers.get("allow")).toBe("GET");
    expect(isApiErrorBody(await met.json())).toBe(true);

    const bad = await fetch(`${base}/v1/pairing/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "pas-du-json",
    });
    expect(bad.status).toBe(400);
    expect(isApiErrorBody(await bad.json())).toBe(true);

    // HEAD est obligatoire partout où GET existe : même statut, en-têtes, pas
    // de corps (sonde de disponibilité / de taille de contenu).
    const head = await fetch(`${base}/v1/health`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("pairing : start → confirm OK, rejou/mauvais code rejetés", async () => {
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const started = await (await post("/v1/pairing/start", { deviceName: "pixel" })).json();
    expect(isPairingStartResponse(started)).toBe(true);

    const confirmed = await post("/v1/pairing/confirm", {
      sessionId: started.sessionId,
      code: started.code,
    });
    expect(confirmed.status).toBe(200);
    // 0.4.0 : la réponse d'appairage porte le device ET le secret (une fois).
    const confirmBody = await confirmed.json();
    expect(isPairingConfirmResponse(confirmBody)).toBe(true);
    expect(confirmBody.token.length).toBeGreaterThan(0);

    const replay = await post("/v1/pairing/confirm", {
      sessionId: started.sessionId,
      code: started.code,
    });
    // Échecs d'appairage INDISTINGUABLES : une session déjà consommée (rejeu)
    // et un PIN faux rendent le MÊME 401 « pairing refused ». Un 404 « session
    // inconnue » ou un 400 « mauvais code » étaient un oracle d'existence de
    // session. Le 401 porte son défi d'authentification.
    const attendu = { error: { code: "unauthorized", message: "pairing refused" } };
    expect(replay.status).toBe(401);
    expect(replay.headers.get("www-authenticate")).not.toBeNull();
    const replayBody = await replay.json();
    expect(isApiErrorBody(replayBody)).toBe(true);
    expect(replayBody).toEqual(attendu);

    const other = await (await post("/v1/pairing/start", { deviceName: "pixel2" })).json();
    const wrong = await post("/v1/pairing/confirm", { sessionId: other.sessionId, code: "000000" });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(replayBody);

    // Session jamais ouverte : même refus, aucune différence observable.
    const inconnu = await post("/v1/pairing/confirm", { sessionId: "session-inexistante", code: "000000" });
    expect(inconnu.status).toBe(401);
    expect(await inconnu.json()).toEqual(replayBody);

    // /v1/pairing/start est ouverte (le device n'est pas encore appairé) :
    // le corps est donc borné AVANT parse, comme les autres routes d'écriture.
    const geant = await post("/v1/pairing/start", { deviceName: "x".repeat(5000) });
    expect(geant.status).toBe(400);
    expect(isApiErrorBody(await geant.json())).toBe(true);
  });
});
