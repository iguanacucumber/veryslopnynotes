// #631 — le cours complet et les pièces jointes d'un devoir arrivent à l'IA.
//
// VRAI Kotlin exécuté : `android/data/AttachmentText.kt` (extraction LOCALE) et
// `android/core/AssignmentContext.kt` (ordre des sources) sont compilés par le
// harnais de parité et pilotés par
// `agents/runtime/kotlin-parity/AttachmentTextMain.kt`. Les assertions portent
// donc sur le code de production, sur des fixtures SYNTHÉTIQUES : aucune
// requête réseau, aucun fichier réel.
//
// Ce qui est prouvé ici :
//   - texte/markdown/HTML (désinfecté) et PDF texte sont LUS ;
//   - un format non lisible (ou un MIME exécutable) devient une source NOMMÉE
//     « illisible », jamais une exception ;
//   - toutes les bornes (octets, pages, caractères) sont SIGNALÉES ;
//   - un devoir avec un cours long et une PJ texte produit des sources non
//     tronquées à 500 caractères, et la PJ y figure (elle part dans
//     « Ce qui est envoyé »).
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";
import { payloadsSource } from "./fixtures/payload-sources";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "AttachmentTextMain.kt");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

afterAll(async () => {
  if (!link) return;
  try {
    await link.ask({ op: "cleanup" });
  } catch {
    // le pilote est déjà mort : rien à nettoyer.
  }
});

async function ask<T>(op: unknown): Promise<T> {
  return JSON.parse(await link!.ask(op)) as T;
}

type Readable = { kind: "readable"; text: string; truncated: boolean; originalChars: number };
type Unreadable = { kind: "unreadable"; reason: string; message: string };
type Extracted = Readable | Unreadable;

type Source = { type: string; label: string; chars: number; originalChars: number; truncated: boolean };
type Omitted = { type: string; label: string; reason: string };
type Context = {
  sources: Source[];
  omitted: Omitted[];
  totalChars: number;
  allLessons: number;
  allAttachments: number;
};

/** Un PDF minimal, NON compressé : seuls les flux texte sont lus. */
function pdf(body: string, pages = 1): string {
  const pageObjects = Array.from({ length: pages }, (_, i) =>
    `${4 + i} 0 obj << /Type /Page /Parent 2 0 R /Contents ${4 + pages + i} 0 R >> endobj\n`,
  ).join("");
  const streams = Array.from({ length: pages }, (_, i) =>
    `${4 + pages + i} 0 obj << /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n`,
  ).join("");
  return `%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Type /Pages /Count ${pages} >> endobj\n${pageObjects}${streams}%%EOF\n`;
}

/**
 * PDF à trois pages de texte séparées par [images] flux IMAGE : de quoi
 * atteindre `MAX_PDF_STREAMS` avant la dernière page.
 */
function pdfWithImages(first: string, images: number, last: string): string {
  const objects = [
    "1 0 obj << /Type /Catalog >> endobj",
    "2 0 obj << /Type /Pages /Count 3 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj",
    `4 0 obj << /Length ${first.length} >>\nstream\n${first}\nendstream\nendobj`,
  ];
  for (let i = 0; i < images; i += 1) {
    objects.push(
      `${5 + i} 0 obj << /Type /XObject /Subtype /Image /Width 1 /Height 1 /Length 4 >>\n` +
        "stream\nXXXX\nendstream\nendobj",
    );
  }
  objects.push(
    `${5 + images} 0 obj << /Length ${last.length} >>\nstream\n${last}\nendstream\nendobj`,
  );
  return `%PDF-1.4\n${objects.join("\n")}\n%%EOF\n`;
}

