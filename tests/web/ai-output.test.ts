// #852 — toute sortie de l'assistant porte une étiquette visible, copiée et
// exportée ; le signalement réutilise le diagnostic borné, sans envoi auto.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AI_OUTPUT_LABEL,
  AI_OUTPUT_NOTE,
  AI_REPORT_NOTE,
  AiOutputLabel,
  withAiOutputLabel,
} from "../../web/src/features/assistant/AiOutput";

const WEB = join(import.meta.dir, "..", "..", "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = text.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe("IA — étiquette des sorties", () => {
  test("le libellé est visible et lisible sans la couleur", () => {
    const html = renderToStaticMarkup(createElement(AiOutputLabel, {}));
    expect(AI_OUTPUT_LABEL).toBe("IA — à vérifier");
    expect(html).toContain("IA — à vérifier");
    expect(html).toContain('role="note"');
    expect(AI_OUTPUT_NOTE).toContain("vérifie");
  });

  test("copier une réponse emporte l'étiquette", () => {
    const copied = withAiOutputLabel("Une réponse");
    expect(copied.startsWith(AI_OUTPUT_LABEL)).toBe(true);
    expect(copied).toContain("Une réponse");
    expect(source("features/tasks/HomeworkChat.tsx")).toContain(
      "withAiOutputLabel(turn.answer)",
    );
    expect(source("features/teacher/TeacherScreen.tsx")).toContain(
      "withAiOutputLabel(message.text)",
    );
  });

  test("chaque surface de sortie IA affiche l'étiquette et le signalement", () => {
    for (const path of [
      "features/tasks/HomeworkChat.tsx",
      "features/revisions/RevisionSheets.tsx",
      "features/teacher/TeacherScreen.tsx",
      "features/teacher/ExercisesScreen.tsx",
      "features/course-notes/CourseNotesScreen.tsx",
    ]) {
      const screen = source(path);
      expect({ path, label: screen.includes("<AiOutputLabel") }).toEqual({ path, label: true });
      expect({ path, report: screen.includes("<AiReportButton") }).toEqual({ path, report: true });
    }
  });

  test("le PDF exporté garde l'étiquette, même hors du DOM", () => {
    const kotlin = readFileSync(
      join(
        import.meta.dir,
        "..",
        "..",
        "android",
        "core",
        "src",
        "main",
        "java",
        "fr",
        "veryslopnynotes",
        "core",
        "RevisionSheet.kt",
      ),
      "utf8",
    );
    expect(kotlin).toContain('const val REVISION_AI_LABEL = "IA — à vérifier"');
    expect(kotlin).toContain("REVISION_AI_LABEL");
  });
});

describe("IA — signalement borné, jamais automatique", () => {
  const report = source("features/assistant/AiOutput.tsx");
  const settings = source("features/settings/DiagnosticExportCard.tsx");

  test("le signalement réutilise le diagnostic existant des Réglages", () => {
    expect(report).toContain(
      'import { DiagnosticFieldList } from "../settings/DiagnosticExportCard";',
    );
    expect(report).toContain("<DiagnosticFieldList fields={fields} />");
    expect(settings).toContain("export function DiagnosticFieldList");
    expect(settings).toContain("<DiagnosticFieldList fields={fields} />");
  });

  test("l'aperçu précède le partage ; aucun envoi automatique", () => {
    const prepare = between(report, "async function prepare()", "async function share()");
    const share = between(report, "async function share()", "function close()");
    expect(prepare).toContain("bridge.previewDiagnostic()");
    expect(prepare).not.toContain("shareDiagnostic");
    expect(share).toContain("bridge.shareDiagnostic()");
    // Le partage n'est atteignable que par le bouton du dialogue.
    expect(report).toContain("onClick={() => void share()}");
    expect(share.indexOf("bridge.shareDiagnostic()")).toBeLessThan(share.indexOf("setDone(true)"));
    expect(report).not.toContain("notify(");
  });

  test("le diagnostic nomme ce qu'il ne contient jamais", () => {
    expect(AI_REPORT_NOTE).toContain("ni ta question, ni la réponse, ni tes sources");
    expect(AI_REPORT_NOTE).toContain("ni un nom, une adresse ou un identifiant");
    expect(report).not.toContain("turn.answer");
    expect(report).not.toContain("message.text");
  });

  test("aucun réseau dans l'interface de signalement", () => {
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "sendBeacon",
      "WebSocket",
      "navigator.share",
      "window.open",
    ]) {
      expect({ forbidden, absent: !report.includes(forbidden) }).toEqual({
        forbidden,
        absent: true,
      });
    }
  });
});
