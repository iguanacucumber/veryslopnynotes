// Revue adversariale des handlers API par feature (server/api/homework.ts,
// revision.ts, assignments.ts, discussions.ts, subject-prefs.ts, sync-refresh.ts).
// Chaque test cible UN bug et doit être ROUGE sur le code actuel.
// Aucun réseau (faux reader / faux store de kv / faux LLM), aucun secret,
// données synthétiques uniquement. Aucun fichier source n'est modifié ici.
import { afterEach, describe, expect, test } from "bun:test";
import type { ContractEvent } from "../../shared/contracts/events";
import type { LLMProvider, Untrusted } from "../../server/domain/ports";
import type { ExamCandidate } from "../../server/jobs/exams";
import type { DiscussionActions, DiscussionWriteKind } from "../../server/api/discussions";
import type { RevisionKv } from "../../server/jobs/revision";
import type { SyncRefreshActions } from "../../server/api/sync-refresh";
import { handleDiscussionWrite } from "../../server/api/discussions";
import { handleHomeworkGenerate } from "../../server/api/homework";
import { handleSyncRefresh } from "../../server/api/sync-refresh";
import {
  createAndSaveRevision,
  persistRevisionSheet,
  readAllRevisionSheets,
} from "../../server/api/revision";
import { createSubjectPrefsMemoryStore } from "../../server/api/subject-prefs";

// Horodatages figés : aucun Date.now() caché, aucun sommeil dans ces tests.
const AT = "2026-10-02T07:00:00.000Z";
const AT2 = "2026-10-03T07:00:00.000Z";

// Journal du serveur (createApp) : on l'assourdit le temps du test, puis on le
// restaure, pour qu'un échec affiche le diff et non des lignes de log.
const logReel = console.log;
afterEach(() => {
  console.log = logReel;
});

/** Faux LLM : compte les appels et renvoie un refus valide (sources insuffisantes). */
function fauxLlm(): { appels: () => number; llm: LLMProvider } {
  let appels = 0;
  return {
    appels: () => appels,
    llm: {
      async generate(_prompt: { system: string; data: Untrusted<string>[] }): Promise<string> {
        appels += 1;
        return JSON.stringify({ status: "refused", reason: "sources_insuffisantes", sources: [] });
      },
    },
  };
}

