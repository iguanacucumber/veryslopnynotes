import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  isAssignmentsResponse,
  isGradesResponse,
  isHealthResponse,
  isTimetableResponse,
} from "../../shared/contracts/api";
import { isContractEvent } from "../../shared/contracts/events";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import { isApiErrorBody } from "../../server/api/errors";
import { createMemoryStore } from "../../server/api/store";
import { serve } from "../../server/api/router";

// API locale, zéro secret, tourne toujours (pas de .env.local requis).
// `make integration-api` reste skippé sans .env.local (Makefile) ; ce test
// se lance via `bun test tests/integration` avec ou sans env.
describe("integration api", () => {
  let base = "";
  let stop = () => {};

  beforeAll(() => {
    const server = serve(createMemoryStore(), 0);
    base = `http://127.0.0.1:${server.port}`;
    stop = () => server.stop(true);
  });
  afterAll(() => stop());

  test("health + listes validées par contrats", async () => {
    const health = await (await fetch(`${base}/v1/health`)).json();
    expect(isHealthResponse(health)).toBe(true);
    expect(health.version).toBe(CONTRACTS_VERSION);

    const grades = await (await fetch(`${base}/v1/grades`)).json();
    expect(isGradesResponse(grades)).toBe(true);
    expect(grades.grades.length).toBeGreaterThan(0);

    const assignments = await (await fetch(`${base}/v1/assignments`)).json();
    expect(isAssignmentsResponse(assignments)).toBe(true);

    const timetable = await (await fetch(`${base}/v1/timetable`)).json();
    expect(isTimetableResponse(timetable)).toBe(true);
  });

  test("events SSE : premier événement SyncCompleted valide", async () => {
    const res = await fetch(`${base}/v1/events`);
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

  test("erreurs typées : 404, 405, 400, 501", async () => {
    const nf = await fetch(`${base}/v1/nope`);
    expect(nf.status).toBe(404);
    expect(isApiErrorBody(await nf.json())).toBe(true);

    const met = await fetch(`${base}/v1/grades`, { method: "POST" });
    expect(met.status).toBe(405);
    expect(isApiErrorBody(await met.json())).toBe(true);

    const bad = await fetch(`${base}/v1/pairing/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "pas-du-json",
    });
    expect(bad.status).toBe(400);
    expect(isApiErrorBody(await bad.json())).toBe(true);

    const todo = await fetch(`${base}/v1/pairing/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceName: "pixel" }),
    });
    expect(todo.status).toBe(501);
    const body = await todo.json();
    expect(isApiErrorBody(body)).toBe(true);
    expect(body.error.code).toBe("not_implemented");
  });
});
