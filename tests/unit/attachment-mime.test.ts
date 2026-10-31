// Une pièce jointe nommée par le serveur ne sort JAMAIS en type EXÉCUTABLE :
// `consignes.html` partait comme HTML exécutable, contraire à I6.
// La VRAIE source est compilée et pilotée ; le pin statique du bas tourne
// toujours, même sans la chaîne Kotlin.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import {
  codeOnly,
  EXECUTABLE_MIME_TYPES,
  parseKotlinStringSet,
  parseMimeTable,
} from "../../agents/runtime/source-guards";

const MIME_SRC = join(
  ROOT,
  "android",
  "app",
  "src",
  "main",
  "java",
  "fr",
  "veryslopnynotes",
  "app",
  "AttachmentMime.kt",
);
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "AttachmentMimeMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface MimeResult {
  ok?: boolean;
  mime?: string;
  error?: string;
  message?: string;
}

async function mimeOf(name: string): Promise<string> {
  const r = JSON.parse(await link!.ask({ name }, { allowError: true })) as MimeResult;
  if (r.ok !== true) throw new Error(`mimeOf("${name}") a échoué : ${r.error} ${r.message ?? ""}`);
  return r.mime!;
}

describe("I6 — le type MIME d'une pièce jointe n'est jamais exécutable (#398)", () => {
  test.skipIf(skip)("un nom HTML ne sort jamais en text/html", async () => {
    // Le cas de l'issue : `consignes.html` servi à un lecteur tiers comme HTML exécutable.
    expect(await mimeOf("consignes.html")).not.toBe("text/html");
    expect(await mimeOf("consignes.html")).toBe("text/plain");
    expect(await mimeOf("consignes.htm")).not.toBe("text/html");
    expect(await mimeOf("consignes.htm")).toBe("text/plain");
    // Variantes de casse et d'espace : le nom est hostile, pas la casse.
    expect(await mimeOf("CONSIGNES.HTML")).toBe("text/plain");
    expect(await mimeOf("  consignes.HtMl  ")).toBe("text/plain");
  });

  test.skipIf(skip)("aucune extension à risque ne sort en type exécutable", async () => {
    const hostiles = [
      "page.html",
      "page.htm",
      "page.xhtml",
      "page.shtml",
      "page.mhtml",
      "graphe.svg",
      "graphe.svgz",
      "note.xml",
      "style.xsl",
      "script.js",
      "macro.vbs",
      "page.HTA",
      // Extensions sans point, chemin, double extension : le nom entier est hostile.
      "html",
      "dossier/page.html",
      "page.html.exe",
      "page.exe.html",
      "page.pdf.html",
    ];
    for (const name of hostiles) {
      const mime = await mimeOf(name);
      expect({ name, mime, executable: EXECUTABLE_MIME_TYPES.has(mime) }).toEqual({
        name,
        mime,
        executable: false,
      });
    }
  });

  test.skipIf(skip)("les formats scolaires garderont leur type réel", async () => {
    // Le correctif ne doit pas casser l'ouverture normale des PJ de l'école.
    const attendus: Array<[string, string]> = [
      ["consignes.pdf", "application/pdf"],
      ["photo.png", "image/png"],
      ["photo.jpg", "image/jpeg"],
      ["photo.jpeg", "image/jpeg"],
      ["note.txt", "text/plain"],
      ["tableau.csv", "text/csv"],
      ["devoir.odt", "application/vnd.oasis.opendocument.text"],
      ["devoir.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["video.mp4", "video/mp4"],
      ["audio.mp3", "audio/mpeg"],
    ];
    for (const [name, mime] of attendus) {
      expect({ name, mime: await mimeOf(name) }).toEqual({ name, mime });
    }
  });

  test.skipIf(skip)("une extension inconnue sort en binaire, pas en HTML", async () => {
    expect(await mimeOf("piece-jointe")).toBe("application/octet-stream");
    expect(await mimeOf("archive.qqq")).toBe("application/octet-stream");
    expect(await mimeOf("")).toBe("application/octet-stream");
  });

  // Pin statique : protège même sans la chaîne Kotlin (SKIP bruyant).
  test("la table MIME ne mappe aucun type exécutable (pin statique)", () => {
    const src = codeOnly(readFileSync(MIME_SRC, "utf8"));
    const table = parseMimeTable(src);
    expect(table.size).toBeGreaterThan(0);
    const executable = [...table]
      .filter(([, type]) => EXECUTABLE_MIME_TYPES.has(type))
      .map(([ext]) => ext);
    expect({ executable }).toEqual({ executable: [] });
    // La liste de refus existe bien et couvre les exécutables attendus.
    const refus = parseKotlinStringSet(src, "EXECUTABLE_MIME_TYPES");
    for (const attendu of [
      "text/html",
      "application/xhtml+xml",
      "image/svg+xml",
      "text/xml",
      "application/xml",
      "application/javascript",
    ]) {
      expect([...refus]).toContain(attendu);
    }
    // Les extensions à risque sont neutralisées en texte, jamais servies comme connues.
    const texteSeul = parseKotlinStringSet(src, "TEXT_ONLY_EXTENSIONS");
    for (const ext of ["html", "htm", "svg", "xml"]) {
      expect([...texteSeul]).toContain(ext);
      expect(table.has(ext)).toBe(false);
    }
  });
});
