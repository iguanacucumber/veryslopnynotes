// Devoirs enrichis #75 : contrats add-only, mapper défensif, filtre semaine,
// toggle "fait" (I7) et proxy média. Fixtures 100 % synthétiques : aucune URL
// réelle, aucun secret, aucune donnée perso.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ASSIGNMENT_DESCRIPTION_MAX_CHARS,
  ASSIGNMENT_MAX_ATTACHMENTS,
  ASSIGNMENT_REF_MAX_CHARS,
  CONTRACTS_VERSION,
  isAssignment,
  isAttachmentRef,
} from "../../shared/contracts/models";
import type { Assignment } from "../../shared/contracts/models";
import {
  isAssignmentsResponse,
  isAssignmentsToggleRequest,
  isAssignmentsToggleResponse,
} from "../../shared/contracts/api";
import { isContractEvent } from "../../shared/contracts/events";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { PronoteWriteError } from "../../server/domain/ports";
import { createHandler } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";
import { PairingService } from "../../server/api/pairing";
import { isApiErrorBody } from "../../server/api/errors";
import { downloadMedia, mediaActions, MediaProxyError } from "../../server/infrastructure/media-proxy";
import {
  syntheticAccountId,
  syntheticQr,
  syntheticSessionCredentials,
} from "./fixtures/pronote";

const creds = syntheticSessionCredentials;

const BASE: Assignment = {
  id: "a1",
  accountId: "acc1",
  subject: "Maths-Fake",
  title: "Exos p.12",
  dueDate: "2026-10-05T08:00:00.000Z",
  done: false,
};

const REF = { id: "f1", label: "fiche.pdf", ref: "homework:0:file:0:f1" };

// --- fixtures Pronote synthétiques (#75) ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeHomeworkClient(overrides: Record<string, any> = {}): any {
  return {
    homework: async () => [
      {
        id: "h1",
        description: "Exos p.12 et rendre la fiche",
        done: false,
        date: new Date("2026-10-05T08:00:00.000Z"),
        subject: { name: "Maths-Fake" },
        period: { id: "p-1" },
        files: () => [{ id: "f1", name: "fiche.pdf" }, { id: "f2", name: "" }, null],
        setDone: async (status: boolean) => {
          calls.push(status);
        },
      },
    ],
    lessons: async () => [
      {
        id: "l1",
        start: new Date("2026-10-05T08:00:00.000Z"),
        subject: { name: "Maths-Fake" },
        content: async () => ({ title: "Séance 1", description: "Cours sur les fractions." }),
      },
    ],
    ...overrides,
  };
}

const calls: boolean[] = [];

async function readerWith(client: unknown) {
  const store = new PronoteSessionStore({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientFactory: (async () => client) as never,
  });
  await store.authenticate({ ...creds });
  return { store, reader: new PronoteClientReader({ sessions: store }) };
}