describe("extraction locale d'une pièce jointe (#631)", () => {
  test.skipIf(skip)("les bornes déclarées sont celles du cache et de l'assembleur", async () => {
    const limits = await ask<{
      maxChars: number;
      maxBytes: number;
      maxPdfPages: number;
      maxAttachments: number;
      maxVisionAttachments: number;
    }>({ op: "limits" });
    expect(limits.maxChars).toBe(8000);
    expect(limits.maxBytes).toBe(10 * 1024 * 1024);
    expect(limits.maxPdfPages).toBeGreaterThan(0);
    expect(limits.maxAttachments).toBe(6);
    expect(limits.maxVisionAttachments).toBeLessThanOrEqual(limits.maxAttachments);
  });

  test.skipIf(skip)("un fichier texte est lu tel quel (fins de ligne normalisées)", async () => {
    const out = await ask<Extracted>({
      op: "extract",
      name: "consigne.txt",
      mime: "text/plain",
      text: "Exercice 1\r\nCalcule f'(x).\r\n",
    });
    expect(out.kind).toBe("readable");
    if (out.kind !== "readable") return;
    expect(out.text).toContain("Exercice 1\nCalcule f'(x).");
    expect(out.truncated).toBe(false);
  });

  test.skipIf(skip)("un markdown est du texte (aucun rendu)", async () => {
    const out = await ask<Extracted>({
      op: "extract",
      name: "cours.md",
      mime: "text/markdown",
      text: "# Chapitre 4\n\n- dérivée\n- limite",
    });
    expect(out.kind).toBe("readable");
    if (out.kind !== "readable") return;
    expect(out.text).toContain("Chapitre 4");
    expect(out.text).toContain("dérivée");
  });

  test.skipIf(skip)("le HTML est DÉSINFECTÉ : balises et scripts ne sortent pas", async () => {
    const out = await ask<Extracted>({
      op: "extract",
      name: "consigne.html",
      // mimeOf neutralise text/html en text/plain : l'extension décide ici.
      mime: "text/plain",
      // Une balise DÉCODÉE (`&lt;script&gt;`) reste du texte, jamais relue
      // comme du balisage : voir le test des entités mathématiques.
      text:
        '<html><head><style>p{color:red}</style><script>alert("x")</script></head>' +
        "<body><h1>DM&nbsp;3</h1><p>Lire &amp; r&eacute;sumer.</p><img src=x onerror=alert(1)>" +
        "</body></html>",
    });
    expect(out.kind).toBe("readable");
    if (out.kind !== "readable") return;
    expect(out.text).toContain("DM 3");
    expect(out.text).toContain("Lire & r");
    // Aucun HTML, aucun script, aucun gestionnaire d'événement ne reste.
    expect(out.text).not.toContain("<");
    expect(out.text).not.toContain(">");
    expect(out.text).not.toContain("alert");
    expect(out.text).not.toContain("onerror");
  });

  test.skipIf(skip)("les entités mathématiques restent du TEXTE, jamais des balises", async () => {
    // Régression : décoder AVANT de retirer les balises faisait de
    // `< 3 et y >` une balise, et « Résoudre x &lt; 3 et y &gt; 2. » devenait
    // « Résoudre x   2. ».
    const out = await ask<Extracted>({
      op: "extract",
      name: "maths.html",
      mime: "text/plain",
      text: "<p>Résoudre x &lt; 3 et y &gt; 2.</p>",
    });
    expect(out.kind).toBe("readable");
    if (out.kind !== "readable") return;
    expect(out.text).toContain("x < 3 et y > 2");
    expect(out.text).toContain("Résoudre");
  });

  test.skipIf(skip)("un HTML malformé reste LINÉAIRE (pas de balayage par `<`)", async () => {
    // 56 Ko de `<script` sans `>` : une entrée pareille prenait ~16 s quand
    // chaque `<` déclenchait un balayage jusqu'à la fin.
    const started = performance.now();
    const out = await ask<Extracted>({
      op: "extract",
      name: "casse.html",
      mime: "text/plain",
      text: "<script".repeat(8000),
    });
    const elapsed = performance.now() - started;
    expect(out.kind).toBe("readable");
    if (out.kind !== "readable") return;
    // Une entrée bornée, et un délai LARGE : on prouve l'ordre de grandeur,
    // pas la milliseconde (aucun test serré sur une machine chargée).
    expect(out.truncated).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });

  test.skipIf(skip)("un .mhtml / .hta passe par la désinfection HTML", async () => {
    // `AttachmentMime` sert ces extensions en text/plain : sans cette route,
    // `<script>` arrivait brut dans l'invite (I6/I35).
    for (const name of ["page.mhtml", "page.mht", "page.hta"]) {
      const out = await ask<Extracted>({
        op: "extract",
        name,
        mime: "text/plain",
        text:
          'Content-Type: multipart/related; boundary="x"\n\n--x\nContent-Type: text/html\n\n' +
          "<html><script>alert(1)</script><p>Consigne&nbsp;: lire.</p></html>\n--x--",
      });
      expect(out.kind).toBe("readable");
      if (out.kind !== "readable") return;
      expect(out.text).toContain("Consigne");
      expect(out.text).not.toContain("<");
      expect(out.text).not.toContain("alert");
    }
  });

  test.skipIf(skip)("un texte sans extension mais lisible reste lu", async () => {
    const out = await ask<Extracted>({
      op: "extract",
      name: "piece-jointe",
      mime: "application/octet-stream",
      text: "Consigne du professeur : réviser le chapitre 4.",
    });
    expect(out.kind).toBe("readable");
    if (out.kind !== "readable") return;
    expect(out.text).toContain("chapitre 4");
  });

  test.skipIf(skip)("un format non lisible devient « illisible », jamais un crash", async () => {
    // Octets binaires (octet NUL) : ni texte, ni PDF, ni image.
    const out = await ask<Extracted>({
      op: "extract",
      name: "archive.zip",
      mime: "application/octet-stream",
      hex: "504b03040000ff00",
    });
    expect(out.kind).toBe("unreadable");
    if (out.kind !== "unreadable") return;
    expect(out.reason).toBe("format_non_lisible");
    expect(out.message).toContain("non pris en charge");
  });

  test.skipIf(skip)("un MIME EXÉCUTABLE ne devient jamais un type actif", async () => {
    // Un nom .exe : mimeOf le sert en octet-stream, l'extracteur refuse le type.
    const out = await ask<Extracted>({
      op: "extract",
      name: "programme.exe",
      mime: "application/x-msdownload",
      hex: "4d5a0000",
    });
    expect(out.kind).toBe("unreadable");
    if (out.kind !== "unreadable") return;
    expect(out.reason).toBe("format_non_lisible");
  });

  test.skipIf(skip)("un fichier vide est illisible avec sa raison", async () => {
    const out = await ask<Extracted>({ op: "extract", name: "vide.txt", mime: "text/plain", text: "" });
    expect(out.kind).toBe("unreadable");
    if (out.kind !== "unreadable") return;
    expect(out.reason).toBe("vide");
  });

  test.skipIf(skip)("un PDF texte est lu, page par page", async () => {
    const out = await ask<Extracted>({
      op: "extract",
      name: "cours.pdf",
      mime: "application/pdf",
      text: pdf("BT (Chapitre 4 : derivation) Tj ET"),
    });
    expect(out.kind).toBe("readable");
    if (out.kind !== "readable") return;
    expect(out.text).toContain("Chapitre 4");
    expect(out.text).toContain("derivation");
  });

  test.skipIf(skip)("un PDF scanné (aucun texte) dit que l'OCR n'est pas disponible", async () => {
    const out = await ask<Extracted>({
      op: "extract",
      name: "scan.pdf",
      mime: "application/pdf",
      // Aucun flux texte : que des objets image.
      text: "%PDF-1.4\n1 0 obj << /Type /XObject /Subtype /Image >>\nstream\nXXXX\nendstream\nendobj\n%%EOF",
    });
    expect(out.kind).toBe("unreadable");
    if (out.kind !== "unreadable") return;
    expect(out.reason).toBe("pdf_sans_texte");
    expect(out.message).toContain("OCR");
  });

  test.skipIf(skip)("un PDF coupé par la borne de FLUX est SIGNALÉ tronqué", async () => {
    // Page 1 lue, 200 flux image, puis page 3 : `MAX_PDF_STREAMS` est atteint
    // avant la dernière page. Sauter sans le dire ferait passer une extraction
    // partielle pour complète (I35).
    const out = await ask<Extracted>({
      op: "extract",
      name: "balaye.pdf",
      mime: "application/pdf",
      text: pdfWithImages("BT (Page un texte) Tj ET", 200, "BT (Page trois texte) Tj ET"),
    });
    expect(out.kind).toBe("readable");
    if (out.kind !== "readable") return;
    expect(out.text).toContain("Page un");
    expect(out.truncated).toBe(true);
  });

  test.skipIf(skip)("les coupes de CARACTÈRES et de PAGES sont signalées", async () => {
    const long = await ask<Extracted>({
      op: "extract",
      name: "cours.txt",
      mime: "text/plain",
      text: "a".repeat(200),
      maxChars: 50,
    });
    expect(long.kind).toBe("readable");
    if (long.kind !== "readable") return;
    expect(long.text.length).toBe(50);
    expect(long.truncated).toBe(true);
    // La taille d'origine reste publiée : « Ce qui est envoyé » dit la coupe.
    expect(long.originalChars).toBe(200);

    // Deux pages de texte, une seule autorisée : la seconde est coupée.
    const pages = await ask<Extracted>({
      op: "extract",
      name: "deux-pages.pdf",
      mime: "application/pdf",
      text: pdf("BT (Page un) Tj ET", 2),
      maxPages: 1,
    });
    expect(pages.kind).toBe("readable");
    if (pages.kind !== "readable") return;
    expect(pages.truncated).toBe(true);
  });

  test.skipIf(skip)("la source d'une pièce illisible est NOMMÉE « (illisible) »", async () => {
    const item = await ask<{ type: string; label: string; text: string }>({
      op: "unreadableItem",
      label: "scan.pdf",
      reason: "pdf_sans_texte",
    });
    expect(item.type).toBe("attachment");
    expect(item.label).toContain("scan.pdf");
    expect(item.label).toContain("illisible");
    expect(item.text).toContain("OCR");
    // Le libellé reste dans le préfixe de type : jamais une URL ni une ref.
    expect(item.label).not.toContain("://");
    expect(item.label).not.toContain("homework:");
  });
});

