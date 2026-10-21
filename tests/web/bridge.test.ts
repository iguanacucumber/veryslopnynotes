// Contrat du pont côté web (#371).
//
// Deux fautes se sontompées : le timeout JS (30 s) était PLUS COURT que
// l'attente native (45 s pour `llm.askHomework`), donc la réponse native
// arrivait après l'abandon et se perdait ; et l'abandon ne informait pas le
// natif, qui continuait de tourner en gardant le verrou d'appairage.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { call, pendingCount } from "../../web/src/bridge/client";
import {
  BRIDGE_TIMEOUTS,
  DEFAULT_TIMEOUT_MS,
  MAX_NATIVE_WAIT_MS,
  MAX_PARALLEL_READS,
  NATIVE_WAIT_MS,
  type SessionStatus,
} from "../../web/src/bridge/types";

const ROOT = join(import.meta.dir, "..", "..");
const BRIDGE = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt");
const HTTP = join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote/HttpSession.kt");

interface NativeCall {
  requestId: string;
  method: string;
  params: Record<string, unknown>;
}

const nativeCalls: NativeCall[] = [];

/** Faux pont natif : enregistre les appels, ne répond jamais tout seul. */
function stubNative(): void {
  nativeCalls.length = 0;
  const g = globalThis as unknown as {
    VSN?: { call: (requestId: string, method: string, paramsJson: string) => void };
  };
  g.VSN = {
    call(requestId: string, method: string, paramsJson: string) {
      nativeCalls.push({ requestId, method, params: JSON.parse(paramsJson) as Record<string, unknown> });
    },
  };
  // Le client parle à `window` : on lui donne le global (timers compris).
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "VSN");
});

describe("pont : délais", () => {
  test("le timeout JS par défaut dépasse le plafond d'attente natif", () => {
    // Le plafond natif est lu dans le Kotlin : le miroir TS ne peut pas
    // mentir sans que le test ne le voie.
    const kotlin = readFileSync(BRIDGE, "utf8");
    const constants = new Map<string, number>();
    for (const m of kotlin.matchAll(/const\s+val\s+(\w+)\s*=\s*([\d_]+)L?/g)) {
      constants.set(m[1]!, Number(m[2]!.replace(/_/g, "")));
    }
    const expr = /const\s+val\s+MAX_NATIVE_WAIT_MS\s*=\s*([^\n]+)/.exec(kotlin)?.[1] ?? "";
    let native = 0;
    for (const term of expr.split("+").map((t) => t.trim()).filter(Boolean)) {
      native += constants.get(term) ?? Number(term);
    }
    expect(native).toBe(MAX_NATIVE_WAIT_MS);
    expect(native).toBe(NATIVE_WAIT_MS.default + NATIVE_WAIT_MS.llm);
    // Strictement au-dessus : sinon la réponse native arrive après l'abandon
    // et se perd (plus d'entrée dans `pending`).
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(MAX_NATIVE_WAIT_MS);
  });

  test("aucun timeout par méthode ne passe sous son plafond natif", () => {
    // Le scan QR n'a pas de timeout (0) ; l'appairage et la restauration
    // enchaînent plusieurs allers-retours Pronote bloquants.
    expect(BRIDGE_TIMEOUTS["pairing.scanQr"]).toBe(0);
    for (const [method, timeout] of Object.entries(BRIDGE_TIMEOUTS)) {
      if (timeout === 0) continue;
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeGreaterThanOrEqual(MAX_NATIVE_WAIT_MS);
      expect(method in BRIDGE_TIMEOUTS).toBe(true);
    }
  });
});

