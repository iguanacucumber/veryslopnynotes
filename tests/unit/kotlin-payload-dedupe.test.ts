// #570 : une absence, un retard, un devoir — PUBLIÉS UNE SEULE FOIS.
//
// La même absence (même `N` Pronote) est renvoyée par CHACUNE des périodes
// dont la plage la recouvre : sans déduplication, elle était publiée deux
// fois ET comptée deux fois (les compteurs de vie scolaire étaient doublés).
// Même cause pour les devoirs : le cache garde une entrée par fenêtre de
// semaine (#477), et la fusion des payloads répétait le même devoir.
//
// `PronotePayloads.kt` est du Kotlin Android (`org.json`, module `data`) : il
// ne compile pas hors Gradle et n'est pas dans le jar de parité
// (`tests/unit/fixtures/parity-sources.ts` ne liste que du Kotlin pur). Le
// câblage est donc épinglé par LECTURE DE SOURCE — même limite que
// `kotlin-discussions-freshness.test.ts`. Le COMPORTEMENT des lecteurs web,
// lui, est EXÉCUTÉ (`tests/web/social.test.ts`, `tests/web/home.test.ts`,
// `tests/web/tasks.test.ts`).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");

const source = (path: string): string => readFileSync(path, "utf8");

/** Corps d'une fonction de niveau fichier (accolade fermante en colonne 0). */
function kotlinBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`signature introuvable dans la source : ${signature}`);
  const end = src.indexOf("\n}\n", start);
  if (end < 0) throw new Error(`fin de fonction introuvable : ${signature}`);
  return src.slice(start, end);
}

/** Région entre deux marqueurs (une fonction imbriquée n'a pas de `}` en
 *  colonne 0 : on borne par la signature suivante). */
function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  if (start < 0) throw new Error(`début introuvable : ${from}`);
  const end = src.indexOf(to, start);
  if (end < 0) throw new Error(`fin introuvable : ${to}`);
  return src.slice(start, end);
}

const payloads = source(join(DATA, "PronotePayloads.kt"));
const repository = source(join(DATA, "AssignmentsRepository.kt"));
const bridge = source(join(APP, "VsnBridge.kt"));
const sessionFailure = source(join(DATA, "SessionFailure.kt"));
const pairing = source(join(DATA, "PairingRepository.kt"));
const pairingMessages = source(join(APP, "PairingMessages.kt"));

const attendance = kotlinBody(payloads, "internal fun attendancePayload");
const assignments = kotlinBody(payloads, "internal fun assignmentsPayload");
const grades = kotlinBody(payloads, "internal fun gradesPayload");
const homeworkId = between(payloads, "private fun homeworkIdOf", "internal fun assignmentJson");
const parse = between(repository, "fun parse(body: String)", "fun fromJson");
const loadAssignments = between(bridge, "private fun loadAssignments", "// --- Fiches de révision");

describe("vie scolaire : une absence publiée une seule fois (#570)", () => {
  test("la ligne parue dans deux périodes n'est comptée qu'une fois", () => {
    // Un ENSEMBLE d'identifiants vus, partagé par TOUTES les périodes : la
    // même absence (`N` Pronote) est renvoyée par chaque période dont la
    // plage la recouvre.
    expect(attendance).toContain("val seen = HashSet<String>()");
    // La ligne dont l'identifiant est déjà vu est ÉCARTÉE (avant d'être
    // publiée et avant d'être comptée).
    expect(attendance.match(/if \(!seen\.add\([^)]*\)\) continue/g) ?? []).toHaveLength(2);
    // La déduplication est par IDENTIFIANT, jamais par contenu (matière,
    // date, motif) : deux absences RÉELLES distinctes ne sont jamais
    // confondues.
    expect(attendance.match(/seen\.add\(([^)]*)\)/g)).toEqual([
      'seen.add("absence:$id")',
      'seen.add("late:$id")',
    ]);
  });

  // Les absences et les retards sont numérotés par DEUX TABLEES Pronote
  // indépendantes : une absence `N = 12` et un retard `N = 12` sont deux
  // enregistrements DIFFÉRENTS. Un ensemble partagé les confondrait — le
  // second disparaîtrait de l'écran (perte de donnée).
  test("une absence et un retard de même identifiant ne se cachent pas (#570)", () => {
    // La clé de déduplication porte le KIND.
    expect(attendance).toContain('seen.add("absence:$id")');
    expect(attendance).toContain('seen.add("late:$id")');
    // L'identité n'est JAMAIS l'identifiant seul.
    expect(attendance).not.toMatch(/seen\.add\(id\)/);
    expect(attendance).not.toMatch(/seen\.add\("\$\{?id/);
  });

  test("le repli d'identifiant est unique dans le payload", () => {
    // Deux périodes ne forgent JAMAIS le même identifiant pour deux absences
    // DIFFÉRENTES : le repli porte le numéro de période.
    expect(attendance).toContain('a.id.ifBlank { "abs-$periodIndex-$i" }');
    expect(attendance).toContain('d.id.ifBlank { "late-$periodIndex-$i" }');
    // L'ancien repli positionnel (`abs-$i`) rejouait `abs-0` dans chaque
    // période : deux absences différentes portaient le même identifiant.
    expect(attendance).not.toContain('a.id.ifBlank { "abs-$i" }');
    expect(attendance).not.toContain('d.id.ifBlank { "late-$i" }');
  });

  test("les compteurs sont calculés depuis les lignes dédupliquées", () => {
    // Le compteur est incrémenté au moment de PUBLIER la ligne : une ligne
    // écartée par la déduplication n'est jamais comptée.
    const publish = attendance.indexOf("absences.put(obj)");
    const counter = attendance.indexOf('cur.put("absences"');
    expect(publish).toBeGreaterThan(-1);
    expect(counter).toBeGreaterThan(publish);
    // La déduplication précède la publication (les lignes dédupliquées
    // seules arrivent au compteur).
    const dedupe = attendance.indexOf('if (!seen.add("absence:$id")) continue');
    expect(dedupe).toBeGreaterThan(-1);
    expect(dedupe).toBeLessThan(publish);
  });
});

