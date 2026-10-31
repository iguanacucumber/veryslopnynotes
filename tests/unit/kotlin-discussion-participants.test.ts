// Les participants des fils ne sont plus téléchargés pour TOUTE la liste (25 POST
// à l'ouverture, dont 12 pour des noms affichés seulement à l'ouverture) : ils
// sont demandés À L'OUVERTURE. Le vrai `Client` est rejoué avec un stub qui
// compte les requêtes ; outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { payloadsSource } from "./fixtures/payload-sources";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "DiscussionParticipantsParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface Answer {
  sends: number;
  functions: string[];
  subjects?: string[];
  messages?: number;
  participants?: string[];
}

async function ask(op: unknown): Promise<Answer> {
  return JSON.parse(await link!.ask(op)) as Answer;
}

/** Source d'une fonction, de sa signature à sa fermeture. */
function slice(src: string, header: string): string {
  const start = src.indexOf(header);
  if (start === -1) return "";
  return src.slice(start, src.indexOf("\n}", start));
}

describe("les participants d'un fil, à la demande (#476)", () => {
  test.skipIf(skip)("la liste des fils = UNE requête", async () => {
    const res = await ask({ op: "list" });
    expect(res.sends).toBe(1);
    expect(res.functions).toEqual(["ListeMessagerie"]);
    expect(res.subjects).toEqual(["Absence du 12/09"]);
  });

  test.skipIf(skip)("les messages d'un fil = une requête de plus", async () => {
    const res = await ask({ op: "thread" });
    expect(res.sends).toBe(2);
    expect(res.functions).toEqual(["ListeMessagerie", "ListeMessages"]);
    expect(res.messages).toBe(1);
  });

  test.skipIf(skip)("les participants d'un fil = une requête de plus, à l'ouverture", async () => {
    const res = await ask({ op: "participants" });
    expect(res.sends).toBe(2);
    expect(res.functions).toEqual(["ListeMessagerie", "SaisiePublicMessage"]);
    expect(res.participants).toEqual(["Mme Dupont", "M. Martin"]);
  });

  test("la liste ne télécharge plus les participants ; le fil ouvert les demande", () => {
    const payloads = payloadsSource();
    const list = slice(payloads, "internal fun discussionsPayload(");
    expect(list).not.toContain("participants()");
    // Les messages d'un fil, eux, les demandent (à l'ouverture).
    const thread = slice(payloads, "internal fun messagesPayload(");
    expect(thread).toContain("participants()");
  });
});
