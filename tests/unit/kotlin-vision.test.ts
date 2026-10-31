// Photo de cours -> texte : le prompt vision est une DONNÉE, l'image est
// bornée, la réponse validée par le schéma. Le vrai `Vision.kt` et `LessonAi.kt`
// sont compilés et pilotés par `VisionMain.kt` ; `PhotoPrep.kt` (Android) est
// vérifié par un test de source.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";

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

  test.skipIf(skip)("la photo seule est une source citable du corrigé", async () => {
    const res = await ask({
      op: "homeworkPhoto",
      mime: "image/jpeg",
      base64: IMAGE,
      question: "Résous l'exercice 12.",
      sources: [],
      response: JSON.stringify({
        status: "ok",
        answer: "x = 3",
        steps: ["poser l'équation", "résoudre"],
        sources: ["Photo de l'énoncé"],
      }),
    });
    expect(res.status).toBe("ok");
    expect(res.answer).toBe("x = 3");
    expect(res.sources).toEqual(["Photo de l'énoncé"]);
    expect(res.sawImage).toBe(true);
    expect(res.sawMarker).toBe(true);
  });

  test.skipIf(skip)("une citation inventée est refusée, même avec une photo", async () => {
    const res = await ask(
      {
        op: "homeworkPhoto",
        mime: "image/jpeg",
        base64: IMAGE,
        question: "Résous.",
        sources: [{ label: "Consigne", text: "exercice 12" }],
        response: JSON.stringify({
          status: "ok",
          answer: "x = 3",
          steps: [],
          sources: ["Manuel inventé"],
        }),
      },
      true,
    );
    expect(res.error).toBe("AiError");
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
    // #749 : la déconnexion supprime `cacheDir/photos` ; le `lazy` ne repasse
    // jamais, donc chaque entrée refait le dossier (sinon photo muette
    // jusqu'au redémarrage du process).
    expect(capture.match(/dir\.mkdirs\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const bridge = readBridgeSource();
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

describe("préparation photo — bornes et transparence (source épinglée)", () => {
  // `PhotoPrep`/`PhotoCapture` tirent `android.*` : ils ne compilent pas hors
  // Gradle. On épingle donc la STRUCTURE qui porte l'invariant, pas un miroir
  // du calcul.
  const prep = readFileSync(join(APP, "PhotoPrep.kt"), "utf8");
  const capture = readFileSync(join(APP, "PhotoCapture.kt"), "utf8");

  test("un budget de pixels est vérifié AVANT tout décodage", () => {
    expect(prep).toContain("MAX_PIXELS = 24_000_000");
    expect(prep).toContain("fun withinPixelBudget(width: Int, height: Int): Boolean");
    // Multiplication en Long : Int × Int déborderait sur une image déclarée énorme.
    expect(prep).toContain("width.toLong() * height.toLong() <= MAX_PIXELS");
    // Les dimensions viennent de l'en-tête seul, et le refus précède le décodage.
    expect(prep).toContain("inJustDecodeBounds = true");
    const budget = prep.indexOf("withinPixelBudget(bounds.outWidth, bounds.outHeight)");
    const decode = prep.indexOf("BitmapFactory.decodeFile(file.absolutePath, options)");
    expect(budget).toBeGreaterThan(0);
    expect(decode).toBeGreaterThan(budget);
    // Un OOM devient « photo illisible ou trop lourde », jamais un crash natif.
    expect(prep).toContain("catch (_: OutOfMemoryError)");
  });

  test("une image transparente est aplatie sur BLANC avant le JPEG", () => {
    // Sans aplatissement, les pixels transparents sortent noirs en JPEG.
    expect(prep).toContain("drawColor(Color.WHITE)");
    expect(prep).toContain("fun flatten(bitmap: Bitmap): Bitmap");
    expect(prep).toContain("if (!bitmap.hasAlpha()) return bitmap");
    // L'aplatissement est appliqué APRÈS le redimensionnement et AVANT le JPEG.
    const flat = prep.indexOf("val opaque = flatten(scaled)");
    const encode = prep.indexOf("encode(opaque, JPEG_QUALITY)");
    expect(flat).toBeGreaterThan(0);
    expect(encode).toBeGreaterThan(flat);
    // Les bornes et l'orientation ne changent pas : mêmes dimensions source.
    expect(prep).toContain("Bitmap.createBitmap(bitmap.width, bitmap.height,");
  });

  test("un échec de copie galerie ne laisse JAMAIS l'original dans le cache", () => {
    // Une seule suppression, dans le `finally` : exception, flux vide, resolver
    // nul et dépassement passent tous par là. L'original porte l'EXIF/GPS (I32).
    expect(capture).toMatch(/finally \{\s*if \(!usable\) target\.delete\(\)\s*\}/);
    expect(capture).toMatch(/usable = target\.length\(\) > 0/);
    expect(capture.match(/target\.delete\(\)/g)?.length ?? 0).toBe(1);
    expect(capture).toContain("if (total > MAX_GALLERY_BYTES) return null");
  });
});
