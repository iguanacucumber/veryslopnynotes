// #412 : l'export PDF d'une fiche ne doit plus TRONQUER le corps ni perdre
// les sources.
//
// LE DÉFAUT. `revisionPdfLines` coupait le rendu à 60 lignes, alors que la
// garde I5 autorise 8 000 caractères de corps : la fin de la fiche — et son
// bloc « Sources : » — disparaissait de l'export, sans aucun avertissement.
// En prime, la liste des sources venait du CORPS (donc d'une sous-chaîne
// libre : « Sources : »), jamais de la liste canonique : une citation écrite
// par le modèle pouvait remplacer l'attribution.
//
// CE QUI EST TESTÉ ICI, sur du VRAI Kotlin exécuté : `core/RevisionSheet.kt`
// (et ses dépendances pures) est compilé par le harnais puis piloté par
// `agents/runtime/kotlin-parity/RevisionSheetMain.kt`. Aucune assertion ne
// repose sur un miroir TypeScript. `RevisionPdf.kt` (android.graphics) n'est
// PAS rejoué hors Gradle : il ne fait que dessiner les lignes produites ici.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "RevisionSheetMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask(op: unknown): Promise<string> {
  return link!.ask(op);
}

type Lines = { lines: string[] };
type Sheet = { body: string; sources: string[] };
type Sources = { sources: string[] };

/** Sources canoniques d'une fiche (le corpus fourni au modèle). */
const CANONICAL = ["Consigne", "Cours : chapitre 4"];

/** Un corps de ~6 000 caractères, dont la FIN est repérable. */
const LONG_BODY = `${"Rappel : derivee de x^2 = 2x. ".repeat(180)}\nFIN-DE-LA-FICHE`;

describe("export PDF de fiche : le corps entier et ses sources (#412)", () => {
  test.skipIf(skip)("une fiche de 6 000 caractères exportée garde la fin du corps", async () => {
    expect(LONG_BODY.length).toBeGreaterThan(5_000);
    const res = JSON.parse(
      await ask({ op: "pdfLines", body: LONG_BODY, sources: CANONICAL }),
    ) as Lines;
    const text = res.lines.join("\n");
    // LA FIN du corps : c'est elle que l'ancien plafond de 60 lignes mangeait.
    expect(text).toContain("FIN-DE-LA-FICHE");
    // Le bloc des sources, puis le pied de gabarit : plus rien ne manque.
    expect(text).toContain("Sources :");
    expect(text).toContain("- Consigne");
    expect(text).toContain("- Cours : chapitre 4");
    expect(text).toContain("Gabarit fiche-v1");
    // Pas de troncature : le corps entier tient dans la garde I5.
    expect(text).not.toContain("(suite tronquée)");
    // Le rendu dépasse l'ancien plafond : l'export n'est plus une page coupée.
    expect(res.lines.length).toBeGreaterThan(60);
  });

  test.skipIf(skip)("le corps du modèle est rendu ENTIER, pas plafonné", async () => {
    // Un corps numéroté : chaque ligne doit se retrouver dans l'export. Une
    // ligne perdue = une fiche tronquée en silence.
    const numbered = Array.from({ length: 120 }, (_, i) => `LIGNE-${String(i + 1).padStart(3, "0")}`).join("\n");
    const res = JSON.parse(
      await ask({ op: "pdfLines", body: numbered, sources: CANONICAL }),
    ) as Lines;
    const text = res.lines.join("\n");
    const missing = Array.from({ length: 120 }, (_, i) => `LIGNE-${String(i + 1).padStart(3, "0")}`).filter(
      (marker) => !text.includes(marker),
    );
    expect({ missing }).toEqual({ missing: [] });
    // 120 lignes de corps : l'ancien plafond de 60 en mangeait la moitié.
    expect(res.lines.length).toBeGreaterThan(120);
  });

  test.skipIf(skip)("un corps plus long que la garde I5 est tronqué ET signalé", async () => {
    // La garde I5 plafonne a 12 000 caracteres (#411 : le plafond de sortie
    // deduit du budget de tokens du fournisseur).
    const huge = "x".repeat(13_000);
    const res = JSON.parse(await ask({ op: "pdfLines", body: huge, sources: CANONICAL })) as Lines;
    const text = res.lines.join("\n");
    // Jamais en silence : la troncature est dite.
    expect(text).toContain("(suite tronquée)");
    // Et le corps rendu s'arrête à la borne I5 (12 000 caractères).
    expect((text.match(/x/g) ?? []).length).toBe(12_000);
    // Les sources canoniques restent là : la troncature ne mange pas la liste.
    expect(text).toContain("- Consigne");
    expect(text).toContain("- Cours : chapitre 4");
  });
});

