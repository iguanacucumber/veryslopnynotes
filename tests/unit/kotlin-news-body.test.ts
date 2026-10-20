// #475 : le corps d'une actualité se charge À LA DEMANDE (au dépliage).
//
// La liste des actus téléchargait le CORPS des 20 premières : 21 POST pour un
// écran dont l'élève ne lit que 2-3 actus. Le corps est maintenant demandé au
// cas par cas (1 POST par actualité déployee).
//
// Le VRAI `Client` est rejoué (enveloppe `{Signature, data}`, mémo des
// lectures) avec un STUB qui compte les requêtes à la place de
// l'établissement : le test porte sur du code de production exécuté.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT (jamais un faux vert) ; un
// échec de compilation est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "NewsBodyParityMain.kt");
const PAYLOADS = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data/PronotePayloads.kt");

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
    // Le corps est un TEXTE (le HTML de l'établissement est retiré) : une
    // DONNÉE, jamais du HTML (I6).
    expect(res.body).toBe("Ordre du jour");
  });

  test("la liste ne télécharge plus les corps", () => {
    // C'est l'appel qui coûtait 20 POST : il n'a plus sa place dans la liste.
    const payloads = readFileSync(PAYLOADS, "utf8");
    const start = payloads.indexOf("internal fun newsPayload(");
    expect(start).toBeGreaterThan(-1);
    const body = payloads.slice(start, payloads.indexOf("\n}", start));
    expect(body).not.toContain("content()");
    expect(body).toContain("informationAndSurveys()");
  });
});
