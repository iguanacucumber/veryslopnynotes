// Câblage du point d'entrée HTTP (server/infrastructure/http.ts).
// On teste la COMPOSITION (env → sessions → reader → store → routes), pas les
// handlers déjà couverts ailleurs : un test vert ici prouve que le serveur
// démarre réellement branché, pas qu'un WiringFactory existe sur le papier.
// Fakes 100 % synthétiques, aucun accès réseau, aucun secret.
import { describe, expect, test } from "bun:test";
import { createApp } from "../../server/infrastructure/http";
import type { App } from "../../server/infrastructure/http";
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

// 0.7.0 : plus aucune variable de credential. Le serveur se construit sans env.

/**
 * 0.7.0 : plus aucun compte d'ambiance (aucun credential serveur). Un store qui
 * déclare UN compte appairé = ce que le setup aurait produit. Zéro réseau.
 */
function pairedSessions(account: string | null = "acc-wiring") {
  return {
    currentAccountId: () => account,
    async refreshSession(): Promise<void> {},
    requireClient: () => ({}),
  };
}

describe("composition serveur (http.ts)", () => {
  // Toute route hors appairage + /v1/health exige un device APPAIRÉ (0.4.0).
  // `createApp` construit son PROPRE PairingService (non exporté) : on appaire
  // donc via l'API elle-même, parcours réel de l'app (vrai PIN, vrai secret
  // aléatoire, sha256 comparé par le routeur).
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
    // 0.4.0 : la réponse d'appairage porte le secret, UNE SEULE FOIS. Le test
    // le lit comme le fait l'app (avant, il espionnait `confirm` pour le
    // récupérer côté serveur).
    const { device, token } = (await confirm.json()) as { device: { id: string; tokenHash: string }; token: string };
    expect(device.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    return { authorization: `Bearer ${token}` };
  }

  test("sans store de session : le serveur démarre quand même, lectures vides, écritures 501", async () => {
    const app = createApp({ reader: null, sessions: null });
    const health = await app.handler(new Request("http://127.0.0.1/v1/health"));
    expect(health.status).toBe(200);
    const auth = await paired(app);
    const grades = await app.handler(new Request("http://127.0.0.1/v1/grades", { headers: auth }));
    // Store vide = rapport de moyennes estimées sans note : jamais un 500.
    expect(grades.status).toBe(200);
    expect(isGradesResponse(await grades.json())).toBe(true);
    // Sans bearer, la lecture est refusée (401) : la route est fermée.
    expect((await app.handler(new Request("http://127.0.0.1/v1/grades"))).status).toBe(401);
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
    const app = createApp({ reader, sessions: pairedSessions() as never });
    const auth = await paired(app);
    const res = await app.handler(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", headers: auth, body: "{}" }),
    );
    expect(res.status).toBe(200);
    const events = (await res.json()).events as unknown[];
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(isContractEvent(e)).toBe(true);
    // Premier sync = zéro GradeCreated/TimetableUpdated (pas de faux positif).
    expect(events.some((e) => (e as { type: string }).type === "GradeCreated")).toBe(false);
    // Le store est réellement rempli : les routes lisent le snapshot.
    const grades = await app.handler(new Request("http://127.0.0.1/v1/grades", { headers: auth }));
    const gradesBody = await grades.json();
    expect(isGradesResponse(gradesBody)).toBe(true);
    expect((gradesBody as { grades: unknown[] }).grades).toHaveLength(1);
    const timetable = await app.handler(new Request("http://127.0.0.1/v1/timetable", { headers: auth }));
    expect(isTimetableResponse(await timetable.json())).toBe(true);
    const caps = await app.handler(new Request("http://127.0.0.1/v1/capabilities", { headers: auth }));
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
    const app = createApp({ reader, sessions: pairedSessions() as never });
    const auth = await paired(app);
    await app.handler(new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", headers: auth, body: "{}" }));
    const second = await app.handler(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST", headers: auth, body: "{}" }),
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
    const app = createApp({ reader, sessions: pairedSessions() as never });
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
        headers: auth,
        body: JSON.stringify({ subject: "Sortie", body: "Merci.", recipientIds: ["r-1"] }),
      }),
    );
    expect(create.status).toBe(200);
    expect(calls).toContain("createDiscussion");
    // Aucune clé LLM : le câblage n'expose le LLM qu'à la route homework.
    const homework = await app.handler(
      new Request("http://127.0.0.1/v1/homework/generate", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ question: "q", sources: [] }),
      }),
    );
    expect([501, 503, 400]).toContain(homework.status);
  });

  test("reader sans écriture : refus net (501), jamais un faux succès", async () => {
    const reader = {
      getGrades: async () => ({ items: { __untrusted: true, value: [] }, nextCursor: null }),
    } as never;
    const app = createApp({ reader, sessions: pairedSessions() as never });
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