describe("sources d'un devoir : cours complet et pièces jointes (#631)", () => {
  const longCourse = "Le chapitre 4 traite de la dérivée. ".repeat(40); // ~1 400 caractères
  const longAttachment = "Consigne détaillée de l'exercice. ".repeat(30); // ~1 000 caractères

  test.skipIf(skip)("un cours long n'est PAS tronqué à 500 et la PJ est une source", async () => {
    const out = await ask<Context>({
      op: "context",
      assignment: {
        id: "a-1",
        subject: "Mathématiques",
        title: "DM 3",
        description: "Lire le cours puis traiter les exercices.",
        lessonContent: { title: "Chapitre 4", excerpt: longCourse },
        lessonContents: [
          { title: "Chapitre 4", excerpt: longCourse },
          { title: "Chapitre 4 — exercices", excerpt: "Exercices 1 à 5 page 42." },
        ],
      },
      attachments: [{ label: "consigne.txt", text: longAttachment }],
    });
    expect(out.allLessons).toBe(2);
    expect(out.allAttachments).toBe(0);
    const types = out.sources.map((s) => s.type);
    // Ordre de priorité stable : consigne, cours, puis pièce jointe.
    expect(types).toEqual(["assignment", "course", "course", "attachment"]);
    const long = out.sources.find((s) => s.type === "course");
    expect(long).toBeDefined();
    expect(long!.chars).toBeGreaterThan(500);
    expect(long!.truncated).toBe(false);
    const attachment = out.sources.find((s) => s.type === "attachment");
    expect(attachment).toBeDefined();
    expect(attachment!.label).toContain("consigne.txt");
    expect(attachment!.chars).toBeGreaterThan(500);
    expect(attachment!.truncated).toBe(false);
  });

  test.skipIf(skip)("un cours au-delà du budget de source est SIGNALÉ tronqué", async () => {
    const huge = "x".repeat(3000);
    const out = await ask<Context>({
      op: "context",
      assignment: {
        id: "a-2",
        subject: "Histoire",
        title: "DM 4",
        lessonContent: { title: "Chapitre très long", excerpt: huge },
      },
    });
    const course = out.sources.find((s) => s.type === "course");
    expect(course).toBeDefined();
    // Budget par source de l'assembleur : 2 000 caractères, coupe SIGNALÉE.
    expect(course!.chars).toBe(2000);
    expect(course!.truncated).toBe(true);
    expect(course!.originalChars).toBe(3000);
  });

  test.skipIf(skip)("les pièces jointes d'un cours sont rattachées au devoir", async () => {
    const ref = "homework:0:lesson:0:file:0:f1";
    const out = await ask<Context>({
      op: "context",
      assignment: {
        id: "a-3",
        subject: "Physique",
        title: "DM 5",
        lessonContent: {
          title: "Chapitre 2",
          excerpt: "Lois de Newton.",
          attachments: [{ id: "f1", label: "td.pdf", ref }],
        },
        attachments: [{ id: "f2", label: "enonce.txt", ref: "homework:0:file:0:f2" }],
      },
      attachments: [{ label: "td.pdf", text: "Énoncé du TD de physique." }],
    });
    expect(out.allAttachments).toBe(2);
    expect(out.sources.some((s) => s.type === "attachment")).toBe(true);
  });

  test.skipIf(skip)("une pièce jointe illisible est NOMMÉE dans les sources", async () => {
    const out = await ask<Context>({
      op: "context",
      assignment: { id: "a-4", subject: "SVT", title: "DM 6", description: "Lire la pièce jointe." },
      attachments: [{ label: "scan.pdf", reason: "PDF sans texte lisible : l'OCR d'un scan n'est pas disponible." }],
    });
    const attachment = out.sources.find((s) => s.type === "attachment");
    expect(attachment).toBeDefined();
    expect(attachment!.label).toContain("(illisible)");
    expect(attachment!.chars).toBeGreaterThan(0);
  });
});

