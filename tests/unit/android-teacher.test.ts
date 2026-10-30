// #633 — le pont du professeur IA : méthode bornée, sortie validée, fil local
// purgé avec le compte. Le pont ne compile pas hors Gradle : son câblage est
// vérifié par lecture de source (même filet que les autres chemins IA).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readBridgeSource } from "./fixtures/bridge-source";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const BRIDGE = readBridgeSource();
const ALLOWLIST = readFileSync(join(APP, "BridgeCall.kt"), "utf8");
const STORE = readFileSync(join(DATA, "TeacherChatStore.kt"), "utf8");
const CORE_CHAT = readFileSync(join(CORE, "TeacherChat.kt"), "utf8");

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("pont professeur IA — méthode bornée et validée (#633)", () => {
  test("les quatre méthodes sont dans l'allowlist Kotlin", () => {
    for (const method of ["llm.teacherTurn", "teacher.load", "teacher.save", "teacher.delete"]) {
      expect(ALLOWLIST).toContain(`"${method}"`);
    }
  });

  test("le tour est borné AVANT l'appel et validé par le core", () => {
    const turn = between(BRIDGE, "internal fun VsnBridge.teacherTurn(", "internal fun VsnBridge.teacherFailureCode(");
    expect(turn).toContain('bounded(p.string("subject"), TeacherChat.MAX_SUBJECT_CHARS)');
    expect(turn).toContain('bounded(p.string("message"), TeacherChat.MAX_MESSAGE_CHARS)');
    expect(turn).toContain("TeacherMode.fromWire(");
    expect(turn).toContain("TeacherChat.requestTurn(");
    // La sortie est validée par TeacherChat.parseReply (sources fournies).
    expect(CORE_CHAT).toContain("fun parseReply(raw: JsonValue, allowedLabels: Set<String>): TeacherChatReply");
    expect(CORE_CHAT).toContain("if (!allowedLabels.contains(cited))");
    expect(CORE_CHAT).toContain("generateGuardedJson(provider");
  });

  test("aucune source = aucun appel payant", () => {
    const turn = between(BRIDGE, "internal fun VsnBridge.teacherTurn(", "internal fun VsnBridge.teacherFailureCode(");
    expect(turn).toContain("context.sources.isEmpty()");
    expect(turn).toContain("AiContextType.HISTORY");
    expect(turn.indexOf("context.sources.isEmpty()")).toBeLessThan(turn.indexOf("TeacherChat.requestTurn("));
  });

  test("la clé reste native et n'entre jamais dans le prompt", () => {
    const turn = between(BRIDGE, "internal fun VsnBridge.teacherTurn(", "internal fun VsnBridge.teacherFailureCode(");
    expect(turn).toContain("llmKeys.apiKey()");
    expect(turn).toContain("apiKey = apiKey");
    // Le prompt est construit dans TeacherChat à partir des DONNEES seules.
    const prompt = between(CORE_CHAT, "fun promptFor(", "fun requestTurn(");
    expect(prompt).not.toContain("apiKey");
    // La garde I4 couvre le prompt ET la sortie.
    expect(CORE_CHAT).toContain("generateGuardedJson(");
  });

  test("les causes d'échec sont bornées : clé, quota, timeout, vide, réseau", () => {
    const code = between(BRIDGE, "internal fun VsnBridge.teacherFailureCode(", "internal fun VsnBridge.aiContextForSubject(");
    for (const wire of ['"key"', '"quota"', '"timeout"', '"empty"', '"network"']) {
      expect(code).toContain(wire);
    }
    // Jamais le message brut d'une exception (hôte, compte) dans la réponse.
    expect(code).not.toContain('put("message", e.message');
    expect(code).not.toContain('put("message", e.userMessage');
  });

  test("la réponse ne transporte que du texte : aucun champ HTML", () => {
    const turn = between(BRIDGE, "internal fun VsnBridge.teacherTurn(", "internal fun VsnBridge.teacherFailureCode(");
    expect(turn).toContain('put("answer", reply.answer)');
    expect(turn).not.toMatch(/put\("html"/);
    expect(turn).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("fil local du professeur — offline et purge (#633)", () => {
  test("le fil vit dans offline/, purgé avec le compte (I16 bis)", () => {
    expect(BRIDGE).toContain('FileTeacherChatStore(File(ctx.filesDir, "offline/teacher_chat.json"))');
    expect(STORE).toContain("OfflineArtifacts.writeText(file, teacherThreadJson(bounded), epoch)");
    expect(STORE).toContain("SessionEpoch.writeIfCurrent(epoch)");
    expect(STORE).toContain("file.delete()");
  });

  test("l'écriture et la suppression portent l'époque de l'opération", () => {
    const save = between(BRIDGE, "internal fun VsnBridge.teacherSave(", "internal fun VsnBridge.teacherDelete(");
    expect(save).toContain("teacherChat.save(bounded, epoch)");
    // Jamais « ok » quand l'écriture a été abandonnée.
    expect(save).toContain('"Session modifiée : discussion non enregistrée."');
    const remove = between(BRIDGE, "internal fun VsnBridge.teacherDelete(", "internal fun VsnBridge.revisionFailure(");
    expect(remove).toContain("teacherChat.delete(epoch)");
    // Dispatch : l'époque est capturée à l'ARRIVÉE de l'appel.
    expect(BRIDGE).toContain('"teacher.save" -> teacherSave(p, epoch)');
    expect(BRIDGE).toContain('"teacher.delete" -> teacherDelete(epoch)');
  });

  test("le fil chargé est borné et validé, jamais un JSON arbitraire", () => {
    expect(STORE).toContain("TeacherChat.trimThread(parseTeacherThreadOrNull(raw) ?: TeacherThread())");
    expect(STORE).toContain("if (!TeacherChat.isThreadValid(bounded)) return false");
    expect(STORE).toContain("if (message.isValid()) messages.add(message)");
  });
});
