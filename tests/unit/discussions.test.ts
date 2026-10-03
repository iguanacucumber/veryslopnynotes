// Messagerie #80 : contrats add-only + bornes, mapper défensif, routes de
// lecture, et les 4 ÉCRITURES comme actions APP CONFIRMÉES (I7).
// Fixtures 100 % synthétiques (tests/unit/fixtures/discussions.ts) : aucun
// secret, aucune URL Pronote, aucune donnée perso.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  DISCUSSION_MAX_PARTICIPANTS,
  DISCUSSION_MAX_RECIPIENTS,
  DISCUSSION_MAX_UNREAD,
  DISCUSSION_PARTICIPANT_MAX_CHARS,
  DISCUSSION_SUBJECT_MAX_CHARS,
  MESSAGE_AUTHOR_MAX_CHARS,
  MESSAGE_BODY_MAX_CHARS,
  RECIPIENT_KINDS,
  isDiscussion,
  isMessage,
  isRecipient,
} from "../../shared/contracts/models";
import type { Discussion, Message, Recipient } from "../../shared/contracts/models";
import {
  DISCUSSION_MAX_BODY_CHARS,
  isDiscussionActionResponse,
  isDiscussionMessagesResponse,
  isDiscussionRecipientsResponse,
  isDiscussionsCreateRequest,
  isDiscussionsDeleteRequest,
  isDiscussionsReadStateRequest,
  isDiscussionsReplyRequest,
  isDiscussionsResponse,
} from "../../shared/contracts/api";
import { isContractEvent } from "../../shared/contracts/events";
import { isCacheableResource, CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { PronoteReadError, PronoteWriteError } from "../../server/domain/ports";
import { createHandler } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";
import { isApiErrorBody } from "../../server/api/errors";
import type { DiscussionActions } from "../../server/api/discussions";
import {
  resetDiscussionWrites,
  syntheticAdminRecipient,
  syntheticDiscussion,
  syntheticDiscussionAccountId,
  syntheticDiscussionNoUnread,
  syntheticDiscussionsClient,
  syntheticDiscussionsOk,
  syntheticInjectionMessage,
  syntheticMessage,
  syntheticMessagesOk,
  syntheticPronoteDiscussion,
  syntheticPronoteMessage,
  syntheticPronoteRecipient,
  syntheticRecipient,
  syntheticRecipientsOk,
  writableDiscussion,
  writes,
} from "./fixtures/discussions";
import {
  syntheticAccountId,
  syntheticEntKind,
  syntheticPassword,
  syntheticUsername,
} from "./fixtures/pronote";

const creds = {
  accountId: syntheticAccountId,
  username: syntheticUsername,
  password: syntheticPassword,
  entKind: syntheticEntKind,
};

/** Code hors commentaires : le test I7 porte sur le CODE, pas sur la prose (#79). */
const codeOnly = (c: string): string =>
  c
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .map((l) => {
      const idx = l.search(/(?<!:)\/\//);
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join("\n");

async function readerWith(client: unknown, logger?: (message: string) => void) {
  const store = new PronoteSessionStore({
    pronoteUrl: "https://example.test/pronote/eleve.html",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientFactory: (async () => client) as never,
  });
  await store.authenticate({ ...creds, entKind: "ninegate" });
  return { store, reader: new PronoteClientReader({ sessions: store, logger }) };
}

describe("contrats messagerie #80", () => {
  test("modèles valides, champs absents = non publiés (jamais de valeur devinée)", () => {
    expect(isDiscussion(syntheticDiscussion)).toBe(true);
    // unreadCount/lastMessageAt absents = l'ENT ne publie rien, pas 0.
    expect(isDiscussion(syntheticDiscussionNoUnread)).toBe(true);
    expect(isDiscussion({ ...syntheticDiscussion, unreadCount: 0 })).toBe(true);
    expect(isDiscussion({ ...syntheticDiscussion, unreadCount: -1 })).toBe(false);
    expect(isDiscussion({ ...syntheticDiscussion, unreadCount: DISCUSSION_MAX_UNREAD + 1 })).toBe(false);
    expect(isDiscussion({ ...syntheticDiscussion, unreadCount: 1.5 })).toBe(false);
    expect(isDiscussion({ ...syntheticDiscussion, subject: "  " })).toBe(false);
    expect(isDiscussion({ ...syntheticDiscussion, subject: "s".repeat(DISCUSSION_SUBJECT_MAX_CHARS + 1) })).toBe(false);
    expect(isDiscussion({ ...syntheticDiscussion, updatedAt: "hier" })).toBe(false);
    expect(isDiscussion({ ...syntheticDiscussion, participants: "Mme Fake" })).toBe(false);
    expect(isDiscussion({ ...syntheticDiscussion, participants: ["a", "a"] })).toBe(false);
    expect(
      isDiscussion({
        ...syntheticDiscussion,
        participants: new Array(DISCUSSION_MAX_PARTICIPANTS + 1).fill("Mme Fake"),
      }),
    ).toBe(false);
    expect(
      isDiscussion({ ...syntheticDiscussion, participants: ["n".repeat(DISCUSSION_PARTICIPANT_MAX_CHARS + 1)] }),
    ).toBe(false);

    expect(isMessage(syntheticMessage)).toBe(true);
    // Auteur absent = message du compte appairé (aucun nom deviné).
    expect(isMessage(syntheticInjectionMessage)).toBe(true);
    expect(isMessage({ ...syntheticMessage, body: "  " })).toBe(false);
    expect(isMessage({ ...syntheticMessage, body: "b".repeat(MESSAGE_BODY_MAX_CHARS + 1) })).toBe(false);
    expect(isMessage({ ...syntheticMessage, authorName: "a".repeat(MESSAGE_AUTHOR_MAX_CHARS + 1) })).toBe(false);
    expect(isMessage({ ...syntheticMessage, authorName: 42 })).toBe(false);
    expect(isMessage({ ...syntheticMessage, sentAt: "hier" })).toBe(false);
    expect(isMessage({ ...syntheticMessage, discussionId: "" })).toBe(false);

    expect(isRecipient(syntheticRecipient)).toBe(true);
    expect(isRecipient({ ...syntheticRecipient, kind: "vie-scolaire" })).toBe(false);
    expect(isRecipient({ ...syntheticRecipient, displayName: " " })).toBe(false);
    expect(RECIPIENT_KINDS).toContain("student");
  });

  test("pièce jointe de message : réf opaque, jamais une URL (règle d'or média)", () => {
    const ref = { id: "f1", label: "fiche.pdf", ref: "discussion:d1:file:0:f1" };
    expect(isMessage({ ...syntheticMessage, attachments: [ref] })).toBe(true);
    for (const bad of [
      "https://pronote.example.invalid/fichiers/x.pdf",
      "http://example.invalid/fichiers/x.pdf",
      "//example.invalid/fichiers/x.pdf",
      "data:application/pdf;base64,AAAA",
      "r".repeat(201),
    ]) {
      expect({ bad, ok: isMessage({ ...syntheticMessage, attachments: [{ ...ref, ref: bad }] }) }).toEqual({
        bad,
        ok: false,
      });
    }
  });

  test("réponses de lecture : listes validées, champs contraints", () => {
    expect(isDiscussionsResponse(syntheticDiscussionsOk)).toBe(true);
    expect(isDiscussionsResponse({ discussions: [] })).toBe(true);
    expect(isDiscussionsResponse({ discussions: [{ ...syntheticDiscussion, id: "" }] })).toBe(false);
    expect(isDiscussionsResponse({ discussions: "non" })).toBe(false);
    expect(isDiscussionMessagesResponse(syntheticMessagesOk)).toBe(true);
    expect(isDiscussionMessagesResponse({ messages: [{ ...syntheticMessage, body: 42 }] })).toBe(false);
    expect(isDiscussionRecipientsResponse(syntheticRecipientsOk)).toBe(true);
    expect(isDiscussionRecipientsResponse({ recipients: [{ ...syntheticRecipient, kind: "x" }] })).toBe(false);
  });

  test("requêtes d'écriture : corps borné, champs exigés", () => {
    expect(isDiscussionsCreateRequest({ subject: "Sortie", body: "Merci.", recipientIds: ["r1"] })).toBe(true);
    expect(isDiscussionsCreateRequest({ accountId: "acc1", subject: "S", body: "B", recipientIds: ["r1", "r2"] })).toBe(true);
    expect(isDiscussionsCreateRequest({ subject: "S", body: "B", recipientIds: [] })).toBe(false);
    expect(isDiscussionsCreateRequest({ subject: "S", body: "B", recipientIds: ["r1", "r1"] })).toBe(false);
    expect(
      isDiscussionsCreateRequest({
        subject: "S",
        body: "B",
        recipientIds: new Array(DISCUSSION_MAX_RECIPIENTS + 1).fill("r"),
      }),
    ).toBe(false);
    expect(isDiscussionsCreateRequest({ subject: " ", body: "B", recipientIds: ["r1"] })).toBe(false);
    expect(isDiscussionsCreateRequest({ subject: "S", body: "b".repeat(MESSAGE_BODY_MAX_CHARS + 1), recipientIds: ["r1"] })).toBe(false);
    expect(isDiscussionsCreateRequest({ subject: "S", body: "B", recipientIds: ["r1"], accountId: "x".repeat(65) })).toBe(false);

    expect(isDiscussionsReplyRequest({ discussionId: "d1", body: "Merci." })).toBe(true);
    expect(isDiscussionsReplyRequest({ discussionId: "d1", body: " " })).toBe(false);
    expect(isDiscussionsReplyRequest({ body: "Merci." })).toBe(false);
    expect(isDiscussionsReadStateRequest({ discussionId: "d1", read: true })).toBe(true);
    expect(isDiscussionsReadStateRequest({ discussionId: "d1", read: "oui" })).toBe(false);
    expect(isDiscussionsDeleteRequest({ discussionId: "d1" })).toBe(true);
    expect(isDiscussionsDeleteRequest({ discussionId: "d1", read: true })).toBe(true);
    expect(isDiscussionsDeleteRequest({})).toBe(false);
    // Le plafond de corps laisse passer un message au contrat maximal + ids.
    expect(DISCUSSION_MAX_BODY_CHARS).toBeGreaterThan(MESSAGE_BODY_MAX_CHARS);
  });

  test("réponse d'action : ok + CacheInvalidated(discussions), rien d'autre", () => {
    const at = "2026-10-04T07:00:00.000Z";
    const event = {
      v: CONTRACTS_VERSION,
      type: "CacheInvalidated",
      at,
      data: { resource: "discussions", reason: "manual" },
    };
    expect(isContractEvent(event)).toBe(true);
    expect(isDiscussionActionResponse({ ok: true, event })).toBe(true);
    // Un autre type d'événement = refusé : une action ne devient pas un autre effet.
    expect(isDiscussionActionResponse({ ok: true, event: { ...event, type: "SyncCompleted" } })).toBe(false);
    // Une autre ressource invalidée = refusé (le cache doit être celui des fils).
    expect(
      isDiscussionActionResponse({ ok: true, event: { ...event, data: { resource: "grades", reason: "manual" } } }),
    ).toBe(false);
    expect(isDiscussionActionResponse({ ok: false, event })).toBe(false);
    expect(isDiscussionActionResponse({ ok: true })).toBe(false);
  });

  test("cache : ressource discussions cachable (liste), purgée au logout", () => {
    expect(isCacheableResource("discussions")).toBe(true);
    expect(CACHE_TTL_MS.discussions).toBe(15 * 60 * 1000);
    expect(cacheStatus("discussions", 1_000, 1_000 + CACHE_TTL_MS.discussions)).toBe("fresh");
    expect(cacheStatus("discussions", 1_000, 1_000 + CACHE_TTL_MS.discussions + 1)).toBe("stale");
    // La purge totale du logout (#82) passe par clearAll(), donc "discussions"
    // disparaît avec les autres : aucune donnée de messagerie après déconnexion.
    const logout = readFileSync(
      join(import.meta.dir, "..", "..", "android/data/src/main/java/fr/veryslopnynotes/data/AccountStore.kt"),
      "utf8",
    );
    expect(logout).toContain("cacheStore.clearAll()");
  });
});

describe("mapper messagerie #80 (défensif)", () => {
  test("fils + participants + dates : champs absents omis", async () => {
    const { reader } = await readerWith(syntheticDiscussionsClient());
    const page = await reader.getDiscussions(syntheticAccountId);
    expect(page.items.__untrusted).toBe(true);
    const all: Discussion[] = page.items.value;
    expect(all.every(isDiscussion)).toBe(true);
    expect(all[0]?.id).toBe("d-fake-1");
    expect(all[0]?.participants).toEqual(["Mme Claire Fake", "M. Alex Fake"]);
    expect(all[0]?.unreadCount).toBe(2);
    expect(all[0]?.lastMessageAt).toBe("2026-10-03T09:00:00.000Z");
    // Aucun contenu de message dans la liste : le corps ne sort que du fil.
    expect(JSON.stringify(all)).not.toContain("consigne systeme");
  });

  test("onglet Discussions absent ou en erreur = page VIDE, jamais une exception", async () => {
    const sansTab = await readerWith(syntheticDiscussionsClient({ tab: false }));
    const vide = await sansTab.reader.getDiscussions(syntheticAccountId);
    expect(vide.items.value).toEqual([]);
    const enErreur = await readerWith(syntheticDiscussionsClient({ listFail: true }));
    expect((await enErreur.reader.getDiscussions(syntheticAccountId)).items.value).toEqual([]);
    const sansDestinataires = await readerWith(syntheticDiscussionsClient({ recipientsFail: true }));
    // Destinataires indisponibles = liste vide (onglet masqué côté app).
    expect((await sansDestinataires.reader.getDiscussionRecipients(syntheticAccountId)).items.value).toEqual([]);
  });

  test("session expirée : la lecture la remonte (l'app se ré-appaire)", async () => {
    const { store, reader } = await readerWith(syntheticDiscussionsClient());
    store.invalidate(syntheticAccountId);
    const err = await reader.getDiscussions(syntheticAccountId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PronoteReadError);
    expect((err as PronoteReadError).code).toBe("session_expired");
  });

  test("messages : bornés, auteur absent omis, fil inconnu = page vide", async () => {
    const { reader } = await readerWith(
      syntheticDiscussionsClient({ threads: [writableDiscussion("d-fake-1")] }),
    );
    const page = await reader.getDiscussionMessages(syntheticAccountId, "d-fake-1");
    expect(page.items.value.every(isMessage)).toBe(true);
    expect(page.items.value[0]?.authorName).toBe("Mme Claire Fake");
    // 2e message = injection : DONNÉE conservée telle quelle, jamais interprétée.
    expect(page.items.value[1]?.authorName).toBeUndefined();
    expect(page.items.value[1]?.body).toBe(syntheticInjectionMessage.body);
    expect((await reader.getDiscussionMessages(syntheticAccountId, "inconnu")).items.value).toEqual([]);
    expect((await reader.getDiscussionMessages(syntheticAccountId, "  ")).items.value).toEqual([]);
  });

  test("participants/messages illisibles : champs omis, fil toujours listé", async () => {
    const { reader } = await readerWith(
      syntheticDiscussionsClient({
        threads: [syntheticPronoteDiscussion({ failParticipants: true, failMessages: true })],
      }),
    );
    const d = (await reader.getDiscussions(syntheticAccountId)).items.value[0]!;
    expect(isDiscussion(d)).toBe(true);
    expect(d.participants).toEqual([]);
    expect(d.lastMessageAt).toBeUndefined();
    // Horodatage de lecture (jamais 1970 ni une date devinée hors contrat).
    expect(Number.isNaN(Date.parse(d.updatedAt))).toBe(false);
  });

  test("fil sans identifiant ou non-lus hors borne : ignoré / compteur omis", async () => {
    const { reader } = await readerWith(
      syntheticDiscussionsClient({
        threads: [
          { subject: "sans id", participants: async () => [], messages: async () => [] },
          syntheticPronoteDiscussion({ id: "d-fake-9", unread: -4 }),
          syntheticPronoteDiscussion({ id: "d-fake-10", unread: "beaucoup" }),
          null,
        ],
      }),
    );
    const all = (await reader.getDiscussions(syntheticAccountId)).items.value;
    expect(all.map((d) => d.id)).toEqual(["d-fake-9", "d-fake-10"]);
    expect(all.every((d) => d.unreadCount === undefined)).toBe(true);
  });

  test("destinataires : types mappés, doublons écartés", async () => {
    const { reader } = await readerWith(
      syntheticDiscussionsClient({
        recipients: [
          syntheticPronoteRecipient(),
          syntheticPronoteRecipient({ id: "r-fake-2", name: "Vie scolaire Fake", type: "staff" }),
          syntheticPronoteRecipient(),
          syntheticPronoteRecipient({ id: "", name: "sans id" }),
        ],
      }),
    );
    const page = await reader.getDiscussionRecipients(syntheticAccountId);
    expect(page.items.value.every(isRecipient)).toBe(true);
    expect(page.items.value).toEqual([syntheticRecipient, syntheticAdminRecipient]);
  });
});

describe("routes #80", () => {
  function handler(actions: DiscussionActions | null = null) {
    return createHandler(
      createMemoryStore({
        discussions: [syntheticDiscussion, syntheticDiscussionNoUnread],
        discussionMessages: [syntheticMessage, syntheticInjectionMessage],
        discussionRecipients: [syntheticRecipient],
      }),
      undefined,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      actions as any,
    );
  }

  test("GET : fils, messages d'un fil, destinataires (store sans données = vide)", async () => {
    const h = handler();
    const list = await h(new Request("http://127.0.0.1/v1/discussions"));
    expect(list.status).toBe(200);
    const payload = await list.json();
    expect(isDiscussionsResponse(payload)).toBe(true);
    expect(payload.discussions).toHaveLength(2);
    const body = JSON.stringify(payload);
    expect(body).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    expect(body).not.toMatch(/sk-or-v1-|PRONOTE_PASSWORD/);

    const msgs = await h(new Request("http://127.0.0.1/v1/discussions/messages?id=d-fake-1"));
    expect(isDiscussionMessagesResponse(await msgs.json())).toBe(true);
    // Un autre fil = liste vide (jamais les messages d'un autre fil).
    const other = await h(new Request("http://127.0.0.1/v1/discussions/messages?id=d-fake-2"));
    expect((await other.json()).messages).toEqual([]);
    expect((await h(new Request("http://127.0.0.1/v1/discussions/messages"))).status).toBe(400);

    const rec = await h(new Request("http://127.0.0.1/v1/discussions/recipients"));
    expect(isDiscussionRecipientsResponse(await rec.json())).toBe(true);

    // Store sans messagerie (établissement sans onglet) = 200 + listes vides.
    const vide = createHandler(createMemoryStore());
    expect((await (await vide(new Request("http://127.0.0.1/v1/discussions"))).json()).discussions).toEqual([]);
    expect((await (await vide(new Request("http://127.0.0.1/v1/discussions/recipients"))).json()).recipients).toEqual([]);
  });

  test("POST create/reply/read-state/delete : 200 + CacheInvalidated", async () => {
    resetDiscussionWrites();
    const actions: DiscussionActions = {
      createDiscussion: async (_a, subject, body, to) => {
        writes.created.push({ subject, message: body, to });
      },
      replyToDiscussion: async (_a, id, body) => {
        writes.replies.push({ id, body });
      },
      setDiscussionRead: async (_a, id, read) => {
        writes.readStates.push({ id, read });
      },
      deleteDiscussion: async (_a, id) => {
        writes.deleted.push(id);
      },
    };
    const h = handler(actions);
    const cases: [string, Record<string, unknown>][] = [
      ["/v1/discussions", { subject: "Sortie", body: "Merci.", recipientIds: ["r-fake-1"] }],
      ["/v1/discussions/reply", { discussionId: "d-fake-1", body: "Je serai là." }],
      ["/v1/discussions/read-state", { discussionId: "d-fake-1", read: true }],
      ["/v1/discussions/delete", { discussionId: "d-fake-1" }],
    ];
    for (const [path, body] of cases) {
      const res = await h(new Request(`http://127.0.0.1${path}`, { method: "POST", body: JSON.stringify(body) }));
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      const json = await res.json();
      expect(isDiscussionActionResponse(json)).toBe(true);
      expect(json.event.type).toBe("CacheInvalidated");
      expect(json.event.data.resource).toBe("discussions");
      // Le message d'erreur n'est jamais réutilisé : réponse = confirmation.
      expect(json).not.toHaveProperty("error");
    }
    expect(writes.created).toEqual([{ subject: "Sortie", message: "Merci.", to: ["r-fake-1"] }]);
    expect(writes.replies).toEqual([{ id: "d-fake-1", body: "Je serai là." }]);
    expect(writes.readStates).toEqual([{ id: "d-fake-1", read: true }]);
    expect(writes.deleted).toEqual(["d-fake-1"]);
  });

  test("écriture indisponible = 501, corps hors contrat = 400 (jamais de faux succès)", async () => {
    const h = handler();
    const bodies: [string, Record<string, unknown>][] = [
      ["/v1/discussions", { subject: "Sortie", body: "Merci.", recipientIds: ["r-fake-1"] }],
      ["/v1/discussions/reply", { discussionId: "d-fake-1", body: "Coucou" }],
      ["/v1/discussions/read-state", { discussionId: "d-fake-1", read: true }],
      ["/v1/discussions/delete", { discussionId: "d-fake-1" }],
    ];
    for (const [path, body] of bodies) {
      const res = await h(new Request(`http://127.0.0.1${path}`, { method: "POST", body: JSON.stringify(body) }));
      expect({ path, status: res.status }).toEqual({ path, status: 501 });
      expect(isApiErrorBody(await res.json())).toBe(true);
    }
    // Corps invalide avec adaptateur présent : 400, et AUCUNE écriture.
    resetDiscussionWrites();
    const withActions = handler({
      createDiscussion: async () => {
        writes.created.push({ subject: "", message: "", to: [] });
      },
      replyToDiscussion: async () => {
        writes.replies.push({ id: "", body: "" });
      },
      setDiscussionRead: async () => {
        writes.readStates.push({ id: "", read: false });
      },
      deleteDiscussion: async () => {
        writes.deleted.push("x");
      },
    });
    const invalid: [string, string][] = [
      ["/v1/discussions", "{pas json"],
      ["/v1/discussions", JSON.stringify({ subject: "S", body: "B" })],
      ["/v1/discussions/reply", JSON.stringify({ discussionId: "d1", body: " " })],
      ["/v1/discussions/read-state", JSON.stringify({ discussionId: "d1", read: "oui" })],
      ["/v1/discussions/delete", JSON.stringify({})],
      ["/v1/discussions/delete", "x".repeat(DISCUSSION_MAX_BODY_CHARS + 1)],
    ];
    for (const [path, body] of invalid) {
      const res = await withActions(
        new Request(`http://127.0.0.1${path}`, { method: "POST", body }),
      );
      expect({ path, status: res.status }).toEqual({ path, status: 400 });
      const text = await res.text();
      expect(isApiErrorBody(JSON.parse(text))).toBe(true);
      // Aucun input reflété dans le message d'erreur.
      expect(text).not.toContain("d1");
      expect(text.length).toBeLessThan(200);
    }
    expect({ writes: { ...writes, created: writes.created.length, replies: writes.replies.length, readStates: writes.readStates.length, deleted: writes.deleted.length } })
      .toEqual({ writes: { created: 0, replies: 0, readStates: 0, deleted: 0 } });
    // GET sur une route d'écriture = 405 (pas une écriture déguisée).
    expect((await withActions(new Request("http://127.0.0.1/v1/discussions/reply"))).status).toBe(405);
    // Adaptateur qui n'expose PAS l'action demandée = 501 (pas un faux 400/succès).
    const partiel = handler({
      replyToDiscussion: async () => {},
    } as unknown as DiscussionActions);
    const manquant = await partiel(
      new Request("http://127.0.0.1/v1/discussions", {
        method: "POST",
        body: JSON.stringify({ subject: "Sortie", body: "Merci.", recipientIds: ["r-fake-1"] }),
      }),
    );
    expect(manquant.status).toBe(501);
    expect(isApiErrorBody(await manquant.json())).toBe(true);
  });

  test("erreurs Pronote typées : 401 / 409 / 501 / 500, jamais de détail brut", async () => {
    const cases: [PronoteWriteError["code"], number][] = [
      ["session_expired", 401],
      ["not_found", 409],
      ["unsupported", 501],
      ["network", 500],
    ];
    for (const [code, expected] of cases) {
      const h = handler({
        createDiscussion: async () => {
          throw new PronoteWriteError("interne secret", code);
        },
        replyToDiscussion: async () => {
          throw new PronoteWriteError("interne secret", code);
        },
        setDiscussionRead: async () => {
          throw new PronoteWriteError("interne secret", code);
        },
        deleteDiscussion: async () => {
          throw new PronoteWriteError("interne secret", code);
        },
      });
      const res = await h(
        new Request("http://127.0.0.1/v1/discussions/reply", {
          method: "POST",
          body: JSON.stringify({ discussionId: "d-fake-1", body: "Coucou" }),
        }),
      );
      expect({ code, status: res.status }).toEqual({ code, status: expected });
      const text = await res.text();
      expect(isApiErrorBody(JSON.parse(text))).toBe(true);
      // Jamais le message de la lib (détail interne) ni l'input.
      expect(text).not.toContain("interne secret");
      expect(text).not.toContain("Coucou");
    }
    // Exception non typée = 500 typé, pas de fuite.
    const boom = handler({
      replyToDiscussion: async () => {
        throw new Error("stack interne Pronote");
      },
    } as unknown as DiscussionActions);
    const res = await boom(
      new Request("http://127.0.0.1/v1/discussions/reply", {
        method: "POST",
        body: JSON.stringify({ discussionId: "d-fake-1", body: "Coucou" }),
      }),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("stack interne");
  });
});

describe("écritures #80 via le reader (session Pronote serveur)", () => {
  test("reply / read-state / delete : la lib est appelée, journal sans contenu", async () => {
    resetDiscussionWrites();
    const logs: string[] = [];
    const { reader } = await readerWith(
      syntheticDiscussionsClient({ threads: [writableDiscussion("d-fake-1")] }),
      (m) => logs.push(m),
    );
    await reader.replyToDiscussion("", "d-fake-1", "Je serai là.");
    await reader.setDiscussionRead("", "d-fake-1", true);
    await reader.deleteDiscussion("", "d-fake-1");
    expect(writes.replies).toEqual([{ id: "d-fake-1", body: "Je serai là." }]);
    expect(writes.readStates).toEqual([{ id: "d-fake-1", read: true }]);
    expect(writes.deleted).toEqual(["d-fake-1"]);
    // Aucun contenu de message dans les logs (PII, I6).
    expect(logs.join(" ")).not.toContain("Je serai là");
  });

  test("create : destinataires résolus côté serveur, id inconnu = 409", async () => {
    resetDiscussionWrites();
    const { reader } = await readerWith(syntheticDiscussionsClient());
    await reader.createDiscussion(syntheticAccountId, "Sortie", "Merci.", ["r-fake-1"]);
    expect(writes.created).toEqual([{ subject: "Sortie", message: "Merci.", to: ["r-fake-1"] }]);
    const err = await reader
      .createDiscussion(syntheticAccountId, "Sortie", "Merci.", ["r-inconnu"])
      .catch((e: unknown) => e);
    expect((err as PronoteWriteError).code).toBe("not_found");
    expect(writes.created).toHaveLength(1);
  });

  test("adaptateur sans écriture = unsupported (jamais un faux succès)", async () => {
    resetDiscussionWrites();
    const { store, reader } = await readerWith(
      syntheticDiscussionsClient({ threads: [{ id: "d-fake-1", subject: "S", participants: async () => [], messages: async () => [] }] }),
    );
    const codes: string[] = [];
    for (const call of [
      () => reader.replyToDiscussion(syntheticAccountId, "d-fake-1", "Coucou"),
      () => reader.setDiscussionRead(syntheticAccountId, "d-fake-1", true),
      () => reader.deleteDiscussion(syntheticAccountId, "d-fake-1"),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PronoteWriteError);
      codes.push((err as PronoteWriteError).code);
    }
    expect(codes).toEqual(["unsupported", "unsupported", "unsupported"]);
    store.invalidate(syntheticAccountId);
    const err = await reader.replyToDiscussion(syntheticAccountId, "d-fake-1", "Coucou").catch((e: unknown) => e);
    expect((err as PronoteWriteError).code).toBe("session_expired");
  });

  test("fil fermé : 409 (not_found), pas un 500 opaque", async () => {
    resetDiscussionWrites();
    const { reader } = await readerWith(
      syntheticDiscussionsClient({
        threads: [
          syntheticPronoteDiscussion({
            id: "d-fake-1",
            reply: async () => {
              // pronotets fixe `name = DiscussionClosed` sur son exception.
              const closed = new Error("Cannot reply to discussion");
              closed.name = "DiscussionClosed";
              throw closed;
            },
          }),
        ],
      }),
    );
    const err = await reader.replyToDiscussion(syntheticAccountId, "d-fake-1", "Coucou").catch((e: unknown) => e);
    expect((err as PronoteWriteError).code).toBe("not_found");
  });
});

describe("I7 + I6 : la messagerie n'est pas un effet de bord de sortie LLM", () => {
  const AI_DIR = join(import.meta.dir, "..", "..", "server/ai");
  const WRITE_SYMBOLS = /createDiscussion|replyToDiscussion|setDiscussionRead|deleteDiscussion|DiscussionActions|discussions\/(reply|read-state|delete)/;

  test("I7 : aucun symbole d'écriture de messagerie atteignable depuis server/ai/", () => {
    const files = readdirSync(AI_DIR).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const src = codeOnly(readFileSync(join(AI_DIR, f), "utf8"));
      expect({ file: f, forbidden: WRITE_SYMBOLS.test(src) }).toEqual({ file: f, forbidden: false });
    }
    // Aucun type d'événement nouveau : la liste fermée reste inchangée.
    const events = readFileSync(join(import.meta.dir, "..", "..", "shared/contracts/events.ts"), "utf8");
    expect(events).not.toMatch(/DiscussionCreated|MessageSent|DiscussionUpdated/);
  });

  test("I6 : le corps d'un message n'atteint jamais server/ai/", () => {
    for (const f of readdirSync(AI_DIR).filter((f) => f.endsWith(".ts"))) {
      const src = codeOnly(readFileSync(join(AI_DIR, f), "utf8"));
      // Ni la messagerie, ni ses modèles, ni son texte dans le module IA.
      expect({ file: f, discussions: /discussion|message\b/i.test(src) }).toEqual({ file: f, discussions: false });
      expect(src).not.toContain("Discussion");
      expect(src).not.toContain("MESSAGE_BODY_MAX_CHARS");
    }
    // Les modèles de messagerie ne sont importés par aucun module IA.
    const models = readFileSync(join(import.meta.dir, "..", "..", "shared/contracts/models.ts"), "utf8");
    expect(models).toContain("MESSAGE_BODY_MAX_CHARS = 4000");
  });

  test("I7 : le handler d'écriture ne dépend d'aucun LLMProvider", () => {
    const src = codeOnly(readFileSync(join(import.meta.dir, "..", "..", "server/api/discussions.ts"), "utf8"));
    expect(src).not.toMatch(/LLMProvider|server\/ai/);
    expect(src).toContain("actions.replyToDiscussion");
    expect(src).toContain("actions.createDiscussion");
    expect(src).toContain("actions.setDiscussionRead");
    expect(src).toContain("actions.deleteDiscussion");
    // Le seul événement produit est l'invalidation de cache existante.
    expect(src).toContain("CacheInvalidated");
    expect(src).not.toMatch(/\.send\(|push\(|notify|Bun\.serve|fetch\s*\(/);
  });

  test("I7 : aucune écriture de messagerie depuis un port de LECTURE", () => {
    const ports = readFileSync(join(import.meta.dir, "..", "..", "server/domain/ports.ts"), "utf8");
    const reader = ports.slice(ports.indexOf("export interface PronoteReader"));
    // Lecture seule : ni création, ni réponse, ni suppression dans PronoteReader.
    for (const symbol of ["createDiscussion", "replyToDiscussion", "setDiscussionRead", "deleteDiscussion"]) {
      expect({ symbol, inReader: reader.includes(symbol) }).toEqual({ symbol, inReader: false });
    }
    expect(reader).toContain("getDiscussions?");
    expect(reader).toContain("getDiscussionMessages?");
    // Le corps d'un message est une DONNÉE marquée Untrusted par la page.
    expect(reader).toContain("PronotePage<Message>");
  });
});