describe("pont : abandon", () => {
  test("un abandon libère l'entrée pending et prévient le natif", async () => {
    stubNative();
    const promise = call("resources.load", { key: "grades" }, 20);
    expect(pendingCount()).toBe(1);
    await expect(promise).rejects.toThrow("le téléphone n'a pas répondu");
    // L'entrée `pending` est nettoyée : la réponse tardive sera ignorée.
    expect(pendingCount()).toBe(0);
    // Le natif est prévenu : l'appel abandonné ne continue pas en silence.
    const cancel = nativeCalls.find((c) => c.method === "bridge.cancel");
    expect(cancel).toBeDefined();
    expect(cancel!.params["requestId"]).toBe(nativeCalls[0]!.requestId);
  });

  test("une réponse tardive ne casse rien", async () => {
    stubNative();
    const promise = call("resources.load", { key: "grades" }, 20);
    const requestId = nativeCalls[0]!.requestId;
    await expect(promise).rejects.toThrow("le téléphone n'a pas répondu");
    // Le natif répond après l'abandon : ni exception, ni fuite, ni double
    // règlement de la promesse.
    const g = globalThis as unknown as {
      __vsnResolve?: (requestId: string, resultJson: string) => void;
      __vsnReject?: (requestId: string, errorJson: string) => void;
    };
    expect(() => g.__vsnResolve?.(requestId, JSON.stringify({ payload: "trop tard" }))).not.toThrow();
    expect(() => g.__vsnReject?.(requestId, JSON.stringify({ code: "unknown", message: "trop tard" }))).not.toThrow();
    expect(pendingCount()).toBe(0);
    // Un appel suivant fonctionne toujours.
    const next = call("resources.cached", { key: "grades" }, 20);
    expect(pendingCount()).toBe(1);
    await expect(next).rejects.toThrow("le téléphone n'a pas répondu");
    expect(pendingCount()).toBe(0);
  });
});

// #394 : un rejet natif doit TOUJOURS régler la promesse. C'est le filet
// côté JS : même si le natif répond mal (ou pas du tout), la requête ne doit
// pas rester en attente — l'UI doit pouvoir afficher un message.
describe("pont : un rejet natif règle la promesse", () => {
  /** Le pont factice répond par un rejet. */
  function rejetNatif(code: string, message: string): void {
    const g = globalThis as unknown as {
      __vsnReject?: (requestId: string, errorJson: string) => void;
    };
    g.__vsnReject?.(nativeCalls[0]!.requestId, JSON.stringify({ code, message }));
  }

  test("un rejet natif rejette la promesse et libère l'entrée pending", async () => {
    stubNative();
    const promise = call("resources.load", { key: "grades" });
    expect(pendingCount()).toBe(1);
    rejetNatif("unknown", "Erreur native.");
    await expect(promise).rejects.toThrow("Erreur native.");
    expect(pendingCount()).toBe(0);
  });

  // #539 : le scan QR n'a PAS de timeout JS (0) : une promesse qui ne
  // recevrait JAMAIS de réponse pendrait POUR TOUJOURS. Le natif répond
  // toujours (identifiant mal formé ou pont fermé = rejet borné) — ici on
  // vérifie que la réponse native règle bien la promesse, rejet compris.
  test("une méthode SANS timeout se règle quand le natif répond", async () => {
    stubNative();
    const promise = call("pairing.scanQr", {}, 0);
    expect(pendingCount()).toBe(1);
    rejetNatif("bad_request", "Identifiant d'appel invalide.");
    await expect(promise).rejects.toThrow("Identifiant d'appel invalide.");
    expect(pendingCount()).toBe(0);
  });

  test("les codes que l'UI traite portent un message NON VIDE", async () => {
    // `unavailable` et `unknown` sont les deux chemins d'erreur du pont : le
    // message doit être affichable (l'UI n'affiche pas un diagnostic vide).
    for (const code of ["unavailable", "unknown"]) {
      stubNative();
      const promise = call("resources.load", { key: "grades" });
      rejetNatif(code, code === "unavailable" ? "Mémoire insuffisante sur l'appareil." : "Erreur native.");
      const erreur = (await promise.catch((e: unknown) => e)) as { code: string; message: string };
      expect(erreur.code).toBe(code);
      expect(erreur.message.trim()).not.toBe("");
    }
  });

  test("un rejet natif illisible retombe sur un message non vide", async () => {
    // Un rejet que le natif n'a pas pu construire ne doit pas laisser
    // l'interface sans message.
    stubNative();
    const promise = call("resources.load", { key: "grades" });
    const g = globalThis as unknown as {
      __vsnReject?: (requestId: string, errorJson: string) => void;
    };
    g.__vsnReject?.(nativeCalls[0]!.requestId, "{pas du json");
    const erreur = (await promise.catch((e: unknown) => e)) as { code: string; message: string };
    expect(erreur.code).toBe("unknown");
    expect(erreur.message.trim()).not.toBe("");
    expect(pendingCount()).toBe(0);
  });
});

