// #878 — l'autorité FileProvider est DÉRIVÉE de l'`applicationId`, et un type
// sans ouvreur rend un refus explicite au JS. La décision est compilée et
// EXÉCUTÉE par la parité ; le câblage manifeste/pont est lu dans les sources.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const DRIVER = join(ROOT, "agents/runtime/kotlin-parity/AttachmentViewerParityMain.kt");
const READ = (path: string) => readFileSync(path, "utf8");
const VIEWER = READ(join(APP, "AttachmentViewer.kt"));
const BRIDGE = codeOnly(READ(join(APP, "VsnBridge.kt")));
const RESOURCES = READ(join(APP, "VsnBridgeResources.kt"));
const REVISION = READ(join(APP, "VsnBridgeRevision.kt"));
const PHOTO = READ(join(APP, "PhotoCapture.kt"));
const MANIFEST = READ(join(ROOT, "android/app/src/main/AndroidManifest.xml"));

const skip = parityToolchain.skipReason !== null;
let link: ParityLink | null = null;
if (!skip) link = await parityToolchain.openParityLink(DRIVER);

interface Launch {
  authority: string;
  error: string | null;
}

async function launch(applicationId: string, canResolve: boolean): Promise<Launch> {
  return JSON.parse(await link!.ask({ applicationId, canResolve })) as Launch;
}

describe("FileProvider : autorité dérivée et ouvreur manquant (#878)", () => {
  test.skipIf(skip)("l'autorité suit l'applicationId, jamais un paquet recopié", async () => {
    for (const applicationId of ["fr.example", "com.autre.app", "x.y.debug"]) {
      const result = await launch(applicationId, true);
      expect(result.authority).toBe(`${applicationId}.fileprovider`);
      expect(result.authority).not.toContain("veryslopnynotes");
    }
  });

  test.skipIf(skip)("un ouvreur résolu ne produit aucun refus", async () => {
    const result = await launch("fr.example", true);
    expect(result.error).toBeNull();
  });

  test.skipIf(skip)("aucun ouvreur produit un message clair, pas un lancement silencieux", async () => {
    const result = await launch("fr.example", false);
    expect(result.error).toBe("Aucune application ne peut ouvrir ce fichier.");
    expect(result.error!.length).toBeGreaterThan(20);
  });

  test("la décision est PURE et compilée par la parité", () => {
    expect(VIEWER).not.toMatch(/^import\s+android\./m);
    expect(VIEWER).not.toContain("fr.veryslopnynotes.app.fileprovider");
    expect(READ(join(ROOT, "tests/unit/fixtures/parity-sources.ts"))).toContain(
      '"AttachmentViewer.kt"',
    );
  });

  test("le pont résout l'ouvreur AVANT de lancer, avec l'autorité du build", () => {
    const resolve = BRIDGE.indexOf("resolveActivity(activity.packageManager)");
    const start = BRIDGE.indexOf("activity.startActivity(intent)");
    expect(resolve).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(resolve);
    expect(BRIDGE).toContain("attachmentProviderAuthority(BuildConfig.APPLICATION_ID)");
    expect(BRIDGE).not.toContain("fr.veryslopnynotes.app.fileprovider");
    expect(PHOTO).toContain("attachmentProviderAuthority(BuildConfig.APPLICATION_ID)");
  });

  test("le refus remonte au JS (pièce jointe et export PDF)", () => {
    // `openFile` rend un message, et les deux appelants le publient.
    expect(BRIDGE).toContain("internal fun openFile(file: File, mime: String): String?");
    expect(RESOURCES).toContain("val viewerError = openFile(file, mimeOf(data.name))");
    expect(RESOURCES).toContain('put("ok", false).put("error", viewerError)');
    expect(REVISION).toContain('val viewerError = openFile(file, "application/pdf")');
    expect(REVISION).toContain('put("ok", false).put("message", viewerError)');
  });

  test("le manifeste dérive l'autorité et déclare la visibilité du viewer", () => {
    expect(MANIFEST).toContain('android:authorities="${applicationId}.fileprovider"');
    expect(MANIFEST).not.toContain("fr.veryslopnynotes.app.fileprovider");
    expect(MANIFEST).toMatch(/<queries>[\s\S]*android\.intent\.action\.VIEW/);
    expect(MANIFEST).toMatch(/<queries>[\s\S]*android:mimeType="\*\/\*"/);
  });
});
