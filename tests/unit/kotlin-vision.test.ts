// #587 : photo de cours -> texte. Le prompt vision est une DONNÉE, l'image
// est bornée, la réponse est validée par le schéma.
//
// VRAI Kotlin exécuté : `core/Vision.kt` et `core/LessonAi.kt` sont compilés
// par le harnais puis pilotés par `VisionMain.kt`. Le ré-encodage Android
// (`PhotoPrep.kt`) est vérifié par un test de source : il tourne sur le
// téléphone, pas sous `kotlinc`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "VisionMain.kt");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask(op: unknown, allowError = false): Promise<any> {
  return JSON.parse(await link!.ask(op, { allowError }));
}

/** Un JPEG minimal, base64 valide (le core ne décode pas l'image). */
const IMAGE = "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";

describe("photo de cours — garde d'image exécutée (#587)", () => {
  test.skipIf(skip)("seuls les types bitmap bornés passent", async () => {
    expect((await ask({ op: "imageValid", mime: "image/jpeg", base64: IMAGE })).valid).toBe(true);
    expect((await ask({ op: "imageValid", mime: "image/svg+xml", base64: IMAGE })).valid).toBe(false);
    expect((await ask({ op: "imageValid", mime: "text/html", base64: IMAGE })).valid).toBe(false);
    expect((await ask({ op: "imageValid", mime: "image/jpeg", base64: "pas base64 !!" })).valid).toBe(false);
    // Au-delà de la borne base64 : refus, même si les caractères sont valides.
    expect((await ask({ op: "imageValid", mime: "image/jpeg", base64: "A".repeat(2_800_004) })).valid).toBe(false);
  });

  test.skipIf(skip)("la taille décodée est estimée sans allouer l'image", async () => {
    // "AAAA" = 3 octets décodés, "AAA=" = 2, "AA==" = 1.
    expect((await ask({ op: "decodedSize", base64: "AAAA" })).size).toBe(3);
    expect((await ask({ op: "decodedSize", base64: "AAA=" })).size).toBe(2);
    expect((await ask({ op: "decodedSize", base64: "AA==" })).size).toBe(1);
  });

  test.skipIf(skip)("une transcription JSON est validée, jamais réinterprétée", async () => {
    const good = await ask({ op: "parseDraft", json: JSON.stringify({ title: "Chapitre 4", text: "f'(x)=2x" }) });
    expect(good.title).toBe("Chapitre 4");
    expect(good.text).toBe("f'(x)=2x");
    // Titre absent = repli, texte vide = refus (I14).
    const noTitle = await ask({ op: "parseDraft", json: JSON.stringify({ text: "cours" }) });
    expect(noTitle.title).toBe("Cours photographié");
    const empty = await ask({ op: "parseDraft", json: JSON.stringify({ title: "T", text: "   " }) }, true);
    expect(empty.error).toBe("AiError");
    const tooLong = await ask(
      { op: "parseDraft", json: JSON.stringify({ title: "T", text: "x".repeat(4001) }) },
      true,
    );
    expect(tooLong.error).toBe("OutputTooLongException");
  });

  test.skipIf(skip)("le prompt vision porte le marqueur Untrusted et l'image", async () => {
    const res = await ask({
      op: "transcribe",
      mime: "image/jpeg",
      base64: IMAGE,
      response: JSON.stringify({ title: "Chapitre 4", text: "f'(x)=2x" }),
    });
    expect(res.sawImage).toBe(true);
    expect(res.sawMarker).toBe(true);
    expect(res.title).toBe("Chapitre 4");
    expect(res.text).toBe("f'(x)=2x");
  });

  test("la préparation photo ré-encode, borne et supprime les métadonnées", () => {
    const prep = readFileSync(join(APP, "PhotoPrep.kt"), "utf8");
    expect(prep).toContain("MAX_DIMENSION = 1600");
    expect(prep).toContain("MAX_BYTES = 2_000_000");
    expect(prep).toContain("Bitmap.CompressFormat.JPEG");
    expect(prep).toContain("ExifInterface");
    // La photo n'est jamais envoyée depuis la WebView : elle est capturée,
    // préparée et supprimée côté natif.
    const capture = readFileSync(join(APP, "PhotoCapture.kt"), "utf8");
    expect(capture).toContain("cacheDir, \"photos\"");
    expect(capture).toContain("MAX_GALLERY_BYTES");
    const bridge = readFileSync(join(APP, "VsnBridge.kt"), "utf8");
    expect(bridge).toContain("PhotoPrep.prepare(shot.file)");
    expect(bridge).toContain("photos.discard(shot.file)");
    expect(bridge).toContain("Base64.encodeToString(bytes, Base64.NO_WRAP)");
    // Une capture en attente est une donnée du compte : la purge l'efface.
    const store = readFileSync(
      join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data", "LocalDataStore.kt"),
      "utf8",
    );
    expect(store).toContain('File(cacheRoot, "photos").deleteRecursively()');
  });
});
