// #645 : I31 ne se vérifie plus en lisant la forme de `PronotePayloads.kt`.
//
// La clé de déduplication (kind, id) et la fusion vivent désormais dans
// `android/core/EventDedupe.kt`, un fichier PUR (ni `org.json`, ni Android).
// Ce test le COMPILE et l'EXÉCUTE via
// `agents/runtime/kotlin-parity/EventDedupeParityMain.kt` : déplacer une ligne
// ou renommer une variable dans le consommateur natif ne change plus le verdict,
// et une régression de la CLÉ fait vraiment échouer le test.
//
// Le câblage web garde ses tests EXÉCUTÉS (`tests/web/social.test.ts`,
// `tests/web/home.test.ts`, `tests/web/tasks.test.ts`) : la défense est
// redondante côté interface.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "EventDedupeParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface EventInput {
  kind: string;
  id: string;
}

interface DedupeResult {
  keys: string[];
  kept: EventInput[];
  counts: Record<string, number>;
}

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op, { allowError: true }));
}

async function key(kind: string, id: string): Promise<string> {
  const r = await ask({ op: "key", kind, id });
  expect(r.error).toBeUndefined();
  return r.key as string;
}

async function dedupe(events: EventInput[]): Promise<DedupeResult> {
  const r = (await ask({ op: "dedupe", events })) as DedupeResult & { error?: string };
  expect(r.error).toBeUndefined();
  return r;
}

describe("I31 — un enregistrement publié = UNE ligne (#645)", () => {
  test.skipIf(skip)("la clé porte le kind, jamais l'identifiant seul", async () => {
    const absence = await key("absence", "12");
    const late = await key("late", "12");
    expect(absence).toBe("absence:12");
    expect(late).toBe("late:12");
    // Deux kinds DIFFÉRENTS avec le même identifiant = deux clés distinctes.
    expect(absence).not.toBe(late);
  });

  test.skipIf(skip)("une absence et un retard de même identifiant = deux entrées", async () => {
    const r = await dedupe([
      { kind: "absence", id: "12" },
      { kind: "late", id: "12" },
    ]);
    expect(r.kept).toEqual([
      { kind: "absence", id: "12" },
      { kind: "late", id: "12" },
    ]);
    expect(r.keys).toEqual(["absence:12", "late:12"]);
    expect(r.counts).toEqual({ absence: 1, late: 1 });
  });

  test.skipIf(skip)("un doublon exact = une seule entrée", async () => {
    const r = await dedupe([
      { kind: "absence", id: "12" },
      { kind: "absence", id: "12" },
      { kind: "late", id: "12" },
      { kind: "late", id: "12" },
    ]);
    expect(r.kept).toHaveLength(2);
    expect(r.keys).toEqual(["absence:12", "late:12"]);
    // Les compteurs partent de la liste DÉDUPLIQUÉE : deux doublons exacts ne
    // comptent pas deux fois.
    expect(r.counts).toEqual({ absence: 1, late: 1 });
  });

  test.skipIf(skip)("deux événements DISTINCTS de même kind et même id sont dédupliqués", async () => {
    const r = await dedupe([
      { kind: "absence", id: "12" },
      { kind: "absence", id: "12" },
    ]);
    expect(r.kept).toEqual([{ kind: "absence", id: "12" }]);
    expect(r.counts).toEqual({ absence: 1 });
  });

  test.skipIf(skip)("un devoir publié deux fois n'est gardé qu'une fois", async () => {
    const r = await dedupe([
      { kind: "assignment", id: "a3" },
      { kind: "assignment", id: "a3" },
      { kind: "assignment", id: "a4" },
    ]);
    expect(r.kept).toEqual([
      { kind: "assignment", id: "a3" },
      { kind: "assignment", id: "a4" },
    ]);
    expect(r.counts).toEqual({ assignment: 2 });
  });
});
