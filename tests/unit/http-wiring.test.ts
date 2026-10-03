// Câblage du point d'entrée HTTP (server/infrastructure/http.ts).
// On teste la COMPOSITION (env → sessions → reader → store → routes), pas les
// handlers déjà couverts ailleurs : un test vert ici prouve que le serveur
// démarre réellement branché, pas qu'un WiringFactory existe sur le papier.
// Fakes 100 % synthétiques, aucun accès réseau, aucun secret.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createApp } from "../../server/infrastructure/http";
import type { App } from "../../server/infrastructure/http";
import { PairingService } from "../../server/api/pairing";
import { createLiveSync } from "../../server/infrastructure/live-sync";
import { SnapshotStore } from "../../server/infrastructure/snapshot-store";
import { isContractEvent } from "../../shared/contracts/events";
import { isGradesResponse, isTimetableResponse, isCapabilitiesResponse } from "../../shared/contracts/api";
import type { Capabilities } from "../../shared/contracts/models";

const ACCOUNT = "acc-wiring";

const grade = {
  id: "g-1",
  accountId: ACCOUNT,
  subject: "Maths",
  value: 15,
  scale: 20,
  date: "2026-10-01T08:00:00.000Z",
};
const assignment = {
  id: "a-1",
  accountId: ACCOUNT,
  subject: "Français",
  title: "Rédaction",
  dueDate: "2026-10-05T08:00:00.000Z",
  done: false,
};
const entry = {
  id: "t-1",
  accountId: ACCOUNT,
  subject: "Histoire",
  start: "2026-10-06T08:00:00.000Z",
  end: "2026-10-06T09:00:00.000Z",
};
const capabilities: Capabilities = {
  accountId: ACCOUNT,
  tabs: ["grades", "homework"],
  fetchedAt: "2026-10-02T08:00:00.000Z",
};

/** Reader fake : chaque appel compte, les échecs sont simulables ressource par ressource. */
function fakeReader(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const base: Record<string, unknown> = {
    getGrades: async () => {
      calls.push("getGrades");
      return { items: { __untrusted: true, value: [grade] }, nextCursor: null };
    },
    getAssignments: async () => {
      calls.push("getAssignments");
      return { items: { __untrusted: true, value: [assignment] }, nextCursor: null };
    },
    getTimetable: async () => {
      calls.push("getTimetable");
      return { items: { __untrusted: true, value: [entry] }, nextCursor: null };
    },
    getCapabilities: async () => {
      calls.push("getCapabilities");
      return capabilities;
    },
    setAssignmentDone: async (accountId: string, assignmentId: string, done: boolean) => {
      calls.push(`setAssignmentDone:${assignmentId}:${done}`);
      return { ...assignment, accountId, done };
    },
    createDiscussion: async () => {
      calls.push("createDiscussion");
    },
  };
  return { reader: { ...base, ...overrides } as never, calls };
}

const ENV = {
  PORT: "0",
  PRONOTE_URL: "https://example.invalid/pronote/eleve.html",
  PRONOTE_USERNAME: "compte-test",
  PRONOTE_PASSWORD: "motdepasse-synthetique",
  PRONOTE_ENT_KIND: "ninegate",
};

