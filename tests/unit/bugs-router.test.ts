// Revue adversariale du routeur API (server/api/router.ts + store.ts + errors.ts).
// UN test = UN bug, nommé `BUG: <quoi> — <pourquoi ça compte>`, trié par gravité.
// Pilotage 100 % en mémoire : des `Request` construits ici, jamais de réseau
// (même approche que tests/unit/http-wiring.test.ts). Données synthétiques,
// aucun secret.
import { describe, expect, test } from "bun:test";
import { createHandler } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";
import type { ReadStore } from "../../server/api/store";
import { apiError, isApiErrorBody } from "../../server/api/errors";
import { SnapshotStore } from "../../server/infrastructure/snapshot-store";
import type { AssignmentActions } from "../../server/api/assignments";
import type { LLMProvider } from "../../server/domain/ports";

describe("bugs routeur API", () => {
  // --- 1. fuite inter-comptes : /v1/media lit l'accountId dans l'URL ---------
  test("BUG: /v1/media prend l'accountId dans la query et l'ouvre tel quel — n'importe quel appelant du serveur local récupère les pièces jointes / la photo d'un AUTRE compte appairé", async () => {
    const appels: string[] = [];
    const media = {
      download: async (accountId: string, ref: string) => {
        appels.push(`${accountId}|${ref}`);
        // Octets synthétiques : une PJ déjà résolue par la session du compte visé.
        return { name: "photo.png", bytes: new Uint8Array([137, 80, 78, 71]) };
      },
    };
    const h = createHandler(createMemoryStore(), undefined, null, undefined, undefined, undefined, media);
    const res = await h(
      new Request("http://127.0.0.1/v1/media?accountId=compte-victime&ref=photo:4242"),
    );
    // Attendu : 401 sans jeton de device appairé, et AUCUNE session d'un autre
    // compte ouverte (l'accountId doit être résolu côté serveur, pas lu dans l'URL).
    expect(res.status).toBe(401);
    expect(appels).toEqual([]);
  });

  // --- 2. écriture Pronote sans aucun contrôle d'authentification -----------
  test("BUG: POST /v1/assignments/toggle exécute l'écriture sans vérifier le jeton appairé — n'importe quel processus de l'hôte marque des devoirs \"fait\" sur le compte appairé", async () => {
    const ecritures: string[] = [];
    const actions: AssignmentActions = {
      setAssignmentDone: async (accountId, assignmentId, done) => {
        ecritures.push(`${accountId}|${assignmentId}|${done}`);
        return {
          id: assignmentId,
          accountId: accountId === "" ? "acc-pairé" : accountId,
          subject: "Maths",
          title: "Exos",
          dueDate: "2026-10-05T08:00:00.000Z",
          done,
        };
      },
    };
    const h = createHandler(createMemoryStore(), undefined, null, undefined, undefined, actions);
    const res = await h(
      new Request("http://127.0.0.1/v1/assignments/toggle", {
        method: "POST",
        body: JSON.stringify({ assignmentId: "a-1", done: true }),
      }),
    );
    // Attendu : 401 + zéro écriture Pronote déclenchée.
    expect(res.status).toBe(401);
    expect(ecritures).toEqual([]);
  });

  // --- 3. clé héritée d'Object.prototype -> rejet de promesse --------------
  test("BUG: /v1/discussions/messages?id=toString passe un id utilisateur dans une table indexée par objet — structuredClone lève DataCloneError et la promesse du handler rejette (500 sans corps d'erreur typé)", async () => {
    const h = createHandler(new SnapshotStore() as unknown as ReadStore);
    const outcome = await h(new Request("http://127.0.0.1/v1/discussions/messages?id=toString")).then(
      (r) => ({ status: r.status as number | null, erreur: null as string | null }),
      (e: unknown) => ({ status: null as number | null, erreur: e instanceof Error ? e.name : String(e) }),
    );
    // Attendu : une RÉPONSE HTTP 4xx (fil inconnu), jamais une exception.
    expect(outcome.status).not.toBeNull();
    expect(outcome.status ?? 0).toBeGreaterThanOrEqual(400);
  });

  // --- 4. coercition de query param : Date.parse est lenient ---------------
  test("BUG: /v1/assignments?from=12 est accepté (V8 coerce \"12\" en 2001-12-01) au lieu de 400 — le client filtre sa fenêtre sur une date fantôme et croit la liste vide", async () => {
    const h = createHandler(createMemoryStore());
    const res = await h(new Request("http://127.0.0.1/v1/assignments?from=12"));
    // Attendu : 400 bad_request, jamais une fenêtre devinée à partir de junk.
    expect(res.status).toBe(400);
    expect(isApiErrorBody(await res.json())).toBe(true);
  });

  // --- 5. SSE : accountId codé en dur dans le payload d'événement ----------
  test("BUG: GET /v1/events annonce toujours accountId \"seed-acc\" dans SyncCompleted — les données de tout compte sont attribuées à la constante de seed", async () => {
    const store = createMemoryStore({
      grades: [
        {
          id: "g-1",
          accountId: "acc-alpha",
          subject: "Maths",
          value: 12,
          scale: 20,
          date: "2026-09-20T10:00:00.000Z",
        },
      ],
    });
    const h = createHandler(store);
    const res = await h(new Request("http://127.0.0.1/v1/events"));
    const premiere = (await res.text()).split("\n\n")[0] ?? "";
    const evt = JSON.parse(premiere.replace("data: ", "")) as { type: string; data: { accountId: string } };
    expect(evt.type).toBe("SyncCompleted");
    // Attendu : le compte réellement servi, pas une constante du module.
    expect(evt.data.accountId).toBe("acc-alpha");
  });

  // --- 6. 405 sans en-tête Allow (RFC 9110 §15.5.6) -----------------------
  test("BUG: le 405 du routeur ne pose aucun en-tête Allow — un client ne sait pas quelles méthodes sont permises sur la route", async () => {
    const h = createHandler(createMemoryStore());
    const res = await h(new Request("http://127.0.0.1/v1/subjects/prefs", { method: "DELETE" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, PUT");
  });

  // --- 7. HEAD refusé partout (RFC 9110 §9.3.2 : HEAD obligatoire) ----------
  test("BUG: HEAD /v1/health renvoie 405 au lieu de 200 — toute sonde de disponibilité ou de taille de contenu (pdf, média) est cassée", async () => {
    const h = createHandler(createMemoryStore());
    const res = await h(new Request("http://127.0.0.1/v1/health", { method: "HEAD" }));
    expect(res.status).toBe(200);
  });

  // --- 8. corps non borné avant parse sur /v1/homework/generate -----------
  test("BUG: POST /v1/homework/generate parse un corps non borné (req.json sans plafond, contrairement aux 4 autres routes d'écriture) — 2 Mo de données ignorées sont acceptées puis traitées", async () => {
    const llm: LLMProvider = {
      generate: async () => JSON.stringify({ status: "refused", reason: "sources_insuffisantes", sources: [] }),
    };
    const h = createHandler(createMemoryStore(), undefined, llm);
    const corps = JSON.stringify({
      question: "q",
      sources: [{ text: "t", source: "s" }],
      junk: "x".repeat(2_000_000),
    });
    const res = await h(
      new Request("http://127.0.0.1/v1/homework/generate", { method: "POST", body: corps }),
    );
    // Attendu : 400, le corps est borné AVANT le parse comme partout ailleurs.
    expect(res.status).toBe(400);
  });

  // --- 9. 401 sans défi d'authentification (errors.ts) ---------------------
  test("BUG: apiError(\"unauthorized\") renvoie un 401 sans en-tête WWW-Authenticate — le client ne peut pas savoir quel jeton presenter", () => {
    const res = apiError("unauthorized", "session expirée");
    expect(res.headers.get("www-authenticate")).not.toBeNull();
  });
});