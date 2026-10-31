// Le rafraîchissement de session est ATOMIQUE : `ClientBase._refreshing` était un
// `Boolean` nu, et deux threads pouvaient lancer DEUX `refresh()` (deux
// `Communication`, clé AES mélangée, `G=25` côté serveur). La porte est un CAS.
//
// Ce test lit le VRAI source, qui ne se compile pas hors Gradle (`java.net`,
// `java.time`) ; le comportement compilé est prouvé par
// `tests/unit/kotlin-refresh-gate.test.ts` et `kotlin-pronote-client-parity.test.ts`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const PRONOTE = join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote");
const CLIENT = join(PRONOTE, "Client.kt");
const GATE = join(PRONOTE, "RefreshGate.kt");

function slice(src: string, header: string, nextHeader: string): string {
  const start = src.indexOf(header);
  if (start === -1) return "";
  const end = src.indexOf(nextHeader, start);
  return src.slice(start, end === -1 ? src.length : end);
}

describe("rafraîchissement de session atomique (#405)", () => {
  test("le drapeau non atomique a disparu, la porte est un CAS", () => {
    const client = codeOnly(readFileSync(CLIENT, "utf8"));
    // Un booléen nu se lisait `false` dans deux threads en même temps.
    expect(client).not.toContain("_refreshing");
    expect(client).toContain("RefreshGate()");
    const gate = codeOnly(readFileSync(GATE, "utf8"));
    expect(gate).toContain("compareAndSet(false, true)");
  });

  test("post et refresh partagent le verrou de session", () => {
    const client = codeOnly(readFileSync(CLIENT, "utf8"));
    // Le moniteur du client sérialise les requêtes ET le refresh : le champ
    // `communication` n'est jamais permuté pendant qu'une requête est en vol.
    expect(client).toMatch(/@Synchronized\s+override fun post\(/);
    // `open` : le pilote de parité dérive un client dont le refresh est
    // observable sans réseau.
    expect(client).toMatch(/@Synchronized\s+open fun refresh\(/);
    // Les lecteurs hors verrou (ping de garde, pièces jointes) voient la
    // session neuve.
    expect(client).toMatch(/@Volatile\s+override lateinit var communication:/);
  });

  test("la porte est relâchée même quand le rafraîchissement échoue", () => {
    const client = codeOnly(readFileSync(CLIENT, "utf8"));
    // Le rejeu vit dans `sendWithRefresh` : `post` prépare l'enveloppe et la clé.
    // La porte est PRISE avant le refresh (pas de doublon) et RELÂCHÉE dans le
    // `finally` (un refresh raté ne bloque pas les suivants).
    const retry = slice(client, "private fun sendWithRefresh(", "\n    }\n");
    expect(retry).toContain("if (!refreshGate.tryEnter()) throw e");
    expect(retry).toMatch(/finally\s*\{\s*refreshGate\.leave\(\)\s*\}/);
    expect(retry).toContain("send(functionName, postData)");
  });
});
