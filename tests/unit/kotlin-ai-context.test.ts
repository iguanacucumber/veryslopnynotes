// Le contexte IA est assemblé UNE fois pour tous les points d'entrée : priorité,
// budgets, déduplication, troncature signalée, parité texte/photo/fiche/chat.
// `AiContext.kt` est EXÉCUTÉ ; le câblage du pont est lu en source.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "AiContextMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask<T>(op: unknown): Promise<T> {
  return JSON.parse(await link!.ask(op)) as T;
}

type Item = { type: string; label: string; text: string };
type Source = {
  type: string;
  label: string;
  text: string;
  chars: number;
  originalChars: number;
  truncated: boolean;
};
type Omitted = { type: string; label: string; reason: string };
type Refusal = { code: string; message: string; actions: string[] };
type Assembled = {
  entry: string;
  totalChars: number;
  sources: Source[];
  omitted: Omitted[];
  refusal: Refusal | null;
};

const ITEM = (type: string, label: string, text: string): Item => ({ type, label, text });

describe("contexte IA — priorité, budgets, dédup, troncature (#628)", () => {
  test.skipIf(skip)("les budgets viennent du contrat devoirs et de la garde I5", async () => {
    const budget = await ask<{
      maxSources: number;
      maxSourceChars: number;
      maxTotalChars: number;
      maxLabelChars: number;
      maxHistoryItems: number;
      refusalCode: string;
    }>({ op: "budget" });
    // Contrat devoirs : 8 sources de 2 000 caractères.
    expect(budget.maxSources).toBe(8);
    expect(budget.maxSourceChars).toBe(2000);
    expect(budget.maxLabelChars).toBe(200);
    // Le budget TOTAL est le plafond I5, plus petit que 8 × 2 000.
    expect(budget.maxTotalChars).toBe(12000);
    expect(budget.maxTotalChars).toBeLessThan(budget.maxSources * budget.maxSourceChars);
    expect(budget.maxHistoryItems).toBe(6);
    expect(budget.refusalCode).toBe("aucune_source");
  });

  test.skipIf(skip)("l'ordre de priorité est explicite, quel que soit l'ordre d'entrée", async () => {
    const items: Item[] = [
      ITEM("history", "Historique : 1", "historique"),
      ITEM("web", "Page web : article", "web"),
      ITEM("manual", "Manuel : maths", "manuel"),
      ITEM("note", "Cahier : chapitre", "cahier"),
      ITEM("attachment", "Pièce jointe : sujet.pdf", "piece"),
      ITEM("course", "Cours : chapitre 4", "cours"),
      ITEM("assignment", "Consigne", "consigne"),
    ];
    const result = await ask<Assembled>({ op: "assemble", entry: "chat", items });
    expect(result.sources.map((s) => s.type)).toEqual([
      "assignment",
      "course",
      "attachment",
      "note",
      "manual",
      "web",
      "history",
    ]);
    expect(result.totalChars).toBe(result.sources.reduce((n, s) => n + s.chars, 0));
  });

  test.skipIf(skip)("la déduplication est par contenu ET par libellé, le premier gagne", async () => {
    const items: Item[] = [
      ITEM("course", "Cours : Chapitre 4", "alpha"),
      // Même contenu, libellé différent : doublon par contenu.
      ITEM("note", "Cahier : Notes", "  alpha  "),
      // Même libellé à la casse près, contenu différent : doublon par libellé.
      ITEM("course", "cours : chapitre 4", "beta"),
    ];
    const result = await ask<Assembled>({ op: "assemble", entry: "homework", items });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.label).toBe("Cours : Chapitre 4");
    expect(result.sources[0]?.text).toBe("alpha");
    expect(result.omitted.map((o) => o.reason)).toEqual(["duplicate", "duplicate"]);
  });

  test.skipIf(skip)("une source coupée est signalée (texte et drapeau), jamais silencieuse", async () => {
    const long = "x".repeat(2500);
    const items: Item[] = [ITEM("course", "Cours : Long", long)];
    const result = await ask<Assembled>({ op: "assemble", entry: "homework", items });
    const source = result.sources[0];
    expect(source?.chars).toBe(2000);
    expect(source?.text).toHaveLength(2000);
    expect(source?.originalChars).toBe(2500);
    expect(source?.truncated).toBe(true);
    expect(result.totalChars).toBe(2000);
    // Le lot produit reste valide pour le contrat devoirs (I5).
    const valid = await ask<{ valid: boolean; count: number }>({ op: "valid", items });
    expect(valid).toEqual({ valid: true, count: 1 });
  });

  test.skipIf(skip)("le budget TOTAL coupe la source suivante et écarte les autres", async () => {
    const items: Item[] = [
      ...Array.from({ length: 6 }, (_, i) =>
        ITEM("course", `Cours : S${i}`, "abcdefghij"[i]!.repeat(1900)),
      ),
      ITEM("note", "Cahier : Long", "b".repeat(2000)),
      ITEM("manual", "Manuel : Trop", "c".repeat(500)),
    ];
    const result = await ask<Assembled>({ op: "assemble", entry: "homework", items });
    expect(result.totalChars).toBe(12000);
    expect(result.sources).toHaveLength(7);
    const last = result.sources[6];
    expect(last?.chars).toBe(600);
    expect(last?.truncated).toBe(true);
    expect(result.omitted.map((o) => o.reason)).toContain("budget");
    const valid = await ask<{ valid: boolean; count: number }>({ op: "valid", items });
    expect(valid.valid).toBe(true);
    expect(valid.count).toBe(7);
  });

  test.skipIf(skip)("le plafond de sources est appliqué après la priorité", async () => {
    const items: Item[] = Array.from({ length: 9 }, (_, i) =>
      ITEM(i === 0 ? "assignment" : "course", i === 0 ? "Consigne" : `Cours : S${i}`, `t${i}`),
    );
    const result = await ask<Assembled>({ op: "assemble", entry: "homework", items });
    expect(result.sources).toHaveLength(8);
    expect(result.omitted.filter((o) => o.reason === "max_sources")).toHaveLength(1);
  });
});

