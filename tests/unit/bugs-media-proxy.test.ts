// Chasse aux bugs (revue adversariale) sur server/infrastructure/media-proxy.ts.
// Zéro réseau réel : `globalThis.fetch` est stubbé (lève si called) puis
// restauré, et toute l'E2E passe par un faux client pronotets injecté via
// `sessions.requireClient`. Données synthétiques, aucun secret.
// Un bug par test ; le nom dit le mécanisme et l'impact. Chaque test est
// volontairement ROUGE sur le code actuel (bug Proof), vert après correction.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { downloadMedia, MediaProxyError } from "../../server/infrastructure/media-proxy";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";

const FAKE_ACCOUNT = "acc-fake-bug";
const OTHER_ACCOUNT = "acc-fake-bug-2";

const realFetch = globalThis.fetch;

beforeEach(() => {
  // Le proxy ne doit jamais sortir en HTTP direct (I1 : URL Pronote côté
  // serveur uniquement, via la session). Si un jour un fetch nu apparaît ici,
  // ce stub le rend bruyamment au lieu de toucher le réseau.
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    throw new Error(`BUG: fetch direct depuis media-proxy : ${url}`);
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Pièce jointe factice : `id` sert à prouver que la ref n'est pas respectée. */
function file(name: string, bytes: number[], id: string) {
  return { id, name, data: async () => Buffer.from(bytes) };
}

/** Leçon factice : une liste de pièces jointes indexées (ordre = index de la ref). */
function lesson(id: string, files: { name: string; bytes: number[]; id: string }[]) {
  return {
    id,
    subject: { name: "Maths" },
    homeworkDocuments: files.map((f) => file(f.name, f.bytes, f.id)),
    content: async () => ({ files: () => files.map((f) => file(f.name, f.bytes, f.id)) }),
  };
}

/** Store de sessions factice : un client pronotets par accountId. */
function store(clients: Record<string, unknown>) {
  return {
    requireClient: (accountId: string) => {
      const c = clients[accountId];
      if (!c) throw new Error("session expired");
      return c;
    },
    currentAccountId: () => FAKE_ACCOUNT,
  };
}

/** Capture le code d'erreur typé sans laisser remonter l'exception. */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => "resolved",
    (e: unknown) => (e instanceof MediaProxyError ? e.code : `unexpected:${String(e)}`),
  );
  return err;
}

/** Résolution complète : nom + octets réellement servis, ou code d'erreur. */
async function resoudre(
  sessions: ReturnType<typeof store>,
  ref: string,
): Promise<{ code: string; name?: string; bytes?: number[] }> {
  return downloadMedia(sessions, FAKE_ACCOUNT, ref).then(
    (r) => ({ code: "ok", name: r.name, bytes: Array.from(r.bytes) }),
    (e: unknown) => ({ code: e instanceof MediaProxyError ? e.code : `unexpected:${String(e)}` }),
  );
}

