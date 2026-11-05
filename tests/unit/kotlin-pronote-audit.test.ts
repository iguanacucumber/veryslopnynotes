// Garde-fous de l'audit du module Pronote : erreurs typées non réessayées,
// HTML linéaire, repli de fin de cours monotone, cookie mis à jour et abandon
// traduit avant la classification de réessai.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const PRONOTE = join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote");

function source(name: string): string {
  return codeOnly(readFileSync(join(PRONOTE, name), "utf8"));
}

function slice(src: string, header: string, next: string): string {
  const start = src.indexOf(header);
  if (start === -1) return "";
  const end = src.indexOf(next, start);
  return src.slice(start, end === -1 ? src.length : end);
}

describe("audit Pronote : erreurs et parsing", () => {
  test("`initialise` ne réessaie jamais une page suspendue ou inattendue", () => {
    const init = slice(source("Communication.kt"), "fun initialise(clientIdentifier: String?)", "\n    }");
    expect(init).toContain("catch (e: IpSuspendedError)");
    expect(init).toContain("catch (e: UnexpectedPageError)");
    expect(init.indexOf("catch (e: IpSuspendedError)")).toBeLessThan(init.indexOf("catch (_: Exception)"));
    expect(init.indexOf("catch (e: UnexpectedPageError)")).toBeLessThan(init.indexOf("catch (_: Exception)"));
  });

  test("`htmlParse` est linéaire et laisse un point de code invalide intact", () => {
    const resolver = source("Resolver.kt");
    expect(resolver).not.toContain("DOT_MATCHES_ALL");
    expect(resolver).toContain("private fun stripTags(html: String): String");
    expect(resolver).toContain("Character.isValidCodePoint(code)");
  });

  test("la fin de cours de repli ne recule jamais avant le début", () => {
    const lesson = source("LessonModels.kt");
    expect(lesson).toContain("minOf(place + duree - 1, lastSlot)");
    expect(lesson).not.toContain("place % (size - 1)");
    expect(lesson).toContain("if (resolved.isBefore(start))");
    expect(lesson).toContain("throw ParsingError(\"Fin de cours");
    // Les deux lectures d'une pièce jointe portent l'origine de l'établissement.
    expect(lesson).toContain("RequestOpts(expectedOrigin = client.communication.rootSite)");
  });
});

describe("audit Pronote : session et transport", () => {
  test("`creationDate` est nullable et le cookie met à jour `hostOnly`", () => {
    expect(source("HomeworkModels.kt")).toContain("val creationDate: LocalDateTime? =");
    const http = source("HttpSession.kt");
    expect(http).toContain("var hostOnly: Boolean");
    expect(http).toContain("c.hostOnly = hostOnly");
  });

  test("le repli gzip brut n'accepte QUE « pas un gzip »", () => {
    const stream = slice(source("HttpSession.kt"), "private fun streamToFile(", "\n    }");
    expect(stream).toContain("if (e !is java.util.zip.ZipException) throw e");
  });

  test("un abandon traduit l'IOException avant le réessai", () => {
    const http = source("HttpSession.kt");
    expect(http).toContain("if (cancellation?.isCancelled == true && e !is RequestCancelled)");
    expect(http).toContain("throw RequestCancelled().also { it.initCause(e) }");
    expect(source("RetryPolicy.kt")).toContain("is RequestCancelled -> false");
  });
});