// #393 : l'accueil déclenche CINQ lectures en parallèle (`HomeScreen`). Le natif
// les sérialise (une seule file locale) et son délai d'appel ne couvre QUE le
// travail : en parallèle, la N-ième lecture attend son tour et son délai expire
// AVANT lui — « Lecture indisponible. », puis « le téléphone n'a pas répondu »
// côté JS. Le JS sérialise donc les lectures : une seule en vol, chaque
// lecture part sur une file vide.
describe("pont : les lectures ne saturent pas le pont (#393)", () => {
  /** Faux pont qui suit les appels EN VOL et laisse le test les résoudre. */
  function stubConcurrent(): {
    inflight: () => number;
    resolve: (id: string) => void;
    resolveAll: () => void;
  } {
    const enVol = new Set<string>();
    nativeCalls.length = 0;
    const g = globalThis as unknown as {
      VSN?: { call: (requestId: string, method: string, paramsJson: string) => void };
    };
    g.VSN = {
      call(requestId: string, method: string, paramsJson: string) {
        enVol.add(requestId);
        nativeCalls.push({ requestId, method, params: JSON.parse(paramsJson) as Record<string, unknown> });
      },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
      writable: true,
    });
    const resolve = (id: string) => {
      enVol.delete(id);
      const w = globalThis as unknown as {
        __vsnResolve?: (requestId: string, resultJson: string) => void;
      };
      w.__vsnResolve?.(id, JSON.stringify({ payload: "{}", fetchedAt: 0, stale: false, error: null }));
    };
    return {
      inflight: () => enVol.size,
      resolve,
      // Un test qui échoue ne doit pas laisser la file de lectures OCCUPÉE :
      // les tests suivants partiraient en retard (et échoueraient aussi).
      resolveAll: () => {
        for (const id of [...enVol]) resolve(id);
      },
    };
  }

  /** Un tour de boucle : laisse les microtâches (départs) s'exécuter. */
  function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  test("cinq lectures de l'accueil : une seule en vol, les cinq aboutissent", async () => {
    const pont = stubConcurrent();
    const cles = ["grades", "assignments", "timetable", "alerts", "capabilities"];
    const lectures = cles.map((key) => call("resources.load", { key }));
    try {
      // Une seule lecture est partie : les quatre autres attendent leur tour
      // (parties en parallèle, leur délai natif expirerait avant leur travail).
      await tick();
      let parties = nativeCalls.filter((c) => c.method === "resources.load");
      expect(parties).toHaveLength(1);
      expect(pont.inflight()).toBe(1);
      // Chacune part à son tour, et UNE SEULE reste en vol.
      for (let i = 0; i < cles.length; i++) {
        pont.resolve(parties[i]!.requestId);
        await tick();
        parties = nativeCalls.filter((c) => c.method === "resources.load");
        expect(parties).toHaveLength(Math.min(i + 2, cles.length));
        expect(pont.inflight()).toBeLessThanOrEqual(1);
      }
      const resultats = await Promise.all(lectures);
      expect(resultats).toHaveLength(5);
      expect(pendingCount()).toBe(0);
    } finally {
      pont.resolveAll();
    }
  });

  test("le bouton retour ne fait pas la queue des lectures", async () => {
    const pont = stubConcurrent();
    const lecture = call("resources.load", { key: "grades" });
    try {
      await tick();
      // Le retour part TOUT DE SUITE : il n'attend pas la lecture en vol.
      const retour = call("app.back");
      await tick();
      expect(nativeCalls.map((c) => c.method)).toEqual(["resources.load", "app.back"]);
      // …et la lecture n'est pas bloquée par le retour.
      pont.resolve(nativeCalls[0]!.requestId);
      pont.resolve(nativeCalls[1]!.requestId);
      await lecture;
      await retour;
    } finally {
      pont.resolveAll();
    }
  });

  test("le nombre de lectures en vol tient dans le délai natif", () => {
    // Le budget d'une lecture = le délai HTTP de l'établissement (lu dans le
    // Kotlin de production) ; le délai natif d'un appel = le miroir de
    // `VsnBridge`. Les lectures en file s'additionnent : la N-ième attend
    // (N-1) lectures avant son travail, son délai doit couvrir le tout.
    const http = readFileSync(HTTP, "utf8");
    const budget = Number(/readTimeout\s*=\s*([\d_]+)/.exec(http)?.[1]?.replace(/_/g, ""));
    expect(budget).toBeGreaterThan(0);
    expect(MAX_PARALLEL_READS * budget).toBeLessThanOrEqual(NATIVE_WAIT_MS.default);
    // Et le JS attend plus longtemps que le plafond natif (#371).
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(MAX_NATIVE_WAIT_MS);
  });
});

