// #855 — diagnostic de support : le VRAI Kotlin (`data/DiagnosticExport.kt`)
// est exécuté par le harnais. Chaque champ est validé contre une allowlist :
// une valeur hostile (nom, URL, jeton, PIN) devient « unknown », donc ne peut
// pas ressortir du fichier partagé.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { readBridgeSource } from "./fixtures/bridge-source";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents/runtime/kotlin-parity/DiagnosticExportMain.kt");
const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");

const skip = parityToolchain.skipReason !== null;
let link: ParityLink | null = null;
if (!skip) link = await parityToolchain.openParityLink(DRIVER);

const VALID = {
  generatedAt: "2026-11-04T09:30:00Z",
  appVersion: "0.1.0",
  androidVersion: "14",
  androidApi: 34,
  webViewVersion: "120.0.6099.230",
  errorCode: "unavailable",
  resource: "grades",
  classLevel: "Terminale",
  authState: "restored",
};

type Document = Record<string, unknown>;

async function build(overrides: Partial<typeof VALID> = {}): Promise<Document> {
  const out = JSON.parse(
    await link!.ask({ op: "build", ...VALID, ...overrides }),
  ) as { ok: boolean; json?: string };
  expect(out.ok).toBe(true);
  return JSON.parse(out.json!) as Document;
}

describe("diagnostic de support — champs fermés (#855)", () => {
  test.skipIf(skip)("le fichier ne porte que les champs attendus", async () => {
    const doc = await build();
    expect(Object.keys(doc).sort()).toEqual(
      [
        "format",
        "schemaVersion",
        "generatedAt",
        "appVersion",
        "androidVersion",
        "androidApi",
        "webViewVersion",
        "errorCode",
        "resource",
        "classLevel",
        "authState",
        "withheld",
      ].sort(),
    );
    expect(doc).toMatchObject({
      format: "veryslopnynotes.diagnostic",
      schemaVersion: 1,
      generatedAt: "2026-11-04T09:30:00Z",
      appVersion: "0.1.0",
      androidVersion: "14",
      androidApi: 34,
      webViewVersion: "120.0.6099.230",
      errorCode: "unavailable",
      resource: "grades",
      classLevel: "Terminale",
      authState: "restored",
    });
    expect(doc["withheld"]).toEqual([
      "payloads",
      "names",
      "urls",
      "credentials",
      "tokens",
      "qr",
      "pin",
      "schoolData",
      "logs",
    ]);
  });

  test.skipIf(skip)("version, niveau et états acceptent seulement leurs formes connues", async () => {
    expect((await build({ appVersion: "v0.1.0" })).appVersion).toBe("unknown");
    expect((await build({ androidVersion: "14 (build)" })).androidVersion).toBe("unknown");
    expect((await build({ webViewVersion: "120.0.6099.230 (x)" })).webViewVersion).toBe("unknown");
    expect((await build({ androidApi: 0 })).androidApi).toBe(0);
    expect((await build({ androidApi: 999_999 })).androidApi).toBe(0);
    expect((await build({ errorCode: "session_incomplete" })).errorCode).toBe("session_incomplete");
    expect((await build({ errorCode: "network" })).errorCode).toBe("network");
    expect((await build({ resource: "resources" })).resource).toBe("resources");
    expect((await build({ classLevel: "2de" })).classLevel).toBe("2de");
    expect((await build({ authState: "offline" })).authState).toBe("offline");
  });

  test.skipIf(skip)("aucune valeur hostile ne peut ressortir, champ par champ", async () => {
    const name = "Zoe Dupont";
    const url = "https://example.invalid/private";
    const pin = "PIN 4242";
    const doc = await build({
      generatedAt: `${VALID.generatedAt} ${name} ${url} ${pin}`,
      appVersion: name,
      androidVersion: `${name} ${url}`,
      androidApi: 999_999,
      webViewVersion: `120.0.6099.230 ${name}`,
      errorCode: `credential_${name}`,
      resource: `https://example.invalid/${name}`,
      classLevel: `2nde A ${name}`,
      authState: `Bearer ${name}`,
    });
    expect(doc).toMatchObject({
      generatedAt: "unknown",
      appVersion: "unknown",
      androidVersion: "unknown",
      androidApi: 0,
      webViewVersion: "unknown",
      errorCode: "unknown",
      resource: "unknown",
      classLevel: "unknown",
      authState: "unknown",
    });
    const text = JSON.stringify(doc);
    for (const secret of [name, "Dupont", "example.invalid", "PIN 4242", "Bearer"]) {
      expect(text).not.toContain(secret);
    }
  });

  test.skipIf(skip)("une ressource hors allowlist ne nomme pas un écran ou une matière", async () => {
    for (const hostile of ["alice.smith", "Mathématiques", "https://school.example", "Alice"]) {
      expect((await build({ resource: hostile })).resource).toBe("unknown");
    }
    for (const hostile of ["alice", "Zoe Dupont", "token=abc"]) {
      expect((await build({ errorCode: hostile })).errorCode).toBe("unknown");
    }
    for (const hostile of ["2nde A", "Alice", "TG2"]) {
      expect((await build({ classLevel: hostile })).classLevel).toBe("unknown");
    }
  });
});

