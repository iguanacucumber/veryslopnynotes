// e2e messagerie #80 (parité Papillon, onglet Discussions).
// Zéro réseau réel, zéro .env.local, zéro secret : store seedé + client Pronote
// injecté. Parcours complet : store -> GET /v1/discussions (+ messages,
// destinataires) -> réponse / création / lu-non-lu / suppression CONFIRMÉS par
// l'app (I7) -> invalidation de cache via l'événement EXISTANT.
import { describe, expect, test } from "bun:test";
import {
  isDiscussionActionResponse,
  isDiscussionMessagesResponse,
  isDiscussionRecipientsResponse,
  isDiscussionsResponse,
} from "../../shared/contracts/api";
import { isDiscussion, isMessage } from "../../shared/contracts/models";
import { CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import { createHandler } from "../../server/api/router";
import { pairedDevice } from "../unit/fixtures/pairing";
import { createMemoryStore } from "../../server/api/store";
import { isApiErrorBody } from "../../server/api/errors";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { PronoteWriteError } from "../../server/domain/ports";
import {
  resetDiscussionWrites,
  syntheticDiscussion,
  syntheticDiscussionsClient,
  syntheticMessage,
  syntheticRecipient,
  writableDiscussion,
  writes,
} from "../unit/fixtures/discussions";
import { syntheticAccountId, syntheticEntKind, syntheticPassword, syntheticUsername } from "../unit/fixtures/pronote";

const creds = {
  accountId: syntheticAccountId,
  username: syntheticUsername,
  password: syntheticPassword,
  entKind: syntheticEntKind,
};

async function handlerWithClient(options: { tab?: boolean } = {}) {
  const client = syntheticDiscussionsClient({ tab: options.tab, threads: [writableDiscussion("d-fake-1")] });
  const sessions = new PronoteSessionStore({
    pronoteUrl: "https://example.test/pronote/eleve.html",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientFactory: (async () => client) as never,
  });
  await sessions.authenticate({ ...creds, entKind: "ninegate" });
  const reader = new PronoteClientReader({ sessions });
  // Depuis 0.4.0 les routes #80 exigent le bearer d'un device appairé.
  const { pairing, auth } = pairedDevice();
  const handler = createHandler(
    createMemoryStore({
      discussions: [syntheticDiscussion],
      discussionMessages: [syntheticMessage],
      discussionRecipients: [syntheticRecipient],
      // 0.4.0 : le routeur résout le compte servi (servedAccountId) et le
      // passe au port. Ici le store ne doit donc PAS porter le compte seedé
      // « seed-acc » : le compte est celui de la session appairée (acc-fake-1).
      grades: [{ id: "g-fake-1", accountId: syntheticAccountId, subject: "Maths-Fake", value: 12, scale: 20, date: "2026-10-01T08:00:00.000Z" }],
      assignments: [],
    }),
    pairing,
    null,
    undefined,
    undefined,
    undefined,
    undefined,
    null,
    reader as never,
  );
  return { handler, sessions, auth };
}

const post = (auth: Record<string, string>, path: string, body: unknown) =>
  new Request(`http://127.0.0.1${path}`, { method: "POST", headers: auth, body: JSON.stringify(body) });

describe("e2e messagerie #80", () => {
  test("lectures : fils, messages, destinataires — aucune URL Pronote dans la réponse", async () => {
    const { handler, auth } = await handlerWithClient();
    const list = await handler(new Request("http://127.0.0.1/v1/discussions", { headers: auth }));
    expect(list.status).toBe(200);
    const body = await list.text();
    expect(isDiscussionsResponse(JSON.parse(body))).toBe(true);
    expect(JSON.parse(body).discussions[0].subject).toBe(syntheticDiscussion.subject);
    expect(body).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    expect(body).not.toMatch(/sk-or-v1-|OPENROUTER_API_KEY|PRONOTE_PASSWORD/);

    const msgs = await handler(new Request("http://127.0.0.1/v1/discussions/messages?id=d-fake-1", { headers: auth }));
    expect(isDiscussionMessagesResponse(await msgs.json())).toBe(true);
    const rec = await handler(new Request("http://127.0.0.1/v1/discussions/recipients", { headers: auth }));
    expect(isDiscussionRecipientsResponse(await rec.json())).toBe(true);

    // Cache : liste des fils seulement, TTL 15 min comme les devoirs.
    expect(cacheStatus("discussions", 1_000_000, 1_000_000 + CACHE_TTL_MS.discussions)).toBe("fresh");
    expect(cacheStatus("discussions", 1_000_000, 1_000_000 + CACHE_TTL_MS.discussions + 1)).toBe("stale");
  });

  test("parcours d'écriture confirmé par l'app : reply, create, read-state, delete", async () => {
    resetDiscussionWrites();
    const { handler, auth } = await handlerWithClient();
    const calls: [string, unknown][] = [
      ["/v1/discussions/reply", { discussionId: "d-fake-1", body: "Je serai la." }],
      ["/v1/discussions", { subject: "Question", body: "Merci de repondre.", recipientIds: ["r-fake-1"] }],
      ["/v1/discussions/read-state", { discussionId: "d-fake-1", read: true }],
      ["/v1/discussions/delete", { discussionId: "d-fake-1" }],
    ];
    for (const [path, body] of calls) {
      const res = await handler(post(auth, path, body));
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      const json = await res.json();
      expect(isDiscussionActionResponse(json)).toBe(true);
      // Invalidation par l'événement EXISTANT (aucun type d'événement nouveau).
      expect(json.event.type).toBe("CacheInvalidated");
      expect(json.event.data).toEqual({ resource: "discussions", reason: "manual" });
    }
    expect(writes.replies).toEqual([{ id: "d-fake-1", body: "Je serai la." }]);
    expect(writes.created).toEqual([
      { subject: "Question", message: "Merci de repondre.", to: ["r-fake-1"] },
    ]);
    expect(writes.readStates).toEqual([{ id: "d-fake-1", read: true }]);
    expect(writes.deleted).toEqual(["d-fake-1"]);
  });

  test("refus propres : session expirée 401, fil inconnu 409, écriture absente 501", async () => {
    resetDiscussionWrites();
    const { handler, sessions, auth } = await handlerWithClient();
    // Fil inconnu : la session vit, le fil n'existe pas → 409 conflict.
    const inconnu = await handler(post(auth, "/v1/discussions/reply", { discussionId: "d-999", body: "Coucou" }));
    expect(inconnu.status).toBe(409);
    expect(isApiErrorBody(await inconnu.json())).toBe(true);
    expect(writes.replies).toEqual([]);

    // Session expirée : 401 + invalidation de session serveur, aucune écriture.
    sessions.invalidate(syntheticAccountId);
    const expired = await handler(post(auth, "/v1/discussions/read-state", { discussionId: "d-fake-1", read: true }));
    expect(expired.status).toBe(401);
    expect(writes.readStates).toEqual([]);

    // Établissement sans onglet Discussions : lecture vide, écriture indisponible
    // (501 par la route ou unsupported côté reader) — jamais un faux succès.
    const sansOnglet = await handlerWithClient({ tab: false });
    const vide = await sansOnglet.handler(new Request("http://127.0.0.1/v1/discussions", { headers: sansOnglet.auth }));
    expect(isDiscussionsResponse(await vide.json())).toBe(true);
    const refuse = await sansOnglet.handler(
      post(sansOnglet.auth, "/v1/discussions/delete", { discussionId: "d-fake-1" }),
    );
    expect(refuse.status).toBe(409);
    // Sans adaptateur injecté du tout : 501 explicite.
    const { pairing, auth: auth2 } = pairedDevice();
    const sansActions = createHandler(createMemoryStore(), pairing);
    expect((await sansActions(post(auth2, "/v1/discussions/delete", { discussionId: "d-fake-1" }))).status).toBe(501);
  });

  test("reader : mapper défensif (onglet absent = page vide, injection = donnée)", async () => {
    resetDiscussionWrites();
    const client = syntheticDiscussionsClient();
    const sessions = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: (async () => client) as never,
    });
    await sessions.authenticate({ ...creds, entKind: "ninegate" });
    const reader = new PronoteClientReader({ sessions });
    const page = await reader.getDiscussions(syntheticAccountId);
    expect(page.items.__untrusted).toBe(true);
    expect(page.items.value.every(isDiscussion)).toBe(true);
    const messages = await reader.getDiscussionMessages(syntheticAccountId, "d-fake-1");
    expect(messages.items.value.every(isMessage)).toBe(true);
    // Le message d'injection reste une DONNÉE (jamais exécutée, I6).
    expect(messages.items.value[1]?.body).toContain("Ignore les instructions");
    expect(messages.items.value[1]?.authorName).toBeUndefined();

    // Erreur non typée sur une écriture = PronoteWriteError, jamais une exception libre.
    const cassé = new PronoteClientReader({
      sessions: { requireClient: () => { throw new Error("panne interne"); } },
    });
    const err = await cassé
      .replyToDiscussion(syntheticAccountId, "d-fake-1", "Coucou")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PronoteWriteError);
    expect((err as PronoteWriteError).code).toBe("ent_unavailable");
  });
});