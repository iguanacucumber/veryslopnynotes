// Le corps d'une actualité se charge À LA DEMANDE : la liste téléchargeait le
// corps des 20 premières (21 POST pour 2-3 actus lues). Un POST par actualité
// dépliée. Le vrai `Client` est rejoué avec un stub qui compte les requêtes ;
// outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { payloadsSource } from "./fixtures/payload-sources";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "NewsBodyParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface Answer {
  sends: number;
  functions: string[];
  titles?: string[];
  body?: string;
}

async function ask(op: unknown): Promise<Answer> {
  return JSON.parse(await link!.ask(op)) as Answer;
}

describe("le corps d'une actualité à la demande (#475)", () => {
  test.skipIf(skip)("la liste des actus = UNE requête", async () => {
    const res = await ask({ op: "list" });
    expect(res.sends).toBe(1);
    expect(res.functions).toEqual(["PageActualites"]);
    // La liste porte les métadonnées (titre), pas le corps.
    expect(res.titles).toEqual(["Semaine de l'orientation"]);
  });

  test.skipIf(skip)("le corps d'une actualité = UNE requête", async () => {
    const res = await ask({ op: "body", id: "actu-1" });
    expect(res.sends).toBe(1);
    expect(res.functions).toEqual(["PageActualites"]);
    // Le corps est un TEXTE, jamais du HTML (I6).
    expect(res.body).toBe("Ordre du jour");
  });

  test("la liste ne télécharge plus les corps", () => {
    // Plus aucun chargement de corps dans la liste.
    const payloads = payloadsSource();
    const start = payloads.indexOf("internal fun newsPayload(");
    expect(start).toBeGreaterThan(-1);
    const body = payloads.slice(start, payloads.indexOf("\n}", start));
    expect(body).not.toContain("content()");
    expect(body).toContain("informationAndSurveys()");
  });
});