describe("contrats devoirs #75", () => {
  test("add-only : l'ancien Assignment reste valide, les nouveaux champs sont optionnels", () => {
    expect(isAssignment(BASE)).toBe(true);
    expect(
      isAssignment({
        ...BASE,
        description: "Exos p.12",
        lessonContent: { title: "Séance 1", excerpt: "Cours sur les fractions." },
        attachments: [REF],
        periodId: "p-1",
        weekId: "2026-W41",
      }),
    ).toBe(true);
    // Types faux = refusés (pas de valeur bidon tolérée).
    expect(isAssignment({ ...BASE, description: 42 })).toBe(false);
    expect(isAssignment({ ...BASE, description: "x".repeat(ASSIGNMENT_DESCRIPTION_MAX_CHARS + 1) })).toBe(false);
    expect(isAssignment({ ...BASE, lessonContent: { title: "" } })).toBe(false);
    expect(isAssignment({ ...BASE, attachments: "nope" })).toBe(false);
    expect(
      isAssignment({
        ...BASE,
        attachments: new Array(ASSIGNMENT_MAX_ATTACHMENTS + 1).fill(REF),
      }),
    ).toBe(false);
    expect(isAssignmentsResponse({ assignments: [BASE] })).toBe(true);
  });

  test("ref de PJ : jamais d'URL, toujours une référence interne", () => {
    expect(isAttachmentRef(REF)).toBe(true);
    for (const bad of [
      "https://pronote.example.invalid/fichiers/x.pdf",
      "http://example.invalid/fichiers/x.pdf",
      "//example.invalid/fichiers/x.pdf",
      "data:application/pdf;base64,AAAA",
      "\\\\serveur\\partage",
      "x".repeat(ASSIGNMENT_REF_MAX_CHARS + 1),
      "",
    ]) {
      expect({ bad, ok: isAttachmentRef({ ...REF, ref: bad }) }).toEqual({ bad, ok: false });
    }
    expect(isAttachmentRef({ ...REF, label: "" })).toBe(false);
    expect(isAttachmentRef({ ...REF, id: "" })).toBe(false);
  });

  test("toggle : requête bornée, réponse = devoir + AssignmentUpdated", () => {
    expect(isAssignmentsToggleRequest({ assignmentId: "a1", done: true })).toBe(true);
    expect(isAssignmentsToggleRequest({ assignmentId: "a1", accountId: "acc1", done: false })).toBe(true);
    expect(isAssignmentsToggleRequest({ assignmentId: "  ", done: true })).toBe(false);
    expect(isAssignmentsToggleRequest({ assignmentId: "a1", done: "oui" })).toBe(false);
    expect(isAssignmentsToggleRequest({ assignmentId: "a1", done: true, accountId: "x".repeat(65) })).toBe(false);
    const event = { v: CONTRACTS_VERSION, type: "AssignmentUpdated", at: "2026-10-04T07:00:00.000Z", data: BASE };
    expect(isContractEvent(event)).toBe(true);
    expect(isAssignmentsToggleResponse({ assignment: BASE, event })).toBe(true);
    // Enveloppe d'un autre type = refusée (l'app ne peut pas inventer un effet).
    expect(
      isAssignmentsToggleResponse({ assignment: BASE, event: { ...event, type: "SyncCompleted" } }),
    ).toBe(false);
  });
});