describe("bugs handlers API (revue adversariale)", () => {
  // 1. AUTHZ : l'accountId du client est accepté tel quel sur le pull-refresh, et
  //    la composition root l'utilise pour OUVRIR une session Pronote : un POST
  //    non authentifié crée une session pour un id que personne n'a appairé et
  //    casse l'invariant mono-compte (currentAccountId() = null avec 2 sessions),
  //    donc plus aucune résolution de session côté lecture/écriture.
  test("BUG: POST /v1/sync/refresh ouvre une session Pronote pour l'accountId fourni par le client — un POST non appairé casse la résolution mono-compte (currentAccountId() passe à null)", async () => {
    const env = {
      PRONOTE_URL: "https://example.test/pronote/eleve.html",
      PRONOTE_USERNAME: "fake-user-UNREAL",
      PRONOTE_PASSWORD: "fake-pw-9x8y7z-UNREAL",
      PRONOTE_ENT_KIND: "ninegate",
    };
    const ALIAS = "alias-injecte-par-le-client";
    // Vrai PronoteSessionStore, fausse factory : le SSO est simulé, zéro réseau.
    // `renew` câblé exactement comme server/infrastructure/http.ts.
    const { createApp } = await import("../../server/infrastructure/http");
    const { PronoteSessionStore } = await import("../../server/integrations/pronote-sessions");
    const sessions = new PronoteSessionStore({
      pronoteUrl: env.PRONOTE_URL,
      renew: async (target: string) => {
        await sessions.authenticate({
          accountId: target,
          username: env.PRONOTE_USERNAME,
          password: env.PRONOTE_PASSWORD,
          entKind: env.PRONOTE_ENT_KIND,
        });
      },
      clientFactory: (async () => ({
        grades: async () => [],
        homework: async () => [],
        lessons: async () => [],
      })) as never,
    });
    const pageVide = <T,>(value: T[]) => ({
      items: { __untrusted: true, value } as Untrusted<T[]>,
      nextCursor: null,
    });
    const reader = {
      getGrades: async () => pageVide([]),
      getAssignments: async () => pageVide([]),
      getTimetable: async () => pageVide([]),
    };
    const app = createApp(env, { sessions, reader });
    console.log = () => {};
    await app.warmup();
    const compteAppaire = app.sessions?.currentAccountId();
    expect(compteAppaire).toBeTruthy();

    // Le client envoie l'accountId de SON choix : le serveur doit viser la session
    // appairée (comme le fait une requête sans accountId), jamais un id inventé.
    const res = await app.handler(
      new Request("http://127.0.0.1/v1/sync/refresh", {
        method: "POST",
        body: JSON.stringify({ accountId: ALIAS }),
      }),
    );
    expect(res.status).toBe(200);
    // ROUGE : une session Pronote a été ouverte pour un id jamais appairé, et la
    // résolution mono-compte du serveur est désormais cassée (null = 0 ou >=2).
    expect(app.sessions?.isAuthenticated(ALIAS)).toBe(false);
    expect(app.sessions?.currentAccountId()).toBe(compteAppaire);
  });

  // 2. DONNÉES : clé de prefs matière = nom brut, sans normalisation. Deux
  //    orthographes de la même matière ("Maths" / "maths") deviennent DEUX
  //    entrées : le PUT ne remplace plus la prefs existante et l'app affiche
  //    deux chips pour une matière (le garde-fou SUBJECT_PREFS_MAX_COUNT est
  //    contournable de la même façon).
  test("BUG: clé de prefs matière non normalisée — un PUT « maths » en creates une seconde entrée au lieu de remplacer celle de « Maths »", () => {
    const store = createSubjectPrefsMemoryStore([]);
    store.upsert({ subject: "Maths", color: "#112233", updatedAt: AT });
    store.upsert({ subject: "maths", color: "#445566", updatedAt: AT2 });

    const lus = store.list();
    // ROUGE : deux entrées pour une seule matière (l'upsert n'a pas été un upsert).
    expect(lus).toHaveLength(1);
    expect(lus[0]?.color).toBe("#445566");
  });

  // 3. ERREUR AVALÉE : une relecture qui ne renvoie pas une liste d'événements
  //    (adaptateur en panne, retour `undefined`) devient un 200 « events: [] ».
  //    L'app interpretant « aucun événement » comme « rien n'a changé », elle
  //    garde son cache périmé et affiche un refresh réussi qui n'a pas eu lieu.
  test("BUG: une relecture qui ne renvoie pas de tableau d'événements est répondue 200 { events: [] } — le client croit que rien n'a changé et garde son cache périmé", async () => {
    const actions = {
      refresh: async () => undefined as unknown as ContractEvent[],
    } as SyncRefreshActions;
    const res = await handleSyncRefresh(
      new Request("http://127.0.0.1/v1/sync/refresh", { method: "POST" }),
      actions,
    );
    // ROUGE : 200 + events vide = faux succès (un 500 « invalid payload », comme
    // les autres handlers face à une sortie non contractuelle, est attendu).
    expect(res.status).toBe(500);
  });

  // 4. DOS / COÛT : seul handler d'écriture sans borne de taille de corps AVANT
  //    parse (toggle, messagerie, refresh et prefs en ont une). Un POST
  //    non authentifié de taille arbitraire est entièrement bufferisé puis
  //    accepté : les clés inconnues ne sont ni validées ni bornées par
  //    isHomeworkGenerateRequest, donc la requête part au LLM.
  test("BUG: corps de POST /v1/homework/generate non borné avant parse — un corps géant est accepté (200) et déclenche un appel LLM", async () => {
    const faux = fauxLlm();
    const corpsGeant = JSON.stringify({
      question: "combien font 1/2 + 1/4 ?",
      sources: [],
      // Clé inconnue : ni validée ni bornée par le contrat.
      bourrage: "x".repeat(2_000_000),
    });
    const res = await handleHomeworkGenerate(
      new Request("http://127.0.0.1/v1/homework/generate", { method: "POST", body: corpsGeant }),
      faux.llm,
    );
    // ROUGE : 200 + appel LLM (le handler doit refuser un corps hors borne).
    expect(res.status).toBe(400);
    expect(faux.appels()).toBe(0);
  });

  // 5. DATE : le jour affiché d'une fiche (titre, PDF, push) est le jour UTC de
  //    l'instant. Un DS du 15 à 00h30 locales = 14 à 23h30 UTC : la fiche est
  //    datée du 14 alors que l'élève et l'établissement sont le 15.
  test("BUG: le jour d'une fiche de révision est le jour UTC, pas le jour Europe/Paris — un DS du 15 à 00h30 locales est daté du 14", () => {
    const exam: ExamCandidate = {
      source: "assignment",
      id: "e1",
      subject: "Maths",
      // 14 à 23h30 UTC = 15 à 00h30 en Europe/Paris (CET, +1).
      date: "2026-01-14T23:30:00.000Z",
      confidence: "high",
      matched: "ds",
    };
    const store = { list: () => [], get: () => undefined, save: () => {} };
    const sheet = createAndSaveRevision(store, exam, "corps de fiche", ["source-a"], AT);
    const jourParis = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
      new Date(exam.date),
    );
    expect(jourParis).toBe("2026-01-15");
    // ROUGE : le titre annonce 2026-01-14 (jour UTC).
    expect(sheet.title).toContain("2026-01-15");
  });

  // 6. PERTE DE DONNÉES : l'index des fiches est réécrit « à vide » quand son
  //    JSON est illisible (écriture partielle, quota). Les fiches déjà stockées
  //    sous leur clé restent dans le kv mais disparaissent de la liste : l'API
  //    répond une liste vide alors que les données existent (silence sur la perte).
  test("BUG: index de fiches révision corrompu — les fiches déjà stockées disparaissent silencieusement de la liste (le kv les contient encore)", async () => {
    const kvData = new Map<string, Uint8Array>();
    const kv: RevisionKv = {
      get: async (key) => kvData.get(key) ?? null,
      set: async (key, value) => {
        kvData.set(key, value);
      },
    };
    const examA: ExamCandidate = {
      source: "assignment",
      id: "e1",
      subject: "Maths",
      date: "2026-10-05T08:00:00.000Z",
      confidence: "high",
      matched: "ds",
    };
    const sansEcriture = { list: () => [], get: () => undefined, save: () => {} };
    const a = createAndSaveRevision(sansEcriture, examA, "corps A", ["source-a"], AT);
    await persistRevisionSheet(kv, a);
    expect((await readAllRevisionSheets(kv)).map((s) => s.id)).toEqual(["fiche-e1"]);

    // Index corrompu (écriture partielle), puis nouvelle fiche.
    kvData.set("revision:index", new TextEncoder().encode("{pas-du-json"));
    const b = createAndSaveRevision(
      sansEcriture,
      { ...examA, id: "e2" },
      "corps B",
      ["source-b"],
      AT2,
    );
    await persistRevisionSheet(kv, b);

    // ROUGE : « fiche-e1 » est encore dans le kv mais plus listée (donnée
    // invisible pour l'app), donc l'API ment sur l'état du stock.
    expect((await readAllRevisionSheets(kv)).map((s) => s.id).sort()).toEqual(["fiche-e1", "fiche-e2"]);
  });

  // 7. SUCCÈS FACTICE : le switch des 4 actions de messagerie n'a pas de `default`.
  //    Un `kind` inconnu (route ajoutée côté routeur, appel non typé) traverse le
  //    switch sans rien écrire et reçoit quand même { ok: true } + invalidation :
  //    l'app purge son cache de messagerie et croit l'action partie.
  test("BUG: handleDiscussionWrite sans case par défaut — un kind inconnu renvoie { ok: true } sans avoir rien écrit", async () => {
    let ecritures = 0;
    const actions: DiscussionActions = {
      createDiscussion: async () => {
        ecritures += 1;
      },
      replyToDiscussion: async () => {
        ecritures += 1;
      },
      setDiscussionRead: async () => {
        ecritures += 1;
      },
      deleteDiscussion: async () => {
        ecritures += 1;
      },
    };
    const res = await handleDiscussionWrite(
      new Request("http://127.0.0.1/v1/discussions", {
        method: "POST",
        body: JSON.stringify({ subject: "Sujet", body: "Message", recipientIds: ["r1"] }),
      }),
      actions,
      "kind-inconnu" as DiscussionWriteKind,
    );
    const body = (await res.json()) as { ok?: boolean; event?: ContractEvent };
    // ROUGE : 200 + ok:true alors qu'aucune écriture n'est partie.
    expect(res.status).not.toBe(200);
    expect(body.ok).not.toBe(true);
    expect(body.event?.v).toBeUndefined();
    expect(ecritures).toBe(0);
  });
});

// Note : le même manque de borne avant parse existe sur POST /v1/sync/refresh
// (server/api/sync-refresh.ts:53 lit `req.text()` en entier puis compare la
// longueur), mais le test 4 porte sur le handler totalement dépourvu de borne.