describe("câblage du payload (#631)", () => {
  const payloads = codeOnly(payloadsSource());
  const repository = codeOnly(readFileSync(join(DATA, "AssignmentsRepository.kt"), "utf8"));

  test("le cours est publié en entier (pas 500) avec ses pièces jointes", () => {
    // Plusieurs cours pour la même matière + jour (liste, pas un seul slot).
    expect(payloads).toContain("Map<String, List<LessonPayload>>");
    expect(payloads).toContain("boundedCp(c.description, AssignmentLessonContent.MAX_EXCERPT)");
    expect(payloads).toContain("put(\"lessonContent\", lessonObjects.getJSONObject(0))");
    expect(payloads).toContain("put(\"lessonContents\", lessonObjects)");
    expect(payloads).toContain("AssignmentAttachment.lessonAttachmentRef(");
    // Plus aucun chemin ne coupe le cours à 500 caractères.
    expect(payloads).not.toContain("excerpt.take(500)");
    expect(payloads).not.toContain("c.description.take(500)");
  });

  test("le lecteur natif relit les cours multiples et leurs pièces jointes", () => {
    expect(repository).toContain('optJSONArray("lessonContents")');
    expect(repository).toContain("parseLesson(");
    expect(repository).toContain("attachments = atts");
    // Une pièce de cours se résout aussi par le client local (fallback).
    expect(repository).toContain("lessonFiles(");
  });
});