describe("media-proxy — bugs adversariaux", () => {
  test("BUG: la ref n'est pas une capacité — une ref forgée (index + fileId inventés) télécharge une PJ jamais exposée à l'app", async () => {
    // Oracle = le vrai listeur : getResources n'émet que des refs pour les
    // 60 premières leçons (enrichissement `raw.slice(0, 60)`).
    const lessons = Array.from({ length: 61 }, (_, i) => ({
      id: `L${i}`,
      subject: { name: "Maths" },
      homeworkDocuments: [file(`cours-${i}.pdf`, [i], `FID-${i}`)],
    }));
    const sessions = store({ [FAKE_ACCOUNT]: { lessons: async () => lessons, homework: async () => [] } });
    const reader = new PronoteClientReader({ sessions });
    const listed = (await reader.getResources(FAKE_ACCOUNT, { limit: 100 })).items.value.map((r) => r.ref);
    expect(listed).toContain("lesson:59:doc:0:FID-59");
    expect(listed).not.toContain("lesson:60:doc:0:whatever");

    // Ref forgée : index 60 (hors liste) + fileId qui n'existe nulle part.
    // Le proxy résout purement par index (le fileId de la ref est ignoré) et
    // renvoie les octets => énumération complète des PJ du compte par
    // tâtonnement d'index.
    const got = await codeOf(downloadMedia(sessions, FAKE_ACCOUNT, "lesson:60:doc:0:FORGED-NOT-A-FILE-ID"));
    expect(got).toBe("not_found");
  });

  test("BUG: la ref ne porte pas l'accountId — une ref émise pour le compte A servie sur le compte B renvoie les octets de B", async () => {
    const shared = [{ name: "devoir.pdf", bytes: [1], id: "FID-SHARED" }];
    const sessions = store({
      [FAKE_ACCOUNT]: { lessons: async () => [lesson("LA", shared)], homework: async () => [] },
      [OTHER_ACCOUNT]: { lessons: async () => [lesson("LB", [{ name: "secret-b.pdf", bytes: [42], id: "FID-B" }])], homework: async () => [] },
    });
    // Ref issue du compte A (`lesson:0:doc:0:FID-SHARED`) mais demandée avec
    // l'accountId du compte B : rien ne vérifie le lien ref -> compte.
    const res = await downloadMedia(sessions, OTHER_ACCOUNT, "lesson:0:doc:0:FID-SHARED");
    expect(res.name).toBe("devoir.pdf");
  });

  test("BUG: la ref est un index dans une liste re-téléchargée — un cours inséré en amont décale les index et sert silencieusement une AUTRE PJ", async () => {
    // Au moment du listage : [L0 (sans PJ), L1 (cible.pdf)] -> ref émise
    // `lesson:1:doc:0:FID-B`. Entre-temps l'établissement publie un nouveau cours en
    // tête de liste. Au téléchargement, l'index 1 désigne un autre cours.
    const atListing = [
      { id: "L0", subject: { name: "Maths" }, homeworkDocuments: [], content: async () => ({ files: () => [] }) },
      lesson("L1", [{ name: "cible.pdf", bytes: [7], id: "FID-B" }]),
    ];
    const issued = (() => {
      // Index de listing = position dans `atListing`.
      return atListing.map((l, li) => (l.homeworkDocuments as { id: string }[]).map((d, di) => `lesson:${li}:doc:${di}:${d.id}`)).flat();
    })();
    expect(issued).toEqual(["lesson:1:doc:0:FID-B"]);

    // Propriété : la ref ne vaut que pour le fichier qu'elle NOME. La liste
    // dérivée expose autre-cours.pdf à l'index 1 et plus jamais FID-B, donc la
    // ref est caduque (not_found) ; servir les octets du voisin reviendrait à
    // faire porter une PJ jamais exposée à l'app.
    const afterInsert = [
      lesson("Lnew", [{ name: "nouveau.pdf", bytes: [9], id: "FID-NEW" }]),
      lesson("L0", [{ name: "autre-cours.pdf", bytes: [8], id: "FID-AUTRE" }]),
    ];
    const sessions = store({ [FAKE_ACCOUNT]: { lessons: async () => afterInsert, homework: async () => [] } });
    const decale = await resoudre(sessions, "lesson:1:doc:0:FID-B");
    expect(decale.code === "ok" ? `servi ${decale.name} ${JSON.stringify(decale.bytes)}` : decale.code).toBe(
      "not_found",
    );

    // Contre-épreuve : la même ref sur une liste inchangée sert BIEN le fichier
    // qu'elle nomme (un « toujours not_found » ne passe pas).
    const inchange = store({ [FAKE_ACCOUNT]: { lessons: async () => atListing, homework: async () => [] } });
    expect(await resoudre(inchange, "lesson:1:doc:0:FID-B")).toEqual({
      code: "ok",
      name: "cible.pdf",
      bytes: [7],
    });
  });

  test("BUG: une session expirée pendant le download est écrasée en pronote_unavailable — 500 au lieu de 401, l'app n'est jamais invitée à se ré-appairer", async () => {
    // Toute lecture du repo mappe session/expired -> session_expired
    // (toReadError, ports.ts) ; le proxy lui renvoie 500 « media unavailable ».
    const sessions = store({
      [FAKE_ACCOUNT]: {
        lessons: async () => {
          throw new Error("session expired");
        },
        homework: async () => [],
      },
    });
    expect(await codeOf(downloadMedia(sessions, FAKE_ACCOUNT, "lesson:0:doc:0:FID"))).toBe("session_expired");
  });

  test("BUG: aucune renewal de session avant lecture (refreshSession jamais appelé) — le download échoue sur une session presque expirée au lieu d'être transparentement renouvelé", async () => {
    let refreshCalls = 0;
    const sessions = {
      requireClient: () => ({ lessons: async () => [lesson("L0", [{ name: "cours.pdf", bytes: [1], id: "FID" }])], homework: async () => [] }),
      // Contrat réel de PronoteSessionStore (#87) : renewal 5 min avant lecture.
      refreshSession: async (_accountId: string) => {
        refreshCalls += 1;
      },
    };
    const res = await downloadMedia(sessions, FAKE_ACCOUNT, "lesson:0:doc:0:FID");
    expect(refreshCalls).toBe(1);
    expect(res.name).toBe("cours.pdf");
  });

  test("BUG: aucun timeout ni abort sur le téléchargement — une PJ qui ne répond jamais laisse la requête HTTP ouverte indéfiniment", async () => {
    // data() ne résout jamais : toutes les autres lectures ont un AbortSignal
    // (PronoteHttpClient, llm-openrouter, push-provider), pas celle-ci.
    const sessions = store({
      [FAKE_ACCOUNT]: {
        lessons: async () => [
          { id: "L0", subject: { name: "Maths" }, homeworkDocuments: [{ name: "bloque.pdf", data: () => new Promise<Buffer>(() => {}) }], content: async () => ({ files: () => [] }) },
        ],
        homework: async () => [],
      },
    });
    // L'échéance (30 s par défaut, calée sur une PJ Pronote réelle) est pinée
    // ici par option : sans knob, ce test ne tiendrait qu'avec un défaut
    // artificiellement court.
    const HANG = Symbol("hang");
    const settled = await Promise.race([
      codeOf(downloadMedia(sessions, FAKE_ACCOUNT, "lesson:0:doc:0:FID", undefined, { timeoutMs: 50 })),
      new Promise((r) => setTimeout(() => r(HANG), 500)),
    ]);
    expect(settled).not.toBe(HANG);
  });
});