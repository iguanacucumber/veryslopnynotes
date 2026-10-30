// #427 : un fil dont la fraîcheur est INCONNUE ne doit pas être daté
// « maintenant ».
//
// `discussionsPayload` (module `data`) n'enrichit que les 12 premiers fils :
// au-delà, la date du dernier message est inconnue. Le champ `updatedAt`
// partait alors à `nowIso` — les plus anciens fils REMONTAIENT en tête de la
// liste et le payload mentait sur leur fraîcheur.
//
// `PronotePayloads.kt` est du Kotlin Android (`org.json`, module `data`) : il
// ne compile pas hors Gradle et n'est pas dans le jar de parité
// (`tests/unit/fixtures/parity-sources.ts` ne liste que du Kotlin pur). Le
// câblage est donc épinglé par LECTURE DE SOURCE — même limite que le
// miroir `android-homework` (cf. `kotlin-cache-invalidation.test.ts`). Le
// CONTRAT TS, lui, est exécuté : il doit accepter un fil sans fraîcheur
// (comme il accepte un fil sans `lastMessageAt`).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDiscussion } from "../../shared/contracts/models";
import { ROOT } from "./fixtures/kotlin-harness";
import { payloadsSource } from "./fixtures/payload-sources";

const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");

const source = (path: string): string => readFileSync(path, "utf8");

/** Corps d'une fonction de niveau fichier (accolade fermante en colonne 0). */
function kotlinBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`signature introuvable dans la source : ${signature}`);
  const end = src.indexOf("\n}\n", start);
  if (end < 0) throw new Error(`fin de fonction introuvable : ${signature}`);
  return src.slice(start, end);
}

const payloads = payloadsSource();
const body = kotlinBody(payloads, "internal fun discussionsPayload");
const core = source(join(CORE, "Discussion.kt"));

describe("fraîcheur des fils : jamais de date inventée (#427)", () => {
  test("le payload n'affabrique pas « maintenant » pour un fil non enrichi", () => {
    // La fraîcheur part INCONNUE (null), pas à « maintenant ».
    expect(body).toMatch(/var updatedAt: String\? = null/);
    expect(body).not.toMatch(/updatedAt\s*=\s*nowIso/);
    expect(body).not.toContain("var updatedAt = nowIso");
  });

  test("`updatedAt` n'est écrit que si une date RÉELLE est connue", () => {
    // `putIf` (helper du fichier) n'écrit que si la valeur est présente :
    // le champ est donc OMIS du JSON pour un fil non enrichi.
    expect(body).toContain('putIf("updatedAt", updatedAt)');
    expect(body).not.toContain('put("updatedAt", updatedAt)');
    expect(body).toContain('lastMessageAt?.let { put("lastMessageAt", it) }');
    // Le helper : une valeur nulle ou vide n'est PAS écrite.
    expect(payloads).toContain(
      "internal fun JSONObject.putIf(key: String, value: String?) {\n    if (!value.isNullOrEmpty()) put(key, value)\n}",
    );
    // La borne d'enrichissement est inchangée (12 fils) : c'est la limite de
    // réseau, pas le correctif.
    expect(payloads).toContain("private const val DISCUSSION_ENRICH_LIMIT = 12");
    expect(body).toContain("if (i < DISCUSSION_ENRICH_LIMIT)");
  });

  test("le JSON reste valide : le fil garde son identifiant et son sujet", () => {
    expect(body).toContain('put("id", id)');
    expect(body).toContain('put("subject"');
    expect(body).toContain('put("discussions", arr)');
    // #476 : les participants ne sont PLUS dans la liste (ils sont demandés
    // à l'ouverture du fil) : le champ est OMIS, jamais une liste vide qui
    // ferait croire à un fil sans interlocuteur.
    expect(body).not.toContain('put("participants"');
  });

  test("le miroir Kotlin accepte un fil de fraîcheur inconnue", () => {
    // `core.Discussion` (miroir du contrat) : une fraîcheur vide = une
    // fraîcheur INCONNUE, pas une ligne cassée. Le fil existe, il est affiché.
    expect(core).toContain("val updatedAt: String");
    expect(core).not.toContain("updatedAt.isNotBlank()");
  });
});

describe("contrat : un fil sans fraîcheur est un fil VALIDE (#427)", () => {
  test("le contrat accepte l'absence de `updatedAt`", () => {
    expect(
      isDiscussion({ id: "d-fake-1", subject: "Sortie", participants: ["Mme Claire Fake"] }),
    ).toBe(true);
  });

  test("le contrat refuse toujours une freshness illisible", () => {
    expect(
      isDiscussion({
        id: "d-fake-1",
        subject: "Sortie",
        participants: [],
        updatedAt: "n'importe quoi",
      }),
    ).toBe(false);
  });
});