describe("diagnostic de support — câblage partage local (#855)", () => {
  const bridge = codeOnly(readFileSync(join(APP, "VsnBridgeDiagnostics.kt"), "utf8"));
  const allBridge = codeOnly(readBridgeSource());
  const model = codeOnly(readFileSync(join(DATA, "DiagnosticExport.kt"), "utf8"));
  const call = readFileSync(join(APP, "BridgeCall.kt"), "utf8");
  const types = readFileSync(join(ROOT, "web/src/bridge/types.ts"), "utf8");
  const card = readFileSync(
    join(ROOT, "web/src/features/settings/DiagnosticExportCard.tsx"),
    "utf8",
  );

  test("le fichier part au sélecteur Android, depuis le cache purgé avec le compte", () => {
    expect(bridge).toContain("DownloadedFiles.EXPORTS");
    expect(bridge).toContain('shareFile(file, "application/json"');
    expect(allBridge).toContain("Intent.ACTION_SEND");
    expect(bridge).not.toContain("currentBaseUrl");
    expect(bridge).not.toContain("llmKeys");
    expect(bridge).not.toContain("SessionStore");
    expect(bridge).not.toContain("http");
  });

  test("le module ne publie que des champs validés, et le niveau reste grossier", () => {
    expect(model).toContain("ERROR_CODES");
    expect(model).toContain("AUTH_STATES");
    expect(model).toContain("CLASS_LEVELS");
    expect(model).toContain("RESOURCES");
    expect(model).toContain("WITHHELD");
    expect(bridge).toContain("ManualCatalog.levelLabel(ManualCatalog.levelOf(");
    // La classe COMPLÈTE n'est jamais passée au constructeur du diagnostic.
    expect(bridge).not.toContain("classLabel =");
  });

  test("l'aperçu est figé, l'interface l'affiche avant le partage", () => {
    const preview = bridge.slice(
      bridge.indexOf("fun VsnBridge.previewDiagnostic"),
      bridge.indexOf("fun VsnBridge.shareDiagnostic"),
    );
    expect(preview).toContain("diagnosticPreview.put");
    expect(bridge).toContain("diagnosticPreview.peek()");
    expect(card).toContain("bridge.previewDiagnostic");
    expect(card).toContain("bridge.shareDiagnostic");
    expect(card).toContain("orderedFields(fields)");
    expect(card).toContain("Rien n’est envoyé");
  });

  test("les deux méthodes sont allowlistées des deux côtés", () => {
    for (const method of ["diagnostics.preview", "diagnostics.share"]) {
      expect(call).toContain(`"${method}"`);
      expect(types).toContain(`"${method}"`);
    }
  });
});
