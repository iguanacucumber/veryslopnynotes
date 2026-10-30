// #628 — le contexte IA est assemblé UNE fois pour tous les points d'entrée.
//
// VRAI Kotlin exécuté : `android/core/AiContext.kt` est compilé par le harnais
// et piloté par `agents/runtime/kotlin-parity/AiContextMain.kt`. Les assertions
// portent donc sur le code de production : priorité, budgets, déduplication,
// troncature signalée, refus vide et parité texte/photo/fiche/chat.
//
// Le pont (`app/VsnBridge.kt`) ne compile pas hors Gradle : son câblage est
// vérifié par lecture de source, comme les autres chemins IA.
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
    // Le budget TOTAL est le plafond de la garde I5, plus petit que 8 x 2 000 :
    // il borne réellement le prompt, pas seulement le nombre de sources.
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
    // Déterministe : même corpus exploitable = même refus (l'élément vide est
    // bien écarté, mais le refus et ses CTA ne changent pas).
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
    // L'historique est BORNÉ : au plus 6 des derniers tours, et le budget total
    // peut en couper davantage. Au-delà, le chat ne reçoit pas tout.
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
    // Le pilote lit stdin ligne par ligne : des `ask` concurrents se disputent
    // le flux et peuvent perdre une réponse. La parité se rejoue donc en série.
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
    // #631 : les trois chemins qui lisent un devoir passent la SEMAINE affichée
    // et l'époque de session, parce que les pièces jointes se téléchargent et
    // s'écrivent dans le cache du compte (I26).
    expect(bridge).toContain("aiContextFor(assignment, AiContextEntry.HOMEWORK, week, epoch)");
    expect(bridge).toContain("aiContextFor(assignment, AiContextEntry.PHOTO, week, epoch)");
    expect(bridge).toContain("aiContextFor(assignment, AiContextEntry.REVISION, week, epoch)");
    // Plus de collecte parallèle par chemin.
    expect(bridge).not.toContain("homeworkSourcesFor");
    expect(bridge).not.toContain("revisionChunks");
  });

  test("le corpus vide refuse AVANT l'appel payant", () => {
    const refusal = bridge.indexOf("if (context.sources.isEmpty())");
    const call = bridge.indexOf("OpenRouterHomework(OpenRouterLlm(timeoutMs = AWAIT_LLM_MS), llmKeys).generate");
    expect(refusal).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(refusal);
    expect(bridge).toContain("refusalJson(context)");
  });

  test("« Ce qui est envoyé » expose type, libellé, taille et troncature", () => {
    expect(bridge).toContain('put("context", aiContextJson(context))');
    expect(bridge).toContain('put("type", source.type.wire)');
    expect(bridge).toContain('put("label", source.label)');
    expect(bridge).toContain('put("chars", source.text.length)');
    expect(bridge).toContain('put("truncated", source.truncated)');
    // Aucun texte de source ne franchit le pont : seulement les métadonnées.
    expect(bridge).not.toContain('put("text", source.text)');
  });
});
