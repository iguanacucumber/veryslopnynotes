// Toute ENTRÉE du pont répond EXACTEMENT une fois : deux branches sortaient sans
// répondre et la promesse JS pendait (pour toujours sur `pairing.scanQr`).
// La décision vit dans `app/BridgeCall.kt`, PUR et EXÉCUTÉ ; outillage absent =
// SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "BridgeCallMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface Reply {
  kind: "reject" | "resolveOk" | "cancel";
  requestId: string;
  code?: string;
  message?: string;
  params?: string;
}

interface Route {
  handled: boolean;
  replies: Reply[];
}

/** La décision du pont pour un appel, avec chaque réponse enregistrée. */
async function route(
  requestId: string,
  method: string,
  params = "",
  closed = false,
): Promise<Route> {
  return JSON.parse(
    await link!.ask({ op: "early", requestId, method, params, closed }),
  ) as Route;
}

/** Les réponses qui réGLENT la promesse JS (l'abandon est un effet, pas une réponse). */
function responses(r: Route): Reply[] {
  return r.replies.filter((x) => x.kind === "reject" || x.kind === "resolveOk");
}

describe("pont : toute entrée répond exactement une fois (#539)", () => {
  test.skipIf(skip)("un identifiant d'appel mal formé est REFUSÉ, jamais ignoré", async () => {
    const invalides = ["", " ", "id avec espace", "id\n", "x".repeat(65), "id/slash"];
    for (const requestId of invalides) {
      const r = await route(requestId, "resources.load", "{}");
      expect({ requestId, handled: r.handled }).toEqual({ requestId, handled: true });
      expect(responses(r)).toHaveLength(1);
      const rejet = responses(r)[0]!;
      expect(rejet.kind).toBe("reject");
      expect(rejet.code).toBe("bad_request");
      // L'identifiant revient TEL QUEL : sinon le JS ne retrouve pas sa promesse.
      expect(rejet.requestId).toBe(requestId);
      expect((rejet.message ?? "").trim()).not.toBe("");
    }
  });

  test.skipIf(skip)("un pont fermé répond un rejet borné, jamais le silence", async () => {
    const r = await route("c1", "pairing.scanQr", "{}", true);
    expect(r.handled).toBe(true);
    expect(responses(r)).toHaveLength(1);
    expect(responses(r)[0]!.kind).toBe("reject");
    expect(responses(r)[0]!.code).toBe("unavailable");
    expect((responses(r)[0]!.message ?? "").trim()).not.toBe("");
  });

  test.skipIf(skip)("méthode inconnue et requête trop volumineuse sont REFUSÉES", async () => {
    const inconnue = await route("c1", "resources.download");
    expect(responses(inconnue)).toHaveLength(1);
    expect(responses(inconnue)[0]!.code).toBe("bad_request");

    const tropLongue = await route("c1", "resources.load", "x".repeat(256 * 1024 + 1));
    expect(responses(tropLongue)).toHaveLength(1);
    expect(responses(tropLongue)[0]!.code).toBe("bad_request");
  });

  test.skipIf(skip)("l'abandon est traité hors file et répond une fois", async () => {
    const r = await route("c1", "bridge.cancel", JSON.stringify({ requestId: "cible" }));
    expect(r.handled).toBe(true);
    expect(responses(r)).toHaveLength(1);
    expect(responses(r)[0]!.kind).toBe("resolveOk");
    expect(responses(r)[0]!.requestId).toBe("c1");
    // L'abandon marque bien la cible (effet distinct de la réponse).
    expect(r.replies.map((x) => x.kind)).toContain("cancel");
  });

  test.skipIf(skip)("un appel normal part sur un fil : zéro réponse précoce", async () => {
    const r = await route("c1", "resources.load", "{}");
    expect(r.handled).toBe(false);
    expect(responses(r)).toHaveLength(0);
  });

  test.skipIf(skip)("la priorité est stable : identifiant, méthode, taille, abandon, pont", async () => {
    // Identifiant mal formé + pont fermé : c'est l'identifiant qui est refusé.
    const idDAbord = await route("", "bridge.cancel", "{}", true);
    expect(idDAbord.replies[0]!.kind).toBe("reject");
    expect(idDAbord.replies[0]!.code).toBe("bad_request");

    // Abandon + pont fermé : l'abandon reste traité (signal d'arrêt immédiat).
    const abandonDAbord = await route("c1", "bridge.cancel", "{}", true);
    expect(abandonDAbord.replies.map((x) => x.kind)).toContain("resolveOk");
    expect(responses(abandonDAbord)).toHaveLength(1);
  });
});
