// Chasse aux bugs réels — lectures Pronote (pronote-client-reader.ts).
// Aucun réseau, aucun secret : faux clients injectés + fixtures synthétiques
// (acc-fake-*, -Fake). Un test = un bug, nommé `BUG: <quoi> — <pourquoi>`.
import { describe, expect, test } from "bun:test";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteReadError } from "../../server/domain/ports";
import { NEWS_BODY_MAX_CHARS } from "../../shared/contracts/models";
import type { PedagogicResource } from "../../server/domain/ports";
import { syntheticAccountId } from "./fixtures/pronote";
import { syntheticInformation } from "./fixtures/news";

/** Reader sur un faux client Pronote (sessions injectées, aucun réseau). */
function readerFor(client: unknown) {
  return new PronoteClientReader({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessions: { requireClient: () => client } as any,
    logger: () => {},
  });
}

describe("bugs pronote-lectures (reader)", () => {
  test("BUG: getAttendance avale session_expired et renvoie une page VIDE — une session morte efface les absences déjà synchronisées au lieu de demander un ré-appairage", async () => {
    // Établi avec l'onglet vie scolaire : la session expire pendant la lecture.
    const client = {
      periods: [
        {
          id: "p-1",
          name: "Trimestre 1",
          absences: async () => {
            throw new Error("Session expirée");
          },
          delays: async () => [],
          punishments: async () => [],
        },
      ],
    };
    let err: unknown = null;
    let page: Awaited<ReturnType<PronoteClientReader["getAttendance"]>> | null = null;
    try {
      page = await readerFor(client).getAttendance(syntheticAccountId);
    } catch (e) {
      err = e;
    }
    // Le contrat du reader dit « Seules les erreurs de session remontent ».
    expect(err).toBeInstanceOf(PronoteReadError);
    expect((err as PronoteReadError).code).toBe("session_expired");
    // Une page vide « propre » ici est pire qu'une erreur : live-sync applique
    // `absences: []` et purge l'instantané précédent.
    expect(page).toBeNull();
  });

  test("BUG: lessonKey découpe la date en UTC — un devoir daté à minuit local (Paris) est rattaché au jour précédent et lessonContent n'est jamais rattaché", async () => {
    // Un devoir ENT est daté du JOUR local (minuit Paris) ; la séance est en
    // heure locale le même jour. 2026-10-05T00:00+02:00 == 2026-10-04T22:00Z.
    const client = {
      homework: async () => [
        {
          id: "h1",
          description: "Exos p.12",
          done: false,
          date: new Date("2026-10-05T00:00:00+02:00"),
          subject: { name: "Maths-Fake" },
        },
      ],
      lessons: async () => [
        {
          id: "l1",
          start: new Date("2026-10-05T08:00:00+02:00"),
          end: new Date("2026-10-05T09:00:00+02:00"),
          subject: { name: "Maths-Fake" },
          content: async () => ({ title: "Séance 1", description: "Cours sur les fractions." }),
        },
      ],
    };
    const a = (await readerFor(client).getAssignments(syntheticAccountId)).items.value[0];
    expect(a?.lessonContent).toEqual({ title: "Séance 1", excerpt: "Cours sur les fractions." });
  });

  test("BUG: mapResources indexe un document nul sans le filtrer — une pièce vide dans homeworkDocuments fait échouer toute la lecture des ressources", async () => {
    // Même forme "sale" que la fixture devoirs (files(): [..., null]) : le
    // mapper des PJ filtre les nuls, celui des ressources non.
    const client = {
      periods: [],
      lessons: async () => [
        {
          id: "l1",
          start: new Date("2026-10-05T08:00:00.000Z"),
          end: new Date("2026-10-05T09:00:00.000Z"),
          subject: { name: "Maths-Fake" },
          homeworkDocuments: [null, { name: "fiche.pdf", id: "f2" }],
          content: async () => ({ title: "Séance 1", description: "Cours sur les fractions.", files: () => [] }),
        },
      ],
      homework: async () => [],
    };
    const page = await readerFor(client).getResources(syntheticAccountId);
    const items: PedagogicResource[] = page.items.value;
    // Le document nul est ignoré, les deux ressources lisibles remontent.
    expect(items.filter((r) => r.origin === "homework-file").map((r) => r.title)).toEqual(["fiche.pdf"]);
    expect(items.filter((r) => r.origin === "lesson-content").map((r) => r.title)).toEqual(["Séance 1"]);
  });

  test("BUG: getGrades indexe les identifiants de repli avec all.length + i — deux notes distinctes de périodes différentes se retrouvent avec le même id", async () => {
    const date = new Date("2026-09-20T10:00:00.000Z");
    const client = {
      periods: [
        {
          id: "p-1",
          grades: async () => [
            // Note non publiée, SANS id : mappée puis écartée (index 0).
            { grade: "absent", outOf: "20", date, subject: { name: "X-Fake" } },
            { id: "g-1", grade: "15", outOf: "20", date, subject: { name: "Maths-Fake" } },
          ],
        },
        {
          id: "p-2",
          // Période suivante : all.length = 1, donc les replis repartent de 1.
          grades: async () => [
            { grade: "12", outOf: "20", date, subject: { name: "SVT-Fake" } },
            { grade: "9", outOf: "20", date, subject: { name: "SVT-Fake" } },
          ],
        },
      ],
    };
    const ids = (await readerFor(client).getGrades(syntheticAccountId)).items.value.map((g) => g.id);
    // Les id sont la clé de sync/diff serveur (jobs/grades, cache) : deux items
    // distincts ne peuvent pas partager le même id dans une page.
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("BUG: bounded() tronque en unités UTF-16 — un texte externe coupé au milieu d'un surrogate pair sort avec un demi-caractère orphelin", async () => {
    // 1999 'a' + un emoji = 2001 unités UTF-16 : le slice(0, 2000) coupe
    // l'emoji en son demi-haut surrogate isolé.
    const body = "a".repeat(NEWS_BODY_MAX_CHARS - 1) + "\u{1F600}";
    const page = await readerFor({
      periods: [],
      informationAndSurveys: async () => [syntheticInformation({ body })],
    }).getNews(syntheticAccountId);
    const points = [...(page.items.value[0]?.body ?? "")];
    // Le texte fait 2000 POINTS DE CODE : il tient dans la borne et l'emoji
    // doit survivre entier (tronqué en unités UTF-16, il devient un 0xD83D
    // isolé, que JSON.stringify encodes en \ud83d et que le client Android
    // remplace par un caractère de remplacement).
    expect(points).toHaveLength(NEWS_BODY_MAX_CHARS);
    expect(points[points.length - 1]?.codePointAt(0)).toBe(0x1f600);
  });
});