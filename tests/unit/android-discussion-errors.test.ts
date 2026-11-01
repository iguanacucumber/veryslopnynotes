// Écritures de messagerie : le fil fermé est reconnu par TYPE (R8 renomme
// `DiscussionClosed`), et un refus de destinataires n'est pas « Fil introuvable ».
// Le dépôt tire `android.os.Handler` : la STRUCTURE qui porte le contrat est
// épinglée par lecture, pas un miroir du calcul.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const SOURCE = join(
  ROOT,
  "android",
  "data",
  "src",
  "main",
  "java",
  "fr",
  "veryslopnynotes",
  "data",
  "DiscussionsRepository.kt",
);

const code = codeOnly(readFileSync(SOURCE, "utf8"));

describe("erreurs d'écriture d'un fil (#786)", () => {
  test("un fil fermé est classé par `is`, jamais par simpleName", () => {
    expect(code).toContain("import fr.veryslopnynotes.pronote.DiscussionClosed");
    expect(code).toContain("e is DiscussionClosed");
    expect(code).toContain('"$failure (Fil fermé)."');
    // R8 renomme la classe : `simpleName` perdrait le cas en release.
    expect(code).not.toContain("simpleName");
  });

  test("introuvable et destinataires inconnus ont des types et messages distincts", () => {
    expect(code).toContain("class DiscussionNotFound");
    expect(code).toContain("class UnknownRecipients");
    expect(code).toContain("throw DiscussionNotFound()");
    expect(code).toContain("throw UnknownRecipients()");
    expect(code).not.toContain('throw IllegalArgumentException("fil introuvable")');
    expect(code).not.toContain('throw IllegalArgumentException("destinataires inconnus")');
    expect(code).toContain('"$failure (Fil introuvable)."');
    expect(code).toContain('"$failure (Destinataires inconnus)."');
  });

  test("l'ordre des branches garde « introuvable » avant le générique", () => {
    const notFound = code.indexOf("e is DiscussionNotFound");
    const closed = code.indexOf("e is DiscussionClosed");
    const generic = code.indexOf("e is IllegalArgumentException");
    expect(notFound).toBeGreaterThan(-1);
    expect(closed).toBeGreaterThan(notFound);
    expect(generic).toBeGreaterThan(closed);
    // Deux branches typées AVANT le générique : chacune a son message.
    expect(code.indexOf("e is UnknownRecipients")).toBeGreaterThan(notFound);
  });
});