describe("devoirs : un devoir publié une seule fois (#570)", () => {
  test("le même devoir n'est publié qu'une fois", () => {
    expect(assignments).toContain("val seen = HashSet<String>()");
    expect(assignments).toContain("if (!seen.add(id)) return@forEachIndexed");
    // La déduplication est par IDENTIFIANT, jamais par matière+date+titre :
    // deux devoirs RÉELS qui se ressemblent ne sont jamais confondus.
    expect(assignments.match(/seen\.add\(([^)]*)\)/g)).toEqual(["seen.add(id)"]);
  });

  test("le repli d'identifiant est unique dans le payload ET par fenêtre", () => {
    // L'identifiant Pronote quand il existe (c'est l'identité du devoir :
    // le toggle le renvoie tel quel) ; sinon un repli qui ne peut PAS
    // confondre deux fenêtres différentes (deux entrées de cache, #477).
    expect(homeworkId).toContain("hw.id.ifBlank");
    expect(homeworkId).toContain('"a-$scope-$index"');
    expect(assignments).toContain("homeworkIdOf(hw, i, scope)");
    // La fenêtre servie scopes le repli.
    expect(assignments).toContain('val scope = "${from.toLocalDate()}-${to.toLocalDate()}"');
    // L'ancien repli positionnel (`a-$index`) était partagé par toutes les
    // fenêtres : la fusion pouvait effacer un devoir RÉEL.
    expect(payloads).not.toContain('hw.id.ifBlank { "a-$index" }');
  });
});

describe("notes : une période lue une fois, une note publiée une fois", () => {
  test("un seul DernieresNotes par période", () => {
    // Le snapshot `Period.notes()` porte notes + moyennes + moyenne générale :
    // le payload ne rappelle PLUS `grades()`, `averages()` ni
    // `overallAverage()` (trois POST pour le même écran).
    expect(grades).toContain("p.notes()");
    expect(grades).not.toContain("p.grades()");
    expect(grades).not.toContain("p.averages()");
    expect(grades).not.toContain("p.overallAverage()");
    expect(grades).not.toContain("DernieresNotes");
    // La période DEMANDÉE vient du snapshot déjà lu, pas d'une seconde lecture.
    expect(grades).toContain("snapshots[pid] = notes");
    expect(grades).toContain("snapshots[id]?.let { mapProvided(id, it) }");
  });

  test("une note parue dans deux périodes n'est publiée qu'une fois", () => {
    // La déduplication est par IDENTIFIANT Pronote NON VIDE, jamais par
    // contenu : deux notes réelles qui se ressemblent ne sont pas confondues.
    expect(grades).toContain("if (g.id.isBlank())");
    expect(grades).toContain("positionById[g.id]");
    expect(grades).toContain("all[existing] = mapped");
    // La période la plus PRÉCISE (la plus courte) gagne : un semestre ne doit
    // pas usurper la note de son trimestre.
    expect(grades).toContain("spanById");
    expect(grades).toContain("span < (spanOfId[g.id] ?: Long.MAX_VALUE)");
    // Aucune déduplication par matière/date/valeur.
    expect(grades).not.toContain("distinctBy");
  });

  test("la période PORTÉE par la ligne prime, sans identifiant périmé", () => {
    // `Period.instances` est un registre global jamais vidé : un identifiant
    // d'une session précédente ne doit pas rattacher la note à un autre compte.
    expect(grades).toContain("g.period?.id?.takeIf { it in currentIds } ?: pid");
    expect(grades).toContain("val currentIds = periods.mapNotNullTo(HashSet())");
  });

  test("le rate-limit n'est jamais avalé par une lecture tolérante", () => {
    // Une limitation de débit publiée comme « trimestre vide » serait écrite
    // dans le cache et servie pendant des heures.
    expect(sessionFailure).toContain("internal fun mustPropagateReadFailure");
    expect(sessionFailure).toContain("e is RateLimitedError");
    expect(payloads).toContain("mustPropagateReadFailure(e)");
    // Plus aucune lecture ne confond « session morte » et « rate-limit » en
    // laissant filer le second.
    expect(payloads).not.toContain("isSessionFailure(e)) throw e");
  });

  test("l'appairage distingue le rate-limit d'un compte refusé", () => {
    expect(pairing).toContain('PairingResult.Err("rate_limited"');
    expect(pairing).toContain("G_RATE_LIMIT = 25");
    // Le code 25 ne doit JAMAIS retomber dans « compte refusé ».
    expect(pairing).not.toContain("pronoteErrorCode != G_RATE_LIMIT");
    expect(pairingMessages).toContain('"rate_limited"');
  });
});

describe("dépôt et pont : une entrée par devoir (#570)", () => {
  test("le parseur du dépôt écarte l'identifiant déjà lu", () => {
    expect(parse).toContain("val seen = HashSet<String>()");
    expect(parse).toContain("if (!seen.add(a.id)) continue");
  });

  test("la fusion des payloads en cache est dédupliquée", () => {
    // Le cache garde une entrée par requête (fenêtre de semaine) : la même
    // fusion répétait le même devoir.
    expect(loadAssignments).toContain(".distinctBy { it.id }");
  });
});