describe("contexte IA — refus déterministe sans source (#628)", () => {
  test.skipIf(skip)("un corpus vide produit le même refus avec CTA, sans appel", async () => {
    const first = await ask<Assembled>({ op: "assemble", entry: "homework", items: [] });
    const second = await ask<Assembled>({
      op: "assemble",
      entry: "homework",
      items: [ITEM("course", "Cours : Vide", "   ")],
    });
    expect(first.sources).toEqual([]);
    expect(first.refusal?.code).toBe("aucune_source");
    expect(first.refusal?.actions).toEqual(["add_course", "enable_manual", "open_attachment"]);
    expect(first.refusal?.message).toContain("ajoute un cours");
    // Déterministe : même corpus = même refus, CTA compris.
    expect(second.sources).toEqual([]);
    expect(second.refusal).toEqual(first.refusal);
  });

  test.skipIf(skip)("la photo tolère un corpus texte vide (l'image est la source)", async () => {
    const result = await ask<Assembled>({ op: "assemble", entry: "photo", items: [] });
    expect(result.sources).toEqual([]);
    expect(result.refusal).toBeNull();
  });

  test.skipIf(skip)("le chat peut citer l'historique, les autres chemins l'ignorent", async () => {
    const base: Item[] = [
      ITEM("assignment", "Consigne", "consigne"),
      ITEM("course", "Cours : Chapitre", "cours"),
      ITEM("note", "Cahier : Notes", "cahier"),
      ITEM("manual", "Manuel : Maths", "manuel"),
      ITEM("web", "Page web : Article", "web"),
    ];
    const history = ITEM("history", "Historique : 1 — élève", "question précédente");
    for (const entry of ["homework", "photo", "revision"]) {
      const result = await ask<Assembled>({ op: "assemble", entry, items: [...base, history] });
      expect(result.sources.map((s) => s.type)).toEqual(base.map((s) => s.type));
    }
    const chat = await ask<Assembled>({ op: "assemble", entry: "chat", items: [...base, history] });
    expect(chat.sources.map((s) => s.type)).toEqual([...base.map((s) => s.type), "history"]);
    // L'historique est BORNÉ : au plus 6 tours, et le budget peut en couper plus.
    const longHistory = Array.from({ length: 10 }, (_, i) =>
      ITEM("history", `Historique : ${i + 1}`, `tour ${i + 1}`),
    );
    const capped = await ask<Assembled>({
      op: "assemble",
      entry: "chat",
      items: [ITEM("assignment", "Consigne", "consigne"), ...longHistory],
    });
    const historyCount = capped.sources.filter((s) => s.type === "history").length;
    expect(historyCount).toBeLessThanOrEqual(6);
    expect(capped.sources.at(-1)?.label).toBe("Historique : 10");
    // Les tours au-delà du plafond sont signalés, jamais perdus en silence.
    expect(capped.omitted.filter((o) => o.reason === "budget")).toHaveLength(4);
  });
});