// #423 : le pont factice est un artefact de DÉVELOPPEMENT. En production il
// n'est pas embarqué : un pont absent doit échouer bruyamment, jamais servir
// une école fictive (faux profil, fausses notes, session « restored »).
describe("pont : le factice n'existe qu'en développement", () => {
  /** Fenêtre SANS pont natif : le client ne doit rien inventer. */
  function stubSansPont(): void {
    const g = globalThis as unknown as { VSN?: unknown };
    Reflect.deleteProperty(g, "VSN");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
      writable: true,
    });
  }

  /** Bascule le mode dev (`import.meta.env.DEV`) le temps du test. */
  async function enModeDev<T>(valeur: boolean, action: () => Promise<T>): Promise<T> {
    const precedent = process.env["DEV"];
    process.env["DEV"] = valeur ? "true" : "";
    try {
      return await action();
    } finally {
      if (precedent === undefined) Reflect.deleteProperty(process.env, "DEV");
      else process.env["DEV"] = precedent;
    }
  }

  test("hors mode dev : un pont absent échoue au lieu de renvoyer des données fictives", async () => {
    stubSansPont();
    await enModeDev(false, async () => {
      // Le factice aurait répondu `{state:"restored"}` : c'est exactement ce
      // qu'on ne veut plus voir en production.
      await expect(call("session.restore")).rejects.toThrow("pont natif indisponible");
      await expect(call("resources.load", { key: "grades" })).rejects.toThrow(
        "pont natif indisponible",
      );
    });
  });

  test("en mode dev : le pont factice répond (Chromium sans téléphone)", async () => {
    stubSansPont();
    await enModeDev(true, async () => {
      const status = await call<SessionStatus>("session.restore");
      expect(status.state).toBe("restored");
    });
  });

  test("un pont natif présent ne retombe JAMAIS sur le factice", async () => {
    // Le natif gagne toujours : une méthode absente de l'allowlist est
    // refusée par le Kotlin (« Méthode inconnue. »), jamais servie en faux.
    stubNative();
    await enModeDev(true, async () => {
      await expect(call("session.restore", {}, 30)).rejects.toThrow(
        "le téléphone n'a pas répondu",
      );
      expect(nativeCalls[0]?.method).toBe("session.restore");
    });
  });
});