describe("mapper devoirs #75 (défensif)", () => {
  test("description, contenu de cours et PJ : bornés, absents omis", async () => {
    const { reader } = await readerWith(fakeHomeworkClient());
    const page = await reader.getAssignments(syntheticAccountId);
    const a = page.items.value[0]!;
    expect(page.items.__untrusted).toBe(true);
    expect(isAssignment(a)).toBe(true);
    expect(a.description).toBe("Exos p.12 et rendre la fiche");
    expect(a.lessonContent).toEqual({ title: "Séance 1", excerpt: "Cours sur les fractions." });
    // PJ sans nom lisible ignorée, les autres passent par une ref opaque.
    expect(a.attachments).toEqual([REF]);
    expect(a.periodId).toBe("p-1");
    expect(a.weekId).toBeUndefined();
    expect(JSON.stringify(a)).not.toMatch(/https?:\/\//);
  });

  test("devoir minimal sans description/fichiers/séance : champs omis, pas de valeur bidon", async () => {
    const { reader } = await readerWith({
      homework: async () => [{ id: "h2", date: new Date("2026-10-06T08:00:00.000Z"), subject: { name: "SVT-Fake" } }],
      lessons: async () => [],
    });
    const a = (await reader.getAssignments(syntheticAccountId)).items.value[0]!;
    expect(isAssignment(a)).toBe(true);
    expect(a.title).toBe("Devoir");
    expect(a.description).toBeUndefined();
    expect(a.lessonContent).toBeUndefined();
    expect(a.attachments).toBeUndefined();
    expect(a.periodId).toBeUndefined();
  });

  test("séance sans contenu published : lessonContent omis (pas d'appel qui casse la lecture)", async () => {
    const { reader } = await readerWith(
      fakeHomeworkClient({
        lessons: async () => [
          {
            id: "l1",
            start: new Date("2026-10-05T08:00:00.000Z"),
            subject: { name: "Maths-Fake" },
            content: async () => {
              throw new Error("contenu indisponible");
            },
          },
        ],
      }),
    );
    const a = (await reader.getAssignments(syntheticAccountId)).items.value[0]!;
    expect(isAssignment(a)).toBe(true);
    expect(a.lessonContent).toBeUndefined();
  });
});

describe("toggle fait #75 (I7 : action APP confirmée)", () => {
  test("setDone appelé sur le bon devoir, retour = devoir à jour", async () => {
    calls.length = 0;
    const { reader } = await readerWith(fakeHomeworkClient());
    const updated = await reader.setAssignmentDone("", "h1", true);
    expect(calls).toEqual([true]);
    expect(updated.id).toBe("h1");
    expect(updated.done).toBe(true);
    expect(isAssignment(updated)).toBe(true);
  });

  test("devoir inconnu = 409 (not_found), pas de faux succès", async () => {
    const { reader } = await readerWith(fakeHomeworkClient());
    const err = await reader.setAssignmentDone(syntheticAccountId, "inconnu", true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PronoteWriteError);
    expect((err as PronoteWriteError).code).toBe("not_found");
  });

  test("session expirée = session_expired ; adaptateur sans écriture = unsupported", async () => {
    const { store, reader } = await readerWith(fakeHomeworkClient());
    store.invalidate(syntheticAccountId);
    const err = await reader.setAssignmentDone(syntheticAccountId, "h1", true).catch((e: unknown) => e);
    expect((err as PronoteWriteError).code).toBe("session_expired");
    const sansEcriture = await readerWith({
      homework: async () => [{ id: "h1", description: "x", date: new Date(), subject: { name: "M" } }],
      lessons: async () => [],
    });
    const err2 = await sansEcriture.reader.setAssignmentDone(syntheticAccountId, "h1", true).catch((e: unknown) => e);
    expect((err2 as PronoteWriteError).code).toBe("unsupported");
  });
});

describe("routes #75", () => {
  const seed = [
    { ...BASE, id: "a-mardi", dueDate: "2026-10-06T08:00:00.000Z", description: "fiche", attachments: [REF] },
    { ...BASE, id: "a-dimanche", dueDate: "2026-10-11T18:00:00.000Z" },
    { ...BASE, id: "a-ht", dueDate: "2026-10-15T08:00:00.000Z" },
  ];
  // /v1/assignments/toggle et /v1/media TOUCHENT Pronote : la route exige un
  // jeton d'appareil appairé (avant, n'importe quel processus de l'hôte
  // pouvait marquer un devoir « fait » ou lire les pièces d'un autre compte).
  // Le token n'est jamais exposé par l'API (seul `tokenHash` sort du confirm) :
  // ici il vient du service, comme le ferait le client appairé.
  // Renvoie le handler et l'en-tête `Authorization` du device appairé.
  function appaired(actions: unknown = null, media: unknown = null) {
    const pairing = new PairingService();
    const started = pairing.start("pixel-test");
    const confirmed = pairing.confirm(started.sessionId, started.code);
    if (!confirmed.ok) throw new Error("appairage de test impossible");
    const token = pairing.tokenOf(confirmed.device.id);
    if (token === null) throw new Error("jeton de test indisponible");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = createHandler(createMemoryStore({ assignments: seed }), pairing, null, undefined, undefined, actions as any, media as any);
    return { h, auth: { authorization: `Bearer ${token}` } };
  }
  const actions = {
    setAssignmentDone: async (_a: string, id: string, done: boolean) => ({ ...BASE, id, done }),
  };

  test("GET /v1/assignments : contenu + PJ conservés, filtre semaine, 400 sans reflet", async () => {
    // Depuis 0.4.0 la lecture exige le bearer d'un device appairé.
    const { h, auth } = appaired();
    const all = await (await h(new Request("http://127.0.0.1/v1/assignments", { headers: auth }))).json();
    expect(isAssignmentsResponse(all)).toBe(true);
    expect(all.assignments).toHaveLength(3);
    expect(all.assignments[0].description).toBe("fiche");
    expect(all.assignments[0].attachments[0].ref).toBe(REF.ref);
    // Semaine : lundi 2026-10-05 → dimanche 2026-10-11 inclus (borne haute 23:59).
    const week = await (
      await h(new Request("http://127.0.0.1/v1/assignments?weekStart=2026-10-05T00:00:00.000Z", { headers: auth }))
    ).json();
    expect(week.assignments.map((a: Assignment) => a.id)).toEqual(["a-mardi", "a-dimanche"]);
    const from = await (
      await h(new Request("http://127.0.0.1/v1/assignments?from=2026-10-07&to=2026-10-20", { headers: auth }))
    ).json();
    expect(from.assignments.map((a: Assignment) => a.id)).toEqual(["a-dimanche", "a-ht"]);
    const bad = await h(new Request("http://127.0.0.1/v1/assignments?weekStart=lundi", { headers: auth }));
    expect(bad.status).toBe(400);
    const badText = await bad.text();
    expect(isApiErrorBody(JSON.parse(badText))).toBe(true);
    expect(badText).not.toContain("lundi");
    // Fenêtre STRICTEMENT ISO : ni coercition lenient de Date.parse (« 12 » ->
    // 2001-12-01), ni junk collé à une date valide, ni paramètre géant. Un 400
    // typé, jamais une fenêtre devinée (le client croyait sa liste vide).
    for (const query of [
      "?from=12",
      "?to=2026",
      `?from=2026-10-07T00:00:00.000Z${"z".repeat(40)}`,
      `?weekStart=${"9".repeat(80)}`,
    ]) {
      const refuse = await h(new Request(`http://127.0.0.1/v1/assignments${query}`, { headers: auth }));
      expect({ query: query.slice(0, 24), status: refuse.status }).toEqual({ query: query.slice(0, 24), status: 400 });
      const corps = await refuse.text();
      expect(isApiErrorBody(JSON.parse(corps))).toBe(true);
      expect(corps).not.toContain("2026-10-07T00:00:00.000Zz");
    }
    // GET sur la route d'écriture = 405 (pas une écriture déguisée), avec Allow.
    const methode = await h(new Request("http://127.0.0.1/v1/assignments/toggle", { headers: auth }));
    expect(methode.status).toBe(405);
    expect(methode.headers.get("allow")).toBe("POST");
    // HEAD là où GET existe (sonde de taille de contenu).
    const head = await h(new Request("http://127.0.0.1/v1/assignments", { method: "HEAD", headers: auth }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("POST toggle : sans jeton 401 + zéro écriture, puis 200 + AssignmentUpdated, 501 sans adaptateur, 401 session expirée", async () => {
    const corps = JSON.stringify({ assignmentId: "a-mardi", done: true });
    // Écriture Pronote sans jeton d'appareil appairé : refus AVANT l'appel au
    // port d'écriture (le geste n'atteint jamais Pronote).
    let ecritures = 0;
    const { h: sansJeton } = appaired({
      setAssignmentDone: async (_a: string, id: string, done: boolean) => {
        ecritures += 1;
        return { ...BASE, id, done };
      },
    });
    const refuse = await sansJeton(
      new Request("http://127.0.0.1/v1/assignments/toggle", { method: "POST", body: corps }),
    );
    expect(refuse.status).toBe(401);
    expect(refuse.headers.get("www-authenticate")).not.toBeNull();
    expect({ ecritures }).toEqual({ ecritures: 0 });

    const { h, auth } = appaired(actions);
    const ok = await h(
      new Request("http://127.0.0.1/v1/assignments/toggle", {
        method: "POST",
        headers: auth,
        body: corps,
      }),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(isAssignmentsToggleResponse(body)).toBe(true);
    expect(body.assignment.done).toBe(true);
    expect(body.event.type).toBe("AssignmentUpdated");
    expect(isContractEvent(body.event)).toBe(true);

    const sansAdaptateur = appaired();
    expect(
      (await sansAdaptateur.h(
        new Request("http://127.0.0.1/v1/assignments/toggle", {
          method: "POST",
          headers: sansAdaptateur.auth,
          body: corps,
        }),
      )).status,
    ).toBe(501);

    for (const [code, expected] of [
      ["session_expired", 401],
      ["not_found", 409],
      ["unsupported", 501],
      ["network", 500],
    ] as const) {
      const cas = appaired({
        setAssignmentDone: async () => {
          throw new PronoteWriteError("x", code);
        },
      });
      const res = await cas.h(
        new Request("http://127.0.0.1/v1/assignments/toggle", {
          method: "POST",
          headers: cas.auth,
          body: corps,
        }),
      );
      expect({ code, status: res.status }).toEqual({ code, status: expected });
      expect(isApiErrorBody(await res.json())).toBe(true);
    }
    const bad = await h(
      new Request("http://127.0.0.1/v1/assignments/toggle", { method: "POST", headers: auth, body: "{pas json" }),
    );
    expect(bad.status).toBe(400);
  });

  test("GET /v1/media : proxy serveur sur le compte du SERVEUR, sans jeton 401, ref en URL refusée avant tout appel", async () => {
    const appels: string[] = [];
    const media = {
      download: async (accountId: string, ref: string) => {
        appels.push(`${accountId}|${ref}`);
        return { name: "fiche.pdf", bytes: new Uint8Array([1, 2, 3]) };
      },
    };
    // Sans jeton d'appareil appairé : 401 et ZÉRO résolution (le compte d'un
    // autre ne doit jamais pouvoir être ouvert par un appelant local).
    const { h, auth } = appaired(null, media);
    const anonime = await h(
      new Request("http://127.0.0.1/v1/media?accountId=acc1&ref=" + encodeURIComponent(REF.ref)),
    );
    expect(anonime.status).toBe(401);
    expect(appels).toEqual([]);

    const res = await h(
      new Request("http://127.0.0.1/v1/media?accountId=acc1&ref=" + encodeURIComponent(REF.ref), { headers: auth }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("fiche.pdf");
    // L'accountId de la query est IGNORÉ : le serveur résout son propre compte
    // (ici le compte appairé du store), jamais celui réclamé par le client.
    expect(appels).toEqual([`seed-acc|${REF.ref}`]);
    const sansRef = await h(new Request("http://127.0.0.1/v1/media", { headers: auth }));
    expect(sansRef.status).toBe(400);
    expect(appels).toHaveLength(1);
    // Le vrai proxy refuse une ref qui est une URL, sans sortir les octets.
    const sessions = {
      requireClient: () => {
        throw new Error("session");
      },
      currentAccountId: () => syntheticAccountId,
    };
    const err = await downloadMedia(
      sessions,
      "",
      "https://pronote.example.invalid/fichiers/x.pdf",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MediaProxyError);
    expect((err as MediaProxyError).code).toBe("bad_ref");
    // Adaptateur de port : accountId vide -> session appairée unique.
    const adapter = mediaActions({
      requireClient: () => ({
        homework: async () => [
          { id: "h1", files: () => [{ name: "fiche.pdf", data: async () => Buffer.from([1, 2, 3]) }] },
        ],
      }),
      currentAccountId: () => syntheticAccountId,
    });
    const bytes = await adapter.download("", "homework:0:file:0:f1");
    expect(bytes.name).toBe("fiche.pdf");
    expect([...bytes.bytes]).toEqual([1, 2, 3]);
  });

  test("I7 : aucun chemin depuis une sortie libre LLM vers l'écriture 'fait'", async () => {
    const AI_DIR = join(import.meta.dir, "..", "..", "server/ai");
    const forbidden = /setAssignmentDone|assignments\/toggle|AssignmentActions|PronoteWriteError/;
    for (const f of readdirSync(AI_DIR).filter((f) => f.endsWith(".ts"))) {
      expect({ file: f, forbidden: forbidden.test(readFileSync(join(AI_DIR, f), "utf8")) }).toEqual({
        file: f,
        forbidden: false,
      });
    }
    // Le client IA (unique port LLM) n'expose que generate() : pas d'écriture métier.
    const contracts = readFileSync(join(import.meta.dir, "..", "..", "shared/contracts/models.ts"), "utf8");
    expect(contracts).not.toContain("setAssignmentDone");
    // La seule porte d'entrée de l'écriture est la route (handler testée ci-dessus).
    const api = readFileSync(join(import.meta.dir, "..", "..", "server/api/assignments.ts"), "utf8");
    expect(api).toContain("actions.setAssignmentDone");
    expect(api).not.toMatch(/LLMProvider|server\/ai/);
  });
});