describe("contexte IA — historique : les derniers tours survivent", () => {
  test.skipIf(skip)("slots libres limités : les tours les plus récents, en ordre chronologique", async () => {
    const courses: Item[] = Array.from({ length: 5 }, (_, i) =>
      ITEM("course", `Cours : S${i}`, `cours ${i}`),
    );
    const history: Item[] = Array.from({ length: 6 }, (_, i) =>
      ITEM("history", `Historique : ${i + 1} — élève`, `tour ${i + 1}`),
    );
    const result = await ask<Assembled>({ op: "assemble", entry: "chat", items: [...courses, ...history] });
    // 5 sources fixes + 3 slots : les tours 1..3 tombent, pas les derniers.
    expect(result.sources.map((s) => s.label)).toEqual([
      ...courses.map((c) => c.label),
      "Historique : 4 — élève",
      "Historique : 5 — élève",
      "Historique : 6 — élève",
    ]);
    // Les tours écartés gardent leur libellé et disent pourquoi.
    const dropped = result.omitted.filter((o) => o.reason === "max_sources");
    expect(dropped.map((o) => o.label).sort()).toEqual([
      "Historique : 1 — élève",
      "Historique : 2 — élève",
      "Historique : 3 — élève",
    ]);
    expect(result.totalChars).toBe(result.sources.reduce((n, s) => n + s.chars, 0));
  });

  test.skipIf(skip)("un tour identique répété n'est pas un doublon", async () => {
    const items: Item[] = [
      ITEM("assignment", "Consigne", "consigne"),
      ITEM("history", "Historique : 1 — élève", "question"),
      ITEM("history", "Historique : 2 — élève", "oui"),
      ITEM("history", "Historique : 3 — élève", "oui"),
      ITEM("history", "Historique : 4 — élève", "non"),
    ];
    const result = await ask<Assembled>({ op: "assemble", entry: "chat", items });
    const turns = result.sources.filter((s) => s.type === "history");
    expect(turns.map((s) => s.text)).toEqual(["question", "oui", "oui", "non"]);
    expect(result.omitted.filter((o) => o.reason === "duplicate")).toHaveLength(0);
  });
});

describe("contexte IA — libellés citables stables (#628)", () => {
  test.skipIf(skip)("préfixe stable, blancs normalisés, URL et identifiants exclus", async () => {
    expect((await ask<{ label: string }>({ op: "label", type: "course", title: "Chapitre 4" })).label).toBe(
      "Cours : Chapitre 4",
    );
    expect(
      (await ask<{ label: string }>({ op: "label", type: "course", title: "  Mathématiques\n  chapitre  " })).label,
    ).toBe("Cours : Mathématiques chapitre");
    // Une URL d'établissement ou une ref opaque ne devient jamais un libellé (I4).
    for (const title of ["https://pronote.exemple/eleve", "homework:0:file:0:abc", "//hote/data:"]) {
      expect((await ask<{ label: string }>({ op: "label", type: "course", title })).label).toBe("Cours");
    }
    const long = await ask<{ label: string }>({ op: "label", type: "course", title: "t".repeat(500) });
    expect(long.label.length).toBe(200);
  });

  test.skipIf(skip)("espaces Unicode et caractères de format ne survivent pas dans un libellé", async () => {
    const raw = "Chapitre\u00A04\u202F: \u200Blimites\u2060\uFEFF";
    const label = (await ask<{ label: string }>({ op: "label", type: "course", title: raw })).label;
    expect(label).toBe("Cours : Chapitre 4 : limites");
    expect(label).not.toMatch(/[\u00a0\u202f\u200b\u2060\ufeff]/);
    // Le libellé formé puis ré-assaini par `assemble` reste citable tel quel.
    const assembled = await ask<Assembled>({
      op: "assemble",
      entry: "chat",
      items: [ITEM("history", "Historique\u00A0:\u00A01\u00A0— élève", "tour")],
    });
    expect(assembled.sources[0]?.label).toBe("Historique : 1 — élève");
  });

  test.skipIf(skip)("une coupe à 200 ne laisse pas de demi-paire de substitution", async () => {
    // Le préfixe « Cours : » fait 8 unités : l'émoji tombe pile sur la coupe.
    const title = "t".repeat(191) + "😀" + "fin";
    const label = (await ask<{ label: string }>({ op: "label", type: "course", title })).label;
    expect(label.length).toBeLessThanOrEqual(200);
    expect(/[\uD800-\uDBFF]$/.test(label)).toBe(false);
    expect(/^[\uDC00-\uDFFF]/.test(label)).toBe(false);
    expect(label.endsWith("t")).toBe(true);
  });
});

describe("contexte IA — parité des points d'entrée (#628)", () => {
  test.skipIf(skip)("texte, photo et fiche produisent le MÊME corpus ; le chat ajoute l'historique", async () => {
    const items: Item[] = [
      ITEM("assignment", "Consigne", "consigne"),
      ITEM("course", "Cours : Chapitre", "cours"),
      ITEM("note", "Cahier : Notes", "cahier"),
      ITEM("manual", "Manuel : Maths", "manuel"),
      ITEM("web", "Page web : Article", "web"),
    ];
    // Des `ask` concurrents perdent des réponses : la parité se rejoue en série.
    const results: Assembled[] = [];
    for (const entry of ["homework", "photo", "revision", "chat"]) {
      results.push(await ask<Assembled>({ op: "assemble", entry, items }));
    }
    const corpus = results.map((r) => r.sources.map((s) => ({ type: s.type, label: s.label, text: s.text })));
    const reference = corpus[0] ?? [];
    expect(reference.length).toBeGreaterThan(0);
    for (const sources of corpus.slice(1)) expect(sources).toEqual(reference);
  });
});

describe("contexte IA — câblage unique du pont (#628)", () => {
  const bridge = codeOnly(readBridgeSource());

  test("les quatre chemins passent par AiContext.assembleFor", () => {
    expect(bridge).toContain("AiContext.assembleFor(entry, items)");
    // Les chemins devoirs passent la SEMAINE et l'époque : les PJ s'écrivent dans le cache (I26).
    expect(bridge).toContain("aiContextFor(assignment, AiContextEntry.HOMEWORK, week, epoch)");
    expect(bridge).toContain("aiContextFor(assignment, AiContextEntry.PHOTO, week, epoch)");
    expect(bridge).toContain("aiContextFor(assignment, AiContextEntry.REVISION, week, epoch)");
    expect(bridge).not.toContain("homeworkSourcesFor");
    expect(bridge).not.toContain("revisionChunks");
  });

  test("le corpus vide refuse AVANT l'appel payant, sauf geste explicite", () => {
    const refusal = bridge.indexOf("if (context.sources.isEmpty() && !proceedAnyway)");
    const call = bridge.indexOf("OpenRouterHomework(OpenRouterLlm(timeoutMs = HOMEWORK_LLM_TIMEOUT_MS), llmKeys)");
    expect(refusal).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(refusal);
    expect(bridge).toContain("missingRefusalMessage(missing)");
    expect(bridge).toContain("allowProceed = true");
    expect(bridge).toContain("refusalJson(");
  });

  test("le contexte IA expose type, libellé, taille et troncature", () => {
    expect(bridge).toContain('put("context", aiContextJson(context))');
    expect(bridge).toContain('put("type", source.type.wire)');
    expect(bridge).toContain('put("label", source.label)');
    expect(bridge).toContain('put("chars", source.text.length)');
    expect(bridge).toContain('put("truncated", source.truncated)');
    // Aucun texte de source ne franchit le pont : seulement les métadonnées.
    expect(bridge).not.toContain('put("text", source.text)');
  });
});
