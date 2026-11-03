// Lectures PARTIELLES (#881) : une section ou une ligne illisible est sautée,
// le résultat porte `partial`, et rien de lisible = l'erreur typée d'origine.
// Fixtures scriptées côté Kotlin, exécutées sur le VRAI port compilé.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "PartialPayloadParityMain.kt");
const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface PartialResult {
  partial?: boolean;
  ids?: string[];
  grades?: number;
  averages?: number;
  thrown?: string | null;
}

async function run(op: string): Promise<PartialResult> {
  return JSON.parse(await link!.ask({ op }, { allowError: true })) as PartialResult;
}

describe("payloads partiels (#881)", () => {
  describe("cours", () => {
    test.skipIf(skip)("aucune section mauvaise : tout est publié, `partial` absent", async () => {
      const r = await run("lessonsNoBad");
      expect(r.partial).toBe(false);
      expect(r.ids).toEqual(["l1", "l2", "l3"]);
    });

    test.skipIf(skip)("une ligne tordue : elle est sautée, `partial` posé", async () => {
      const r = await run("lessonsOneBadItem");
      expect(r.partial).toBe(true);
      expect(r.ids).toEqual(["l1", "l2"]);
    });

    test.skipIf(skip)("une section (semaine) illisible : les autres restent", async () => {
      const r = await run("lessonsOneBadSection");
      expect(r.partial).toBe(true);
      expect(r.ids).toEqual(["l2"]);
    });

    test.skipIf(skip)("aucune section lisible : erreur typée, jamais un vide", async () => {
      const r = await run("lessonsAllBad");
      expect(r.thrown).toBe("ParsingError");
    });
  });

  describe("devoirs", () => {
    test.skipIf(skip)("aucune ligne mauvaise : complet", async () => {
      const r = await run("homeworkNoBad");
      expect(r.partial).toBe(false);
      expect(r.ids).toEqual(["h1", "h2"]);
    });

    test.skipIf(skip)("une ligne tordue : sautée et signalée", async () => {
      const r = await run("homeworkOneBad");
      expect(r.partial).toBe(true);
      expect(r.ids).toEqual(["h1"]);
    });

    test.skipIf(skip)("toutes les lignes tordues : erreur typée", async () => {
      const r = await run("homeworkAllBad");
      expect(r.thrown).toBe("ParsingError");
    });
  });

  describe("discussions", () => {
    test.skipIf(skip)("fils non pertinents : liste vide légitime, pas partielle", async () => {
      const r = await run("discussionsNoBad");
      expect(r.partial).toBe(false);
      expect(r.ids).toEqual(["d1", "d2"]);
    });

    test.skipIf(skip)("un fil illisible : les autres restent, `partial` posé", async () => {
      const r = await run("discussionsOneBad");
      expect(r.partial).toBe(true);
      expect(r.ids).toEqual(["d1"]);
    });

    test.skipIf(skip)("aucun fil lisible : erreur typée", async () => {
      const r = await run("discussionsAllBad");
      expect(r.thrown).toBe("ParsingError");
    });
  });

  describe("actualités et cantine", () => {
    test.skipIf(skip)("actualités : aucune section mauvaise", async () => {
      const r = await run("newsNoBad");
      expect(r.partial).toBe(false);
      expect(r.ids).toEqual(["n1", "n2"]);
    });

    test.skipIf(skip)("actualités : une section sans liste est sautée", async () => {
      const r = await run("newsOneBadSection");
      expect(r.partial).toBe(true);
      expect(r.ids).toEqual(["n2"]);
    });

    test.skipIf(skip)("actualités : aucune section lisible = erreur typée", async () => {
      const r = await run("newsAllBad");
      expect(r.thrown).toBe("ParsingError");
    });

    test.skipIf(skip)("cantine : un plat illisible est sauté", async () => {
      const r = await run("menusOneBadItem");
      expect(r.partial).toBe(true);
      expect(r.ids).toEqual(["m1"]);
    });

    test.skipIf(skip)("cantine : tous les plats illisibles = erreur typée", async () => {
      const r = await run("menusAllBad");
      expect(r.thrown).toBe("ParsingError");
    });
  });

  describe("notes", () => {
    test.skipIf(skip)("aucune ligne mauvaise : snapshot complet", async () => {
      const r = await run("gradesNoBad");
      expect(r.partial).toBe(false);
      expect(r.grades).toBe(2);
      expect(r.averages).toBe(1);
    });

    test.skipIf(skip)("une note tordue : sautée, le reste publié", async () => {
      const r = await run("gradesOneBad");
      expect(r.partial).toBe(true);
      expect(r.grades).toBe(1);
      expect(r.averages).toBe(1);
    });

    test.skipIf(skip)("notes et moyennes toutes illisibles : erreur typée", async () => {
      const r = await run("gradesAllBad");
      expect(r.thrown).toBe("ParsingError");
    });
  });
});