// #630 : le corps peut être du markdown (le prompt le demande). Le PDF ne doit
// pas dessiner les marqueurs : il garde le contenu, les titres et les puces.
describe("export PDF de fiche : le markdown ne dessine pas ses marqueurs (#630)", () => {
  test.skipIf(skip)("titres, gras, listes, citation et tableau sortent en texte lisible", async () => {
    const body = [
      "## Titre de section",
      "",
      "Un **gras**, une *italique* et du `code`.",
      "",
      "- puce un",
      "- puce deux",
      "",
      "1. etape un",
      "2. etape deux",
      "",
      "> citation",
      "",
      "| Colonne A | Colonne B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const res = JSON.parse(await ask({ op: "pdfLines", body, sources: CANONICAL })) as Lines;
    const text = res.lines.join("\n");

    // Le contenu survit, les marqueurs non.
    expect(text).toContain("Titre de section");
    expect(text).toContain("Un gras, une italique et du code.");
    expect(text).toContain("- puce un");
    expect(text).toContain("1. etape un");
    expect(text).toContain("citation");
    expect(text).toContain("Colonne A — Colonne B");
    for (const marker of ["#", "**", "|", "`", "> "]) {
      expect({ marker, present: text.includes(marker) }).toEqual({ marker, present: false });
    }
  });
});

describe("export PDF de fiche : la liste CANONIQUE des sources fait foi (#412)", () => {
  test.skipIf(skip)("un corps qui contient « Sources : » ne remplace pas la liste canonique", async () => {
    // Le corps porte un bloc « Sources : » libre (le modèle l'écrit) : la
    // source qu'il cite n'est PAS dans le corpus, elle ne doit pas
    // remplacer l'attribution canonique.
    const body = "Rappel du cours.\n\nSources :\n- Source inventee\n\nSuite du corps.";
    const res = JSON.parse(await ask({ op: "pdfLines", body, sources: CANONICAL })) as Lines;
    const text = res.lines.join("\n");
    // La liste canonique est présente, en entier.
    expect(text).toContain("Sources :");
    expect(text).toContain("- Consigne");
    expect(text).toContain("- Cours : chapitre 4");
    // Et le reste du corps n'est pas perdu pour autant.
    expect(text).toContain("Rappel du cours.");
    expect(text).toContain("Suite du corps.");
  });

  // #499 : un « Sources : » AU MILIEU du corps (le cours le contient, ou le
  // modèle en cite un) ne doit pas MANGER le contenu qui suit : avant, le
  // bloc était retiré en bloc, jusqu'à la fin du corps — les puces de contenu
  // disparaissaient du corps ET de l'export, silencieusement.
  test.skipIf(skip)("un « Sources : » au milieu du corps ne mange pas le contenu qui suit", async () => {
    const body = [
      "Rappel : derivee de x^2 = 2x.",
      "",
      "Sources :",
      "- Consigne",
      "- Methode : poser f(3) = 9 et verifier",
      "",
      "Suite du corps.",
    ].join("\n");
    const res = JSON.parse(await ask({ op: "pdfLines", body, sources: CANONICAL })) as Lines;
    const text = res.lines.join("\n");
    // Le CONTENU est entier : la puce qui n'est pas une source canonique
    // reste (c'est du cours, pas une attribution).
    expect(text).toContain("- Methode : poser f(3) = 9 et verifier");
    expect(text).toContain("Rappel : derivee de x^2 = 2x.");
    expect(text).toContain("Suite du corps.");
    // La CITATION canonique du modèle, elle, est remplacée par la liste
    // canonique (une seule fois).
    expect(text).toContain("- Consigne");
    expect(text).toContain("- Cours : chapitre 4");
  });

  test.skipIf(skip)("une citation libre n'entre JAMAIS dans la liste des sources", async () => {
    // Même au milieu du corps, une citation qui n'est pas dans le corpus
    // n'entre pas dans l'ATTRIBUTION : la liste reste canonique.
    const res = JSON.parse(
      await ask({
        op: "assemble",
        fiche: "Rappel du cours.\n\nSources :\n- Source inventee\n\nSuite du corps.",
        sources: CANONICAL,
      }),
    ) as Sheet;
    expect(res.sources).toEqual(expect.arrayContaining(CANONICAL));
    expect(res.sources).not.toContain("Source inventee");
  });

  test.skipIf(skip)("les citations du modèle sont validées contre les sources canoniques", async () => {
    // Une citation valide est retenue ; une citation inconnue est REJETÉE
    // (pas ajoutée) — même règle que le chemin devoirs
    // (`HomeworkAi.parseHomeworkResponse`).
    const res = JSON.parse(
      await ask({
        op: "sources",
        fiche: "Rappel.\n\nSources :\n- Consigne\n- Source inventee",
        canonical: CANONICAL,
      }),
    ) as Sources;
    expect(res.sources).toContain("Consigne");
    expect(res.sources).not.toContain("Source inventee");
    // La liste reste complète : les sources canoniques non citées y sont.
    expect(res.sources).toContain("Cours : chapitre 4");
  });

  test.skipIf(skip)("le corps assemblé porte la liste canonique, jamais celle du modèle", async () => {
    const res = JSON.parse(
      await ask({
        op: "assemble",
        fiche: "Rappel du cours.\n\nSources :\n- Source inventee",
        sources: CANONICAL,
      }),
    ) as Sheet;
    expect(res.body).toContain("Rappel du cours.");
    expect(res.body).toContain("Sources :");
    expect(res.body).toContain("- Consigne");
    expect(res.body).toContain("- Cours : chapitre 4");
    expect(res.body).not.toContain("Source inventee");
    // La fiche porte la MÊME liste que son corps : l'écran et l'export
    // racontent la même chose.
    expect(res.sources).toEqual(expect.arrayContaining(CANONICAL));
  });

  test.skipIf(skip)("un libellé de source sur plusieurs lignes ne déferait pas le corps", async () => {
    // Un libellé de source est un LIBELLÉ : il tient sur une ligne. Sinon le
    // bloc « Sources : » déferait et laissait un bout de texte dans le corps.
    const res = JSON.parse(
      await ask({
        op: "assemble",
        fiche: "Rappel du cours.",
        sources: ["Consigne\net sa suite"],
      }),
    ) as Sheet;
    expect(res.body).toContain("Rappel du cours.");
    expect(res.body).toContain("- Consigne et sa suite");
    expect(res.sources).toEqual(["Consigne et sa suite"]);
  });

  test.skipIf(skip)("l'en-tête « sources: » du modèle est reconnu (casse, espace)", async () => {
    // Le modèle écrit librement : son en-tête peut varier. La liste
    // canonique reste la seule rendue.
    const body = "Rappel du cours.\n\nsources:\n- Source inventee";
    const res = JSON.parse(await ask({ op: "pdfLines", body, sources: CANONICAL })) as Lines;
    const text = res.lines.join("\n");
    expect(text).toContain("- Consigne");
    expect(text).toContain("- Cours : chapitre 4");
    expect(text).not.toContain("Source inventee");
  });
});

describe("export PDF de fiche : le dessin tient dans la page (#598)", () => {
  // `RevisionPdf.kt` (android.graphics) n'est PAS rejoué hors Gradle : le
  // filet est la lecture de source, comme le câblage du pont.
  const pdf = readFileSync(
    join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core", "RevisionPdf.kt"),
    "utf8",
  );

  test("chaque ligne est remballée par métrique réelle, pas par compte de caractères", () => {
    // La borne logique (90 car.) ≈ 570 pt à 12 pt Roboto pour 495 pt utiles :
    // le titre 16 pt gras débordait encore plus. Le dessin coupe par mesure.
    expect(pdf).toContain("paint.measureText(text) <= maxWidth");
    expect(pdf).toContain("fitLine(line, paint, maxWidth)");
    expect(pdf).toContain("hardPieces(word, paint, maxWidth)");
  });

  test("aucun drawText n'échappe à l'emballage mesuré", () => {
    // Toute sous-ligne dessinée vient de `fitLine` (peinture héritée) —
    // plus de ligne logique dessinée brute.
    expect(pdf).toContain("page.canvas.drawText(text, MARGIN.toFloat(), y, paint)");
    expect(pdf).not.toContain("drawText(line,");
  });
});
