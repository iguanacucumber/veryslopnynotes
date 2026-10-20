import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSeq } from "../../web/src/lib/seq";

useParisTz();

const ROOT = join(import.meta.dir, "..", "..");

// #501 : ouvrir le fil A, revenir à la liste, ouvrir le fil B — la réponse de
// A arrivant APRÈS celle de B affichait les messages de A sous l'en-tête de B.
//
// Le dépôt n'a pas de rendu React dans les tests : la règle est donc dans une
// fonction pure (`web/src/lib/seq.ts`), testée ici, et l'écran l'UTILISE
// (vérifié par le garde de source ci-dessous).
describe("web messagerie : une réponse périmée n'écrit plus dans l'écran", () => {
  test("la séquence ignore la réponse d'une demande dépassée", () => {
    const seq = createSeq();
    const a = seq.next();
    const b = seq.next();
    // A est périmée (B est demandée après) : sa réponse est ignorée.
    expect(seq.isCurrent(a)).toBe(false);
    expect(seq.isCurrent(b)).toBe(true);
  });

  test("invalider une demande en vol la rend périmée", () => {
    const seq = createSeq();
    const a = seq.next();
    expect(seq.isCurrent(a)).toBe(true);
    seq.invalidate();
    expect(seq.isCurrent(a)).toBe(false);
  });

  test("l'écran de messagerie utilise la séquence pour ses deux chargements", () => {
    const route = readFileSync(join(ROOT, "web/src/routes/messages.tsx"), "utf8");
    // Le fil ET la liste : une réponse périmée ne doit rien écrire.
    expect(route).toContain("createSeq()");
    expect(route).toContain("threadSeq.current.next()");
    expect(route).toContain("threadsSeq.current.next()");
    expect(route).toContain("threadSeq.current.isCurrent(seq)");
    // Refermer le fil invalide la demande en vol.
    expect(route).toContain("threadSeq.current.invalidate()");
  });
});