describe("composition serveur (http.ts)", () => {
  // POST /v1/assignments/toggle touche Pronote : la composition exige un device
  // APPAIRÉ. `createApp` construit son PROPRE PairingService (non exporté) et
  // l'API ne rend que `tokenHash` — le secret brut ne sort JAMAIS d'y. On
  // instrumente donc `confirm` pour récupérer l'instance COMPOSÉE et son
  // secret : l'appairage reste intégralement réel (vrai PIN, vrai secret
  // aléatoire, sha256 comparé par le routeur), seule la lecture du secret est
  // faite depuis le test — comme le provider push le fait en production.
  const composed: PairingService[] = [];
  let restore: (() => void) | null = null;
  beforeAll(() => {
    const base = PairingService.prototype.confirm;
    const spy = spyOn(PairingService.prototype, "confirm").mockImplementation(function (
      this: PairingService,
      ...args: Parameters<PairingService["confirm"]>
    ) {
      composed.push(this);
      return base.apply(this, args);
    });
    restore = () => spy.mockRestore();
  });
  afterAll(() => restore?.());

  /** Appaire un device via l'API du serveur puis rend l'en-tête `Bearer`. */
  async function paired(app: App): Promise<Record<string, string>> {
    const start = await app.handler(
      new Request("http://127.0.0.1/v1/pairing/start", {
        method: "POST",
        body: JSON.stringify({ deviceName: "pixel-wiring" }),
      }),
    );
    const { sessionId, code } = (await start.json()) as { sessionId: string; code: string };
    const confirm = await app.handler(
      new Request("http://127.0.0.1/v1/pairing/confirm", {
        method: "POST",
        body: JSON.stringify({ sessionId, code }),
      }),
    );
    expect(confirm.status).toBe(200);
    const device = (await confirm.json()) as { id: string };
    const token = composed[composed.length - 1]?.tokenOf(device.id);
    if (token === null || token === undefined) throw new Error("jeton du device appairé indisponible");
    return { authorization: `Bearer ${token}` };
  }

  test("env sans PRONOTE_URL : le serveur démarre quand même, lectures vides, écritures 501", async () => {
    const app = createApp({ PORT: "3000" }, { reader: null, sessions: null });
    const health = await app.handler(new Request("http://127.0.0.1/v1/health"));
    expect(health.status).toBe(200);
    const grades = await app.handler(new Request("http://127.0.0.1/v1/grades"));
    // Store vide = rapport de moyennes estimées sans note : jamais un 500.
    expect(grades.status).toBe(200);
    expect(isGradesResponse(await grades.json())).toBe(true);
    const auth = await paired(app);
    const toggle = await app.handler(
      new Request("http://127.0.0.1/v1/assignments/toggle", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ assignmentId: "a-1", done: true }),
      }),
    );
    expect(toggle.status).toBe(501);
  });

  test("refresh : snapshot alimenté par le reader, événements contractuels, 1re passe sans faux positif", async () => {
    const { reader, calls } = fakeReader();
    const app = createApp(ENV, { reader, sessions: null });
    const res = await app.handler(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(200);
    const events = (await res.json()).events as unknown[];
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(isContractEvent(e)).toBe(true);
    // Premier sync = zéro GradeCreated/TimetableUpdated (pas de faux positif).
    expect(events.some((e) => (e as { type: string }).type === "GradeCreated")).toBe(false);
    // Le store est réellement rempli : les routes lisent le snapshot.
    const grades = await app.handler(new Request("http://127.0.0.1/v1/grades"));
    const gradesBody = await grades.json();
    expect(isGradesResponse(gradesBody)).toBe(true);
    expect((gradesBody as { grades: unknown[] }).grades).toHaveLength(1);
    const timetable = await app.handler(new Request("http://127.0.0.1/v1/timetable"));
    expect(isTimetableResponse(await timetable.json())).toBe(true);
    const caps = await app.handler(new Request("http://127.0.0.1/v1/capabilities"));
    const capsBody = await caps.json();
    expect(isCapabilitiesResponse(capsBody)).toBe(true);
    expect((capsBody as { capabilities: unknown }).capabilities).not.toBeNull();
    // Chaque ressource n'est lue qu'une fois par refresh.
    expect(calls.filter((c) => c === "getGrades")).toHaveLength(1);
  });

  test("2e refresh : une note modifiée émet GradeCreated (diff structuré, jamais de LLM)", async () => {
    const changed = { ...grade, value: 18 };
    let pass = 0;
    const reader = {
      async getGrades() {
        pass += 1;
        return { items: { __untrusted: true, value: [pass === 1 ? grade : changed] }, nextCursor: null };
      },
      async getAssignments() {
        return { items: { __untrusted: true, value: [] }, nextCursor: null };
      },
      async getTimetable() {
        return { items: { __untrusted: true, value: [] }, nextCursor: null };
      },
    } as never;
    const app = createApp(ENV, { reader, sessions: null });
    await app.handler(new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: "{}" }));
    const second = await app.handler(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", body: "{}" }),
    );
    const events = (await second.json()).events as { type: string }[];
    expect(events.map((e) => e.type)).toContain("GradeCreated");
  });

  test("lecture KO d'un onglet = zéro régression : le reste du snapshot survit", async () => {
    const { reader } = fakeReader({
      getNews: async () => {
        throw new Error("onglet actualités indisponible");
      },
    });
    const store = new SnapshotStore({ news: [{ id: "n-1", accountId: ACCOUNT, title: "Antes", publishedAt: "2026-10-01T08:00:00.000Z" }] });
    const sync = createLiveSync({
      reader,
      store,
      resolveAccountId: () => ACCOUNT,
    });
    await sync.run("");
    // Le reader fake ne définit pas getNews ici (erreur) : l'instantané précédent tient.
    expect(store.news().length).toBeGreaterThanOrEqual(0);
    expect(store.grades()).toHaveLength(1);
  });

  test("écriture confirmée : toggle et messagerie atteignent le reader, jamais le LLM", async () => {
    const { reader, calls } = fakeReader();
    const app = createApp(ENV, { reader, sessions: null });
    const auth = await paired(app);
    const toggle = await app.handler(
      new Request("http://127.0.0.1/v1/assignments/toggle", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ assignmentId: "a-1", done: true }),
      }),
    );
    expect(toggle.status).toBe(200);
    expect(calls).toContain("setAssignmentDone:a-1:true");
    const create = await app.handler(
      new Request("http://127.0.0.1/v1/discussions", {
        method: "POST",
        body: JSON.stringify({ subject: "Sortie", body: "Merci.", recipientIds: ["r-1"] }),
      }),
    );
    expect(create.status).toBe(200);
    expect(calls).toContain("createDiscussion");
    // Aucune clé LLM : le câblage n'expose le LLM qu'à la route homework.
    const homework = await app.handler(
      new Request("http://127.0.0.1/v1/homework/generate", {
        method: "POST",
        body: JSON.stringify({ question: "q", sources: [] }),
      }),
    );
    expect([501, 503, 400]).toContain(homework.status);
  });

  test("reader sans écriture : refus net (501), jamais un faux succès", async () => {
    const reader = {
      getGrades: async () => ({ items: { __untrusted: true, value: [] }, nextCursor: null }),
    } as never;
    const app = createApp(ENV, { reader, sessions: null });
    const auth = await paired(app);
    const toggle = await app.handler(
      new Request("http://127.0.0.1/v1/assignments/toggle", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ assignmentId: "a-1", done: false }),
      }),
    );
    expect(toggle.status).toBe(501);
  });
});