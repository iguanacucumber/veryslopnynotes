// #405 : le rafraîchissement de session est ATOMIQUE.
//
// `ClientBase._refreshing` était un `var Boolean` nu (ni `@Volatile`, ni CAS)
// : le job de fond (`PeriodicSyncWorker.doWork()`) et la lecture de
// l'interface tombant en erreur en MÊME temps, les deux lisaient `false` et
// déclenchaient DEUX `refresh()` — donc deux `Communication` (deux cookies,
// deux compteurs de requêtes), le champ finissant sur celle qui avait fini la
// dernière, et chaque `login()` postant sur la `communication` courante :
// requêtes entrelacées, clé AES mélangée. Le serveur répondait alors `G=25`
// (« Exceeded max authorization requests ») ou la session restait à moitié
// initialisée. Le `@Synchronized` de `Communication.post` ne sauvait rien : le
// refresh se fait HORS de ce verrou.
//
// Ce test lit le VRAI source (le client ne se compile pas hors Gradle : il
// tire `java.net`, `java.time` et le transport). Le comportement COMPILÉ est
// prouvé par `tests/unit/kotlin-refresh-gate.test.ts` (Kotlin exécuté : un
// seul gagnant parmi N threads) et par
// `tests/unit/kotlin-pronote-client-parity.test.ts` (Kotlin exécuté contre le
// stub PRONOTE : un seul handshake de refresh, les deux fils réussissent, fil
// identique à la référence TS).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const PRONOTE = join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote");
const CLIENT = join(PRONOTE, "Client.kt");
const GATE = join(PRONOTE, "RefreshGate.kt");

/** Source à partir de `header`, jusqu'au `nextHeader` suivant. */
function slice(src: string, header: string, nextHeader: string): string {
  const start = src.indexOf(header);
  if (start === -1) return "";
  const end = src.indexOf(nextHeader, start);
  return src.slice(start, end === -1 ? src.length : end);
}

describe("rafraîchissement de session atomique (#405)", () => {
  test("le drapeau non atomique a disparu, la porte est un CAS", () => {
    const client = codeOnly(readFileSync(CLIENT, "utf8"));
    // Plus de `var _refreshing` : un booléen nu se lisait `false` dans deux
    // threads en même temps (deux refreshs = deux `Communication` = le bug).
    expect(client).not.toContain("_refreshing");
    // La porte remplace le drapeau.
    expect(client).toContain("RefreshGate()");
    // Et c'est un CAS : la lecture et la prise sont une seule opération.
    const gate = codeOnly(readFileSync(GATE, "utf8"));
    expect(gate).toContain("compareAndSet(false, true)");
  });

  test("post et refresh partagent le verrou de session", () => {
    const client = codeOnly(readFileSync(CLIENT, "utf8"));
    // Le moniteur du client sérialise les requêtes ET le refresh : le champ
    // `communication` n'est donc jamais permuté pendant qu'une requête est en
    // vol, et deux refreshs ne peuvent pas se chevaucher.
    expect(client).toMatch(/@Synchronized\s+override fun post\(/);
    expect(client).toMatch(/@Synchronized\s+fun refresh\(/);
    // L'état de session est PUBLIÉ (`@Volatile`) : les lecteurs hors verrou
    // (ping de garde, pièces jointes) voient la session neuve.
    expect(client).toMatch(/@Volatile\s+override lateinit var communication:/);
  });

  test("la porte est relâchée même quand le rafraîchissement échoue", () => {
    const client = codeOnly(readFileSync(CLIENT, "utf8"));
    const post = slice(client, "override fun post(", "\n    }\n");
    // La porte est PRISE avant le refresh (un refresh déjà en cours n'est pas
    // doublé) et RELÂCHÉE dans le `finally` (un refresh raté ne bloque pas
    // les suivants).
    expect(post).toContain("if (!refreshGate.tryEnter()) throw e");
    expect(post).toMatch(/finally\s*\{\s*refreshGate\.leave\(\)\s*\}/);
  });
});
