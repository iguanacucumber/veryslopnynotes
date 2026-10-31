// Le pont des exercices : proposition LOCALE, aide bornée, sortie validée.
// Le pont ne compile pas hors Gradle : câblage vérifié par lecture de source.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readBridgeSource } from "./fixtures/bridge-source";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const BRIDGE = readBridgeSource();
const ALLOWLIST = readFileSync(join(APP, "BridgeCall.kt"), "utf8");
const CORE_EXERCISES = readFileSync(join(CORE, "Exercises.kt"), "utf8");

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("pont exercices — proposition locale (#632)", () => {
  test("les deux méthodes sont dans l'allowlist Kotlin", () => {
    for (const method of ["exercises.propose", "exercises.help"]) {
      expect(ALLOWLIST).toContain(`"${method}"`);
    }
    expect(BRIDGE).toContain('"exercises.propose" -> exercisesPropose(p)');
    expect(BRIDGE).toContain('"exercises.help" -> exercisesHelp(p)');
  });

  test("proposer un exercice ne lance AUCUN appel payant", () => {
    const propose = between(BRIDGE, "internal fun VsnBridge.exercisesPropose(", "internal fun VsnBridge.exercisesHelp(");
    expect(propose).not.toContain("OpenRouterLlm");
    expect(propose).not.toContain("generateGuardedJson");
    // La proposition vient du texte DÉJÀ extrait du manuel et du cahier.
    expect(propose).toContain("manualDocFor(subject)");
    expect(propose).toContain("Exercises.extract(");
    expect(propose).toContain("LessonNotes.forSubject(");
    expect(propose).toContain("Exercises.filter(");
    // Aucun énoncé n'est fabriqué quand la source manque.
    expect(CORE_EXERCISES).toContain("if (text.isBlank() || label.isEmpty() || max <= 0) return emptyList()");
  });

  test("la matière et l'indice sont bornés avant lecture", () => {
    const propose = between(BRIDGE, "internal fun VsnBridge.exercisesPropose(", "internal fun VsnBridge.exercisesHelp(");
    expect(propose).toContain('bounded(p.string("subject"), TeacherChat.MAX_SUBJECT_CHARS)');
    expect(propose).toContain('bounded(p.string("hint"), Exercises.MAX_HINT_CHARS)');
    expect(propose).toContain("Exercises.MAX_EXERCISES");
  });

  test("une liste vide dit POURQUOI et propose une action stable", () => {
    const propose = between(BRIDGE, "internal fun VsnBridge.exercisesPropose(", "internal fun VsnBridge.exercisesHelp(");
    expect(propose).toContain('json.put("actions", JSONArray(actions))');
    expect(propose).toContain('"add_course"');
    expect(propose).toContain('"enable_manual"');
    expect(propose).toContain("Aucun exercice numéroté lisible");
  });
});

describe("pont exercices — aide bornée et validée (#632)", () => {
  test("le mode vient d'une liste fermée, jamais du modèle", () => {
    const help = between(BRIDGE, "internal fun VsnBridge.exercisesHelp(", "internal fun VsnBridge.teacherTurn(");
    expect(help).toContain("ExerciseHelpMode.fromWire(");
    expect(CORE_EXERCISES).toContain("HINT(\"hint\")");
    expect(CORE_EXERCISES).toContain("METHOD(\"method\")");
    expect(CORE_EXERCISES).toContain("CORRECTION(\"correction\")");
  });

  test("l'énoncé, le numéro et la réponse sont bornés", () => {
    const help = between(BRIDGE, "internal fun VsnBridge.exercisesHelp(", "internal fun VsnBridge.teacherTurn(");
    expect(help).toContain('bounded(p.string("number"), Exercises.MAX_NUMBER_CHARS)');
    expect(help).toContain('bounded(p.string("statement"), Exercises.MAX_STATEMENT_CHARS)');
    expect(help).toContain('bounded(p.string("answer"), Exercises.MAX_ANSWER_CHARS)');
  });

  test("une photo de réponse est transcrite AVANT l'appel, photo jetée ensuite", () => {
    const help = between(BRIDGE, "internal fun VsnBridge.exercisesHelp(", "internal fun VsnBridge.teacherTurn(");
    expect(help).toContain("awaitPhoto(photoSource)");
    expect(help).toContain("PhotoPrep.prepare(shot.file)");
    expect(help).toContain("photos.discard(shot.file)");
    expect(help).toContain("transcribeLesson(");
    expect(help).toContain("Photo illisible");
  });

  test("la clé reste native et la sortie est validée par le core", () => {
    const help = between(BRIDGE, "internal fun VsnBridge.exercisesHelp(", "internal fun VsnBridge.teacherTurn(");
    expect(help).toContain("llmKeys.apiKey()");
    expect(help).toContain("Exercises.requestHelp(");
    expect(help).toContain("apiKey = apiKey");
    const prompt = between(CORE_EXERCISES, "fun promptFor(", "fun requestHelp(");
    expect(prompt).not.toContain("apiKey");
    expect(CORE_EXERCISES).toContain("TeacherChat.parseReply(raw, allowed)");
    expect(CORE_EXERCISES).toContain("generateGuardedJson(");
  });

  test("aucune source = refus déterministe, aucun appel payant", () => {
    const help = between(BRIDGE, "internal fun VsnBridge.exercisesHelp(", "internal fun VsnBridge.teacherTurn(");
    expect(help).toContain("if (context.sources.isEmpty()) return refusalJson(context, ok = false)");
    expect(help.indexOf("context.sources.isEmpty()")).toBeLessThan(help.indexOf("Exercises.requestHelp("));
  });

  test("les échecs ont des causes bornées, jamais le message brut", () => {
    const help = between(BRIDGE, "internal fun VsnBridge.exercisesHelp(", "internal fun VsnBridge.teacherTurn(");
    for (const wire of ['"key"', '"format"', '"network"', '"secret"']) {
      expect(help).toContain(wire);
    }
    // Les causes transitoires passent par la table PARTAGÉE du professeur.
    expect(help).toContain("teacherFailureCode(e)");
    expect(help).not.toContain('put("message", e.message');
    expect(help).not.toContain('put("html"');
  });

  test("aucun effet métier : pas d'écriture ni d'appel Pronote", () => {
    const help = between(BRIDGE, "internal fun VsnBridge.exercisesHelp(", "internal fun VsnBridge.teacherTurn(");
    for (const forbidden of ["saveHome", "sendMessage", "markRead", "repo.write", "repo.refresh"]) {
      expect(help).not.toContain(forbidden);
    }
  });
});
