// #366 : les validateurs Kotlin doivent rendre le MÊME verdict que le contrat
// TS (et que le parseur web) — sinon l'app perd des données que le contrat
// déclare valides.
//
// Le test compile les VRAIS fichiers du noyau (`core/IsoDates.kt`,
// `core/Assignment.kt`) et les pilote via `ValidatorsParityMain` : ce ne sont
// pas des miroirs TS, ce sont les validateurs exécutés. Outillage
// `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux vert) ;
// un échec de compilation, lui, est un défaut (le test rougit).
//
// Les deux défauts couverts :
// 1. `isoMillis` refusait une date-heure locale sans décalage
//    (`2026-10-02T10:00:00`) alors que le contrat (`Date.parse`) et le parseur
//    frère l'acceptaient : absence exclue du calcul (aucune notification) et
//    note triée en dernier (courbe décalée) ;
// 2. `AssignmentAttachment.isValid` acceptait n'importe quelle `ref` relative
//    alors que le web exige `^homework:[A-Za-z0-9._:-]+$` : un identifiant de
//    fichier Pronote avec un espace faisait DISPARAÎTRE le devoir entier.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isHomeworkAttachmentRef, isIsoDate } from "../../shared/contracts/models";
import { parseAssignment } from "../../web/src/features/tasks/assignments";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "ValidatorsParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask(op: unknown): Promise<string> {
  return link!.ask(op);
}

/** Dates ISO : le contrat TS et le noyau doivent statuer IDENTIQUEMENT. */
const DATES = [
  "2026-10-02T10:00:00", // heure locale SANS décalage (le défaut #366)
  "2026-10-02T10:00",
  "2026-10-02T10:00:00.500",
  "2026-10-02T10:00:00Z",
  "2026-10-02T10:00:00+02:00",
  "2026-10-02",
  "", // vide
  "   ", // blanc
  "pas une date",
  "2026-13-02", // mois inexistant
];

/**
 * Écarts CONNUS entre `Date.parse` (contrat TS) et le parseur ISO du noyau.
 * Le contrat est PLUS LAX : il accepte des formes hors ISO-8601. Le noyau les
 * refuse — l'écart joue dans le sens prudent (une date non ISO n'est pas
 * retenue) et il est listé ici pour qu'on ne le croie pas involontaire.
 */
const DATES_TS_SEULES = [
  "2026-02-30", // jour inexistant : `Date.parse` bascule au 2 mars
  "2026-10-02 10:00:00", // séparateur espace au lieu de « T »
  "2026-10-02T10:00:00+0200", // décalage sans deux-points
  "2026-10-02T24:00:00", // heure 24
  "02/10/2026", // format historique
];

/** `ref` de pièce jointe : schéma `homework:`, ni URL, ni contrôle. */
const REFS = [
  "homework:0:file:0:att1",
  "homework:12:file:3:12-34",
  "homework:0:file:0:12 34", // espace : hors schéma
  "homework:0:file:0:a_b.c:d-e", // ponctuations autorisées
  "DATA:application/pdf;base64,AA", // casse haute : refusée
  "data:application/pdf", // refusée
  "homework:0:file:0:a\u0001b", // caractère de contrôle
  "homework:0:file:0:a\u007fb", // DEL
  "https://pronote/x", // URL
  "//pronote/x", // URL relative
  "file:///tmp/x", // URL locale
  "homework\\0", // chemin Windows
  "homework:", // schéma sans identifiant
  "homework", // pas de schéma
  "autre:1:2", // autre schéma
];

/**
 * Miroir TS de `core/ManualUrl.kt` : les messages sont ceux affichés à
 * l'utilisateur, donc la parité porte aussi sur eux.
 */
function tsManualUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const input = raw.trim();
  if (input === "") return { ok: false, message: "Adresse vide : colle l'adresse de ton manuel." };
  if (input.length > 2000) {
    return { ok: false, message: "Adresse trop longue (2000 caractères maximum)." };
  }
  if (/[\s\p{Cc}]/u.test(input)) {
    return { ok: false, message: "Espace ou caractère interdit dans l'adresse." };
  }
  const sep = input.indexOf("://");
  if (sep <= 0) return { ok: false, message: "Adresse incomplète : commence par http ou https." };
  const scheme = input.slice(0, sep).toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return { ok: false, message: "Schéma refusé : utilisez http ou https." };
  }
  const authority = input.slice(sep + 3).split(/[/?#]/, 1)[0] ?? "";
  if (authority === "") return { ok: false, message: "Domaine manquant après le schéma." };
  if (authority.includes("@")) {
    return {
      ok: false,
      message: "Identifiants dans l'adresse refusés : le scraper ne s'authentifie pas.",
    };
  }
  if (authority.includes("\\")) return { ok: false, message: "Caractère interdit dans le domaine." };
  return { ok: true, url: input };
}

const MANUAL_ACCEPTED = [
  "https://manuel.exemple.fr/chapitre/3",
  "https://manuel.exemple.fr/chapitre/3?page=12",
  "https://manuel.exemple.fr:8443/a/b#page",
  "http://manuel.exemple.fr",
  "  https://manuel.exemple.fr  ",
];

const MANUAL_REJECTED: [string, string][] = [
  ["", "Adresse vide : colle l'adresse de ton manuel."],
  ["   ", "Adresse vide : colle l'adresse de ton manuel."],
  [`https://manuel.exemple.fr/${"a".repeat(2000)}`, "Adresse trop longue (2000 caractères maximum)."],
  ["https://manuel exemple.fr", "Espace ou caractère interdit dans l'adresse."],
  ["https://manuel.exemple.fr/a\nb", "Espace ou caractère interdit dans l'adresse."],
  ["manuel.exemple.fr", "Adresse incomplète : commence par http ou https."],
  ["ftp://manuel.exemple.fr", "Schéma refusé : utilisez http ou https."],
  ["https://", "Domaine manquant après le schéma."],
  ["https://user:pass@manuel.exemple.fr", "Identifiants dans l'adresse refusés : le scraper ne s'authentifie pas."],
  ["https://manuel.exemple.fr\\a", "Caractère interdit dans le domaine."],
];

/** Verdict du LECTEUR WEB : un devoir dont la `ref` est refusée disparaît. */
function webAccepts(ref: string): boolean {
  return (
    parseAssignment({
      id: "a1",
      subject: "Maths",
      title: "TP",
      dueDate: "2026-10-23T18:00:00.000Z",
      done: false,
      attachments: [{ id: "att", label: "sujet.pdf", ref }],
    }) !== null
  );
}

describe("validateurs du noyau (#366) — parité avec le contrat TS", () => {
  test.skipIf(skip)("dates : même verdict Kotlin <-> contrat TS, mêmes millis", async () => {
    for (const text of DATES) {
      const like = JSON.parse(await ask({ op: "isoDateLike", text })) as { ok: boolean };
      const millis = JSON.parse(await ask({ op: "isoMillis", text })) as { millis: number | null };
      // Le contrat TS fait foi : `Date.parse`.
      expect({ text, kotlin: like.ok }).toEqual({ text, kotlin: isIsoDate(text) });
      // Même instant que le contrat quand la date est lisible.
      if (isIsoDate(text)) {
        expect(millis.millis).toBe(Date.parse(text));
      } else {
        expect(millis.millis).toBeNull();
      }
    }
  });

  test.skipIf(skip)("écarts connus : le contrat TS est plus lax, le noyau refuse", async () => {
    for (const text of DATES_TS_SEULES) {
      const like = JSON.parse(await ask({ op: "isoDateLike", text })) as { ok: boolean };
      const millis = JSON.parse(await ask({ op: "isoMillis", text })) as { millis: number | null };
      expect(isIsoDate(text)).toBe(true); // le contrat accepte ces formes
      expect(like.ok).toBe(false); // le noyau, lui, ne les retient pas
      expect(millis.millis).toBeNull();
    }
  });

  test.skipIf(skip)("date-heure locale sans décalage : lue, et dans le fuseau de l'appareil", async () => {
    const millis = JSON.parse(await ask({ op: "isoMillis", text: "2026-10-02T10:00:00" })) as {
      millis: number | null;
    };
    expect(millis.millis).not.toBeNull();
    // Heure locale : l'instant dépend du fuseau, mais la HEURE affichée est 10:00.
    const local = new Date(millis.millis as number);
    expect(local.getHours()).toBe(10);
    expect(local.getMinutes()).toBe(0);
  });

  test.skipIf(skip)("`ref` : même verdict Kotlin <-> contrat TS <-> web", async () => {
    for (const ref of REFS) {
      const valid = JSON.parse(await ask({ op: "refValid", ref })) as { ok: boolean };
      const ts = isHomeworkAttachmentRef({ id: "att", label: "sujet.pdf", ref });
      expect({ ref, kotlin: valid.ok }).toEqual({ ref, kotlin: ts });
      // Le lecteur web refuse exactement les mêmes `ref` (sinon le devoir
      // disparaît d'un côté et pas de l'autre).
      expect({ ref, web: webAccepts(ref) }).toEqual({ ref, web: ts });
    }
  });

  test.skipIf(skip)("`ref` exotique (`12 34`) : ASSAINIE, jamais refusée", async () => {
    const built = JSON.parse(await ask({ op: "homeworkRef", index: 0, fileIndex: 0, fileId: "12 34" })) as {
      ref: string | null;
    };
    expect(built.ref).toBe("homework:0:file:0:12_34");
    // La `ref` produite est lisible par le contrat ET par le validateur Kotlin.
    expect(isHomeworkAttachmentRef({ id: "12 34", label: "sujet.pdf", ref: built.ref })).toBe(true);
    const valid = JSON.parse(await ask({ op: "refValid", ref: built.ref })) as { ok: boolean };
    expect(valid.ok).toBe(true);
  });

  test.skipIf(skip)("`ref` longue : bornée à 200 caractères, toujours au schéma", async () => {
    const built = JSON.parse(
      await ask({ op: "homeworkRef", index: 12, fileIndex: 3, fileId: "x".repeat(500) }),
    ) as { ref: string | null };
    expect((built.ref as string).length).toBe(200);
    expect(isHomeworkAttachmentRef({ id: "x", label: "sujet.pdf", ref: built.ref })).toBe(true);
  });

  test.skipIf(skip)("absence datée en heure locale : RETENUE (donc notifiable)", async () => {
    // Avant #366, `isoMillis` refusait cette date : l'absence était exclue du
    // calcul et AUCUNE notification n'était envoyée.
    const local = JSON.parse(
      await ask({ op: "absenceValid", id: "a-1", accountId: "e-1", kind: "absence", date: "2026-10-02T10:00:00" }),
    ) as { ok: boolean };
    expect(local.ok).toBe(true);
    // Une date illisible reste refusée.
    const junk = JSON.parse(
      await ask({ op: "absenceValid", id: "a-1", accountId: "e-1", kind: "absence", date: "02/10/2026" }),
    ) as { ok: boolean };
    expect(junk.ok).toBe(false);
  });

  test("câblage : la charge utile construit la `ref` par le builder du noyau", () => {
    const payloads = readFileSync(join(DATA, "PronotePayloads.kt"), "utf8");
    // Le builder ASSAINIT l'identifiant Pronote : refuser une `ref` exotique
    // ferait perdre le devoir entier côté web.
    expect(payloads).toContain("AssignmentAttachment.homeworkRef(");
    expect(payloads).not.toContain('"homework:$index:file:$di:$fileId"');
  });

  test("câblage : UN SEUL parseur de date dans le noyau", () => {
    const core = readFileSync(join(CORE, "IsoDates.kt"), "utf8");
    expect(core).toContain("internal fun isoMillis(");
    expect(core).toContain("internal fun isIsoDateLike(");
    // L'ancien parseur de `Averages.kt` a disparu, et le fichier de
    // notifications qui en portait un second aussi (#651).
    const averages = readFileSync(join(CORE, "Averages.kt"), "utf8");
    expect(averages).not.toContain("fun isoMillis(");
    expect(averages).not.toContain("fun isIsoDateLike(");
    expect(existsSync(join(CORE, "NotifyFormat.kt"))).toBe(false);
  });
});

/** Miroir TS de `core/WebPage.kt` : mêmes règles, messages propres à la page. */
function tsWebUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const input = raw.trim();
  if (input === "") return { ok: false, message: "Adresse vide : colle l'adresse de la page web." };
  if (input.length > 2000) {
    return { ok: false, message: "Adresse trop longue (2000 caractères maximum)." };
  }
  if (/[\s\p{Cc}]/u.test(input)) {
    return { ok: false, message: "Espace ou caractère interdit dans l'adresse." };
  }
  const sep = input.indexOf("://");
  if (sep <= 0) return { ok: false, message: "Adresse incomplète : commence par http ou https." };
  const scheme = input.slice(0, sep).toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return { ok: false, message: "Schéma refusé : utilisez http ou https." };
  }
  const authority = input.slice(sep + 3).split(/[/?#]/, 1)[0] ?? "";
  if (authority === "") return { ok: false, message: "Domaine manquant après le schéma." };
  if (authority.includes("@")) {
    return {
      ok: false,
      message: "Identifiants dans l'adresse refusés : le scraper ne s'authentifie pas.",
    };
  }
  if (authority.includes("\\")) return { ok: false, message: "Caractère interdit dans le domaine." };
  return { ok: true, url: input };
}

const WEB_ACCEPTED = [
  "https://encyclopedie.example.fr/article/3",
  "https://exercices.example.fr/exo?page=12",
  "https://page.example.fr:8443/a/b#partie",
  "http://page.example.fr",
  "  https://page.example.fr  ",
];

const WEB_REJECTED: [string, string][] = [
  ["", "Adresse vide : colle l'adresse de la page web."],
  ["   ", "Adresse vide : colle l'adresse de la page web."],
  [`https://page.example.fr/${"a".repeat(2000)}`, "Adresse trop longue (2000 caractères maximum)."],
  ["https://page exemple.fr", "Espace ou caractère interdit dans l'adresse."],
  ["https://page.example.fr/a\nb", "Espace ou caractère interdit dans l'adresse."],
  ["page.example.fr", "Adresse incomplète : commence par http ou https."],
  ["ftp://page.example.fr", "Schéma refusé : utilisez http ou https."],
  ["https://", "Domaine manquant après le schéma."],
  ["https://user:pass@page.example.fr", "Identifiants dans l'adresse refusés : le scraper ne s'authentifie pas."],
  ["https://page.example.fr\\a", "Caractère interdit dans le domaine."],
];

describe("adresse de la page web — parité avec l'app (#634)", () => {
  test.skipIf(skip)("mêmes formes acceptées, mêmes refus et mêmes messages", async () => {
    for (const input of WEB_ACCEPTED) {
      const kotlin = JSON.parse(await ask({ op: "webUrl", text: input })) as {
        ok: boolean;
        url?: string;
      };
      expect({ input, kotlin }).toEqual({ input, kotlin: tsWebUrl(input) });
      expect(kotlin.url).toBe(input.trim());
    }
    for (const [input, message] of WEB_REJECTED) {
      const kotlin = JSON.parse(await ask({ op: "webUrl", text: input })) as {
        ok: boolean;
        message?: string;
      };
      expect({ input, kotlin }).toEqual({ input, kotlin: tsWebUrl(input) });
      expect(kotlin.message).toBe(message);
    }
  });

  test.skipIf(skip)("une source « Web : titre » est citable, sans URL, seulement avec texte", async () => {
    const source = JSON.parse(
      await ask({
        op: "webSource",
        title: "Théorème de Pythagore",
        excerpt: "Dans un triangle rectangle, le carré de l'hypoténuse…",
      }),
    ) as { label: string | null; text: string | null };
    expect(source.label).toBe("Web : Théorème de Pythagore");
    expect(source.text).toContain("hypoténuse");
    // Un titre-URL ne met pas l'adresse dans le libellé.
    const urlTitle = JSON.parse(
      await ask({ op: "webSource", title: "https://secret.example.fr/page", excerpt: "Texte" }),
    ) as { label: string | null };
    expect(urlTitle.label).toBe("Web : Page web");
    // Sans texte, aucune source : jamais une page inventée.
    const empty = JSON.parse(await ask({ op: "webSource", title: "Titre", excerpt: "   " })) as {
      label: string | null;
    };
    expect(empty.label).toBeNull();
  });

  test.skipIf(skip)("le prompt marque la page web Untrusted et ne porte pas l'URL", async () => {
    const r = JSON.parse(
      await ask({
        op: "webPrompt",
        question: "Explique le théorème.",
        title: "Théorème de Pythagore",
        excerpt: "Dans un triangle rectangle…",
      }),
    ) as { label: string | null; body: string };
    expect(r.label).toBe("Web : Théorème de Pythagore");
    // I6 : le contenu est encadré par les délimiteurs Untrusted, déclaré DONNÉE.
    expect(r.body).toContain("UNTRUSTED_DATA");
    expect(r.body).toContain("Libelle citable : Web : Théorème de Pythagore");
    expect(r.body).toContain("Dans un triangle rectangle");
    // L'URL demandée n'est jamais dans le prompt (le document ne la porte pas).
    expect(r.body).not.toContain("http://");
    expect(r.body).not.toContain("https://");
    expect(r.body).not.toContain("page.example");
  });

  test("câblage : la page web réutilise le contrat de source du manuel", () => {
    const web = readFileSync(join(CORE, "WebPage.kt"), "utf8");
    expect(web).toContain("HomeworkSource(");
    expect(web).toContain('"Web : $title"');
    // La source ne porte que libellé + texte : aucune URL dans le prompt.
    expect(web).not.toContain("HomeworkSource(label = label, text = excerpt, url");
    const repository = readFileSync(join(DATA, "HomeworkRepository.kt"), "utf8");
    expect(repository).toContain("WebPage.source(");
  });
});

describe("adresse du manuel — parité avec l'app", () => {
  test.skipIf(skip)("mêmes formes acceptées, mêmes refus et mêmes messages", async () => {
    for (const input of MANUAL_ACCEPTED) {
      const kotlin = JSON.parse(await ask({ op: "manualUrl", text: input })) as {
        ok: boolean;
        url?: string;
      };
      expect({ input, kotlin }).toEqual({ input, kotlin: tsManualUrl(input) });
      expect(kotlin.url).toBe(input.trim());
    }
    for (const [input, message] of MANUAL_REJECTED) {
      const kotlin = JSON.parse(await ask({ op: "manualUrl", text: input })) as {
        ok: boolean;
        message?: string;
      };
      expect({ input, kotlin }).toEqual({ input, kotlin: tsManualUrl(input) });
      expect(kotlin.message).toBe(message);
    }
  });

  test("câblage : le noyau est la SEULE validation de l'adresse du manuel", () => {
    const store = readFileSync(join(DATA, "Manuals.kt"), "utf8");
    expect(store).toContain("ManualUrl.validate(");
    // Une prefs altérée est revalidée à la lecture, comme le serveur.
    expect(store).toContain("fun url(): String?");
    // L'invitation ne revient jamais après un enregistrement ou un « plus tard ».
    expect(store).toContain("fun save(raw: String): ManualUrlResult");
    expect(store).toContain("putBoolean(KEY_PROMPT_SEEN, true)");
    expect(store).toContain("fun markPromptSeen()");
    // L'adresse n'est jamais journalisée.
    expect(store).not.toMatch(/Log\.[vdiew]\(|println\(|printStackTrace/);
    // Le client passe par la route allowlistée du scraper, sans hôte en dur.
    const client = store.slice(store.indexOf("class ManualsClient"));
    expect(client).toContain("ServerConfig.manualsScrapeUrl(baseUrl)");
    expect(client).not.toMatch(/https?:\/\//);
  });
});

describe("catalogue de manuels — classe et spécialités", () => {
  const BASE = "https://www.lelivrescolaire.fr/manuels";

  async function resolve(classLabel: string, subjects: string[], subject: string): Promise<string | null> {
    const result = JSON.parse(await ask({ op: "manualResolve", baseUrl: BASE, classLabel, subjects, subject })) as {
      url: string | null;
    };
    return result.url;
  }

  test.skipIf(skip)("une adresse de catalogue n'est pas un manuel précis", async () => {
    for (const [text, expected] of [
      [BASE, true],
      [`${BASE}/`, true],
      ["https://www.lelivrescolaire.fr/tous-les-manuels", true],
      ["https://www.lelivrescolaire.fr/manuels/mathematiques-2de-2019", false],
      ["https://www.lelivrescolaire.fr/page/123", false],
    ] as [string, boolean][]) {
      const result = JSON.parse(await ask({ op: "manualIsCatalog", text })) as { ok: boolean };
      expect({ text, catalog: result.ok }).toEqual({ text, catalog: expected });
    }
  });

  test.skipIf(skip)("la classe et la matière choisissent un ouvrage VÉRIFIÉ", async () => {
    expect(await resolve("TG2", [], "MATHEMATIQUES")).toBe(
      "https://www.lelivrescolaire.fr/manuels/mathematiques-specialite-terminale-2020",
    );
    expect(await resolve("TG2", [], "MATHEMATIQUES EXPERTES")).toBe(
      "https://www.lelivrescolaire.fr/manuels/mathematiques-experte-terminale-2020",
    );
    expect(await resolve("TG2", [], "PHYSIQUE-CHIMIE")).toBe(
      "https://www.lelivrescolaire.fr/manuels/physique-chimie-terminale-2020",
    );
    expect(await resolve("TG2", [], "HISTOIRE-GEOGRAPHIE")).toBe(
      "https://www.lelivrescolaire.fr/manuels/histoire-geographie-emc-terminale-2020",
    );
    expect(await resolve("TG2", [], "PHILOSOPHIE")).toBe(
      "https://www.lelivrescolaire.fr/manuels/philosophie-terminale-2020",
    );
    expect(await resolve("1G3", [], "MATHEMATIQUES")).toBe(
      "https://www.lelivrescolaire.fr/manuels/mathematiques-1re-2019",
    );
    expect(await resolve("1ère 2", [], "ENSEIGNEMENT SCIENTIFIQUE")).toBe(
      "https://www.lelivrescolaire.fr/manuels/enseignement-scientifique-1re-2023",
    );
    expect(await resolve("2NDE 5", [], "SNT")).toBe(
      "https://www.lelivrescolaire.fr/manuels/sciences-numeriques-et-technologie-2de-2021",
    );
    expect(await resolve("TG2", [], "DNL-ANG-LV9")).toBe(
      "https://www.lelivrescolaire.fr/manuels/anglais-terminale-2026",
    );
    expect(await resolve("2NDE 5", [], "MATHS")).toBe(
      "https://www.lelivrescolaire.fr/manuels/mathematiques-2de-2019",
    );
    expect(await resolve("3E-Fake", [], "MATHEMATIQUES")).toBe(
      "https://www.lelivrescolaire.fr/manuels/mathematiques-3eme-2021",
    );
    // Matière absente du catalogue : aucun manuel plutôt qu'un mauvais.
    expect(await resolve("TG2", [], "NSI")).toBeNull();
    expect(await resolve("TG2", [], "HGGSP")).toBeNull();
    expect(await resolve("TG2", [], "SVT")).toBeNull();
  });

  test.skipIf(skip)("classe devinée + spécialités probables, jamais inventées", async () => {
    const guessed = JSON.parse(
      await ask({
        op: "manualGuess",
        classLabel: "TG2",
        subjects: ["MATHEMATIQUES", "NSI", "HISTOIRE-GEOGRAPHIE", "ANGLAIS", "PHILOSOPHIE"],
      }),
    ) as { level: string; specialties: string[] };
    expect(guessed.level).toBe("Terminale");
    expect(guessed.specialties).toEqual(["Mathématiques", "NSI"]);

    const seconde = JSON.parse(
      await ask({
        op: "manualGuess",
        classLabel: "2NDE 5",
        subjects: ["MATHEMATIQUES", "NSI", "SNT"],
      }),
    ) as { level: string; specialties: string[] };
    expect(seconde.level).toBe("2de");
    // Pas de spécialité en 2de : le tronc commun n'en est pas une.
    expect(seconde.specialties).toEqual([]);

    const sansClasse = JSON.parse(
      await ask({ op: "manualGuess", classLabel: "", subjects: ["PHILOSOPHIE", "MATHEMATIQUES"] }),
    ) as { level: string; specialties: string[] };
    expect(sansClasse.level).toBe("Terminale");
    expect(sansClasse.specialties).toEqual(["Mathématiques"]);
  });

  test("câblage : le pont choisit par matière et garde des extraits par adresse", () => {
    const bridge = readFileSync(
      join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt"),
      "utf8",
    );
    expect(bridge).toContain("ManualCatalog.resolve(stored, classLabel, subjects, subject)");
    // #628 : un SEUL point d'entrée (aiContextFor) choisit le manuel pour
    // l'aide texte, la photo ET la fiche. Plus de collecte par chemin.
    expect(bridge).toContain("manualDocFor(assignment.subject)");
    expect(bridge).not.toContain("manualDocFor(a.subject)");
    expect(bridge).toContain("manuals.saveDoc(target, doc)");
    expect(bridge).toContain("private fun knownSubjects()");
    expect(bridge).toContain("private fun profileClassLabel()");
  });
});
