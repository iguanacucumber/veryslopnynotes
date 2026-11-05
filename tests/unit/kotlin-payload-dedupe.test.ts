// I31 ne se vérifie plus en lisant `PronotePayloads.kt` : la clé (kind, id) et
// la fusion vivent dans `core/EventDedupe.kt`, fichier pur compilé et exécuté
// ici via `EventDedupeParityMain.kt`. Le câblage web garde ses tests exécutés.
// Outillage absent = SKIP BRUYANT ; échec de compilation = défaut.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");

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
    // Les compteurs partent de la liste DÉDUPLIQUÉE : un doublon ne compte qu'une fois.
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

  test("les sanctions sont dédupliquées par id stable, avec repli date+type+motif", () => {
    const source = readFileSync(join(DATA, "SchoolLifePayloads.kt"), "utf8");
    const body = source.slice(
      source.indexOf("internal fun punishmentsPayload("),
      source.indexOf("return JSONObject().put(\"punishments\"", source.indexOf("internal fun punishmentsPayload(")),
    );
    // La même sanction revient dans chaque période : une seule ligne publiée.
    expect(body).toContain("dedupe(rows)");
    expect(body).toContain('eventKey("punishment", stableId)');
    // Sans id stable, le repli porte date+type+motif ET un rang par période :
    // deux sanctions réellement distinctes ne fusionnent pas.
    expect(body).toContain('val fallback = "$date|$type|$motif"');
    expect(body).toContain("fallbackRanks[fallback]");
    // L'id publié reste borné (le web le borne à 64).
    expect(body).toContain('"pun-${seq++}"');
  });
});
