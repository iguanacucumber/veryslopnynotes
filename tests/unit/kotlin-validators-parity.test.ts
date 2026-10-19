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
//    frère (`NotifyFormat.isIsoDateLike`) l'acceptaient : absence exclue du
//    calcul (aucune notification) et note triée en dernier (courbe décalée) ;
// 2. `AssignmentAttachment.isValid` acceptait n'importe quelle `ref` relative
//    alors que le web exige `^homework:[A-Za-z0-9._:-]+$` : un identifiant de
//    fichier Pronote avec un espace faisait DISPARAÎTRE le devoir entier.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
    // Les deux parseurs d'avant (Averages.kt, NotifyFormat.kt) ont disparu.
    for (const file of ["Averages.kt", "NotifyFormat.kt"]) {
      const src = readFileSync(join(CORE, file), "utf8");
      expect(src).not.toContain("fun isoMillis(");
      expect(src).not.toContain("fun isIsoDateLike(");
    }
  });
});