describe("câblage du pont (#631)", () => {
  const bridge = codeOnly(readBridgeSource());
  const text = readFileSync(join(DATA, "AttachmentText.kt"), "utf8");

  test("le contexte IA télécharge puis extrait les pièces jointes, bornées", () => {
    // Le pont passe par l'extracteur local et le cache du compte (I26).
    expect(bridge).toContain("AttachmentText.extract(");
    expect(bridge).toContain("DownloadedFiles.cachedFor(");
    expect(bridge).toContain("DownloadedFiles.write(");
    expect(bridge).toContain("AttachmentText.MAX_ATTACHMENTS");
    // Une pièce illisible devient une source NOMMÉE, jamais une exception.
    expect(bridge).toContain("AiContext.attachmentUnreadable(");
    // Aucun HTML n'est rendu : le pont ne fait que lire des octets.
    expect(bridge).not.toContain("WebView.loadData");
    // Le type MIME vient de la table blanche, jamais du serveur tel quel.
    expect(bridge).toContain("mimeOf(att.label)");
    // L'image passe par le chemin vision déjà utilisé (#587).
    expect(bridge).toContain("transcribeLesson(");
    expect(bridge).toContain("PhotoPrep.prepare(");
  });

  test("l'extracteur est PUR : aucun réseau, aucun HTML rendu", () => {
    expect(text).not.toMatch(/\bfetch\(|HttpURLConnection|OkHttp|WebView/);
    // Aucune écriture de HTML : seuls des nœuds texte sortent.
    expect(text).not.toContain("setText");
    expect(text).not.toContain("loadData");
    // Le HTML est retiré par expression régulière, pas interprété.
    expect(text).toContain("sanitizeHtml");
    expect(text).toContain("decodeEntities");
  });
});
