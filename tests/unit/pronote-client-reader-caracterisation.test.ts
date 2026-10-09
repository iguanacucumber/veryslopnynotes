// Caractérisation de PronoteClientReader (#197).
//
// Écrite AVANT la découpe du fichier en modules par domaine, pour prouver que
// le refactor déplace la FORME et rien d'autre. Elle épingle ce qu'aucun autre
// test ne couvre : la surface exportée, le transcript EXACT des logs et les
// messages d'erreur. Les comportements (contrats, bornes, pagination) sont
// déjà couverts par assignments/timetable/attendance/canteen/discussions/…
//
// Règle : ce test doit rester VERTE À L'IDENTIQUE après la découpe. Un log
// réécrit, une méthode disparue du prototype, un message reformulé = le
// refactor a changé le comportement : le dire, plutôt que d'adapter le test.
//
// Fixtures 100 % synthétiques, session injectée : aucun réseau, aucun secret,
// aucune URL Pronote.
import { describe, expect, test } from "bun:test";
import * as readerModule from "../../server/integrations/pronote-client-reader";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";

const ACCOUNT = "acc-fake-1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fake = any;

/** Dates relatives à maintenant : les fenêtres du lecteur sont calées sur now. */
function days(n: number): Date {
  return new Date(Date.now() + n * 86400000);
}

function fakeStore(client: unknown) {
  return { requireClient: () => client, currentAccountId: () => ACCOUNT };
}

function readerFor(client: unknown, logs: string[] = []) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PronoteClientReader({ sessions: fakeStore(client) as any, logger: (m) => logs.push(m) });
}

/**
 * Lecture : `accountId` vide = refus net. Écriture : `resolveAccount` retombe sur
 * l'unique session appairée, donc il faut un store SANS compte courant pour
 * atteindre le refus d'écriture.
 */
function readerWithoutAccount(client: unknown = fullClient(), logs: string[] = []) {
  return new PronoteClientReader({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessions: { requireClient: () => client, currentAccountId: () => null } as any,
    logger: (m) => logs.push(m),
  });
}

/** Client pronotets couvrant les neuf onglets observés par getCapabilities. */
function fullClient(overrides: Fake = {}): Fake {
  return {
    periods: [
      {
        id: "p-1",
        name: "Trimestre 1",
        start: days(-60),
        end: days(60),
        grades: async () => [
          { id: "g-1", grade: "15", outOf: "20", date: days(-2), subject: { name: "Maths" }, coefficient: "2" },
          { id: "g-2", grade: "absent", outOf: "20", date: days(-1), subject: { name: "Maths" } },
        ],
        averages: async () => [{ subject: { name: "Maths" }, student: "12.5", outOf: "20" }],
        overallAverage: async () => "13",
        absences: async () => [
          { id: "a-1", fromDate: days(-1), toDate: days(-1), justified: false, subject: { name: "Histoire" }, reasons: ["Non renseigné"], hours: "2h" },
        ],
        delays: async () => [],
        punishments: async () => [{ id: "s-1", given: days(-3), nature: "avertissement", duration: 2, reasons: ["Travail non fait"] }],
      },
    ],
    homework: async () => [
      { id: "h-1", description: "Exos p.12", done: false, date: days(1), subject: { name: "Maths" } },
    ],
    lessons: async () => [
      {
        id: "l-1",
        start: days(1),
        end: new Date(days(1).getTime() + 3600000),
        subject: { name: "Maths" },
        classroom: "Salle-1",
        content: async () => ({ title: "Séance 1", description: "Cours intro.", files: () => [] }),
      },
    ],
    informationAndSurveys: async () => [
      { id: "n-1", title: "Conseil de classe", creationDate: days(-2), content: async () => "Ordre du jour." },
    ],
    menus: async () => [
      { id: "m-1", name: "Déjeuner", date: days(1), isLunch: true, mainMeal: [{ name: "Poulet" }] },
    ],
    discussions: async () => [
      {
        id: "d-1",
        subject: "Absence",
        unread: 2,
        reply: async () => {},
        markAs: async () => {},
        delete: async () => {},
      },
    ],
    getRecipients: async () => [{ id: "r-1", name: "A. Parent", type: "parent" }],
    newDiscussion: async () => {},
    info: { id: ACCOUNT, name: "Camille Exemple", className: "3E", profilePicture: null },
    children: [],
    ...overrides,
  };
}

describe("surface publique (#197)", () => {
  test("le module n'exporte que la classe", () => {
    // `PronoteClientReaderOptions` est un type : invisible à l'exécution.
    expect(Object.keys(readerModule).sort()).toEqual(["PronoteClientReader"]);
  });

  test("les vingt méthodes de lecture et d'écriture restent sur le prototype", () => {
    const methods = new Set(
      Object.getOwnPropertyNames(PronoteClientReader.prototype).filter((n) => n !== "constructor"),
    );
    // `private` n'existe qu'à la compilation : les 5 aides internes
    // (refreshSession, resolveAccount, lessonContents, discussionList,
    // requireDiscussion) vivent sur le prototype AUJOURD'HUI et deviendront des
    // fonctions de module après la découpe. Aucun appelant ne les atteint
    // (aucun n'est exporté), donc le contrat public, lui, ne bouge pas.
    for (const name of [
      "createDiscussion",
      "deleteDiscussion",
      "getAssignments",
      "getAttendance",
      "getCapabilities",
      "getDiscussionMessages",
      "getDiscussionRecipients",
      "getDiscussions",
      "getGrades",
      "getMenus",
      "getNews",
      "getPeriods",
      "getProvidedAverages",
      "getPunishments",
      "getResources",
      "getTimetable",
      "getUserInfo",
      "replyToDiscussion",
      "setAssignmentDone",
      "setDiscussionRead",
    ]) {
      expect(methods.has(name)).toBe(true);
    }
  });
});

describe("transcript des logs, domaine par domaine (#197)", () => {
  test("notes : notes, périodes, moyennes fournies", async () => {
    const logs: string[] = [];
    const reader = readerFor(fullClient(), logs);
    await reader.getGrades(ACCOUNT);
    await reader.getPeriods(ACCOUNT);
    await reader.getProvidedAverages(ACCOUNT);
    // `muettes` compte les périodes sans rien de publié, pas les matières lues.
    expect(logs).toEqual(["grades -> ok 1", "periods -> ok 1", "providedAverages -> ok 1 (muettes 0)"]);
  });

  test("cours : EDT, travaux, contenus de cours rattachés, ressources", async () => {
    const logs: string[] = [];
    const reader = readerFor(fullClient(), logs);
    await reader.getTimetable(ACCOUNT);
    await reader.getAssignments(ACCOUNT);
    await reader.getResources(ACCOUNT);
    expect(logs).toEqual([
      "timetable -> ok 1",
      "assignments -> contenus 1",
      "assignments -> ok 1",
      "resources -> ok 1",
    ]);
  });

  test("vie scolaire : absences, sanctions, cantine, capacités", async () => {
    const logs: string[] = [];
    const reader = readerFor(fullClient(), logs);
    await reader.getAttendance(ACCOUNT);
    await reader.getPunishments(ACCOUNT);
    await reader.getMenus(ACCOUNT);
    await reader.getCapabilities(ACCOUNT);
    expect(logs).toEqual([
      "attendance -> ok 1",
      "punishments -> ok 1",
      "menus -> ok 1",
      // 8, pas 9 : `getCapabilities` ne sonde PAS l'onglet Discussions (aucune
      // sonde dans capabilitiesFromProbe). Épinglé tel quel — le corriger serait
      // un changement de comportement, hors périmètre d'un déplacement.
      "capabilities -> ok 8 onglet(s) actif(s)",
    ]);
  });

  test("messagerie : liste, messages, destinataires, écritures", async () => {
    const logs: string[] = [];
    const written: Fake[] = [];
    const reader = readerFor(
      fullClient({
        newDiscussion: async (...args: Fake[]) => { written.push(args); },
      }),
      logs,
    );
    await reader.getDiscussions(ACCOUNT);
    await reader.getDiscussionMessages(ACCOUNT, "d-1");
    await reader.getDiscussionRecipients(ACCOUNT);
    await reader.createDiscussion(ACCOUNT, "Sujet", "Corps", ["r-1"]);
    await reader.replyToDiscussion(ACCOUNT, "d-1", "Réponse");
    await reader.setDiscussionRead(ACCOUNT, "d-1", true);
    await reader.deleteDiscussion(ACCOUNT, "d-1");
    expect(logs).toEqual([
      "discussions -> ok 1",
      "messages -> ok 0",
      "recipients -> ok 1",
      "discussions -> create ok 1",
      "discussions -> reply ok",
      "discussions -> read-state ok",
      "discussions -> delete ok",
    ]);
    // Jamais le corps dans les logs, mais l'écriture part bien vers Pronote.
    expect(written).toHaveLength(1);
    expect(logs.join("\n")).not.toContain("Réponse");
  });

  test("profil : userInfo et enfants", async () => {
    const logs: string[] = [];
    const reader = readerFor(fullClient(), logs);
    await reader.getUserInfo(ACCOUNT);
    expect(logs).toEqual(["me -> ok 1 profil, 0 compte(s) enfant"]);
  });

  test("onglet absent = page VIDE, jamais une erreur", async () => {
    const logs: string[] = [];
    const reader = readerFor(fullClient({ informationAndSurveys: undefined, menus: undefined }), logs);
    await reader.getNews(ACCOUNT);
    await reader.getMenus(ACCOUNT);
    // Asymétrie épinglée telle quelle : `news` teste l'existence de la fonction
    // ("onglet absent"), `menus` l'appelle et laisse remonter le TypeError
    // mappé ("indisponible"). Les deux finissent en page vide.
    expect(logs).toEqual([
      "news -> onglet absent, page vide",
      "menus -> indisponible pronote_unavailable",
    ]);
  });

  test("onglet présent mais en panne = page VIDE, sauf session morte", async () => {
    const logs: string[] = [];
    const boom = () => {
      throw new Error("network unreachable");
    };
    const reader = readerFor(fullClient({ informationAndSurveys: boom, menus: boom }), logs);
    await reader.getNews(ACCOUNT);
    await reader.getMenus(ACCOUNT);
    expect(logs).toEqual([
      "news -> indisponible (network), page vide",
      "menus -> indisponible network",
    ]);
  });
});

describe("messages d'erreur épinglés (#197)", () => {
  test("lecture sans compte : message et code par domaine", async () => {
    const reader = readerWithoutAccount();
    for (const [call, expected] of [
      [() => reader.getGrades("  "), "grades session expired"],
      [() => reader.getTimetable(""), "timetable session expired"],
      [() => reader.getNews(""), "news session expired"],
      [() => reader.getMenus(""), "menus session expired"],
      [() => reader.getDiscussions(""), "discussions session expired"],
      [() => reader.getUserInfo(""), "me session expired"],
      [() => reader.getCapabilities(""), "capabilities session expired"],
    ] as const) {
      const err = (await call().catch((e: unknown) => e)) as { message: string; code: string };
      expect(err.message).toBe(expected);
      expect(err.code).toBe("session_expired");
    }
  });

  test("écriture sans compte : le message diffère de la lecture", async () => {
    const reader = readerWithoutAccount();
    for (const [call, expected] of [
      [() => reader.setAssignmentDone("", "h-1", true), "toggle session expired"],
      [() => reader.createDiscussion("", "Sujet", "Corps", ["r-1"]), "discussion session expired"],
      [() => reader.replyToDiscussion("", "d-1", "Réponse"), "reply session expired"],
      [() => reader.setDiscussionRead("", "d-1", true), "read-state session expired"],
      [() => reader.deleteDiscussion("", "d-1"), "delete session expired"],
    ] as const) {
      const err = (await call().catch((e: unknown) => e)) as { message: string; code: string };
      expect(err.message).toBe(expected);
      expect(err.code).toBe("session_expired");
    }
  });

  test("écriture sans cible : not_found, jamais un faux succès", async () => {
    const reader = readerWithoutAccount();
    for (const [call, expected] of [
      [() => reader.setAssignmentDone(ACCOUNT, "  ", true), "toggle not found"],
      [() => reader.createDiscussion(ACCOUNT, "  ", "Corps", ["r-1"]), "discussion not found"],
      [() => reader.replyToDiscussion(ACCOUNT, "d-1", "  "), "reply not found"],
      [() => reader.setDiscussionRead(ACCOUNT, "", true), "read-state not found"],
      [() => reader.deleteDiscussion(ACCOUNT, ""), "delete not found"],
    ] as const) {
      const err = (await call().catch((e: unknown) => e)) as { message: string; code: string };
      expect(err.message).toBe(expected);
      expect(err.code).toBe("not_found");
    }
  });

  test("destinataire inconnu = 409, jamais une discussion adressée à un id inventé", async () => {
    const reader = readerFor(fullClient());
    const err = (await reader
      .createDiscussion(ACCOUNT, "Sujet", "Corps", ["r-404"])
      .catch((e: unknown) => e)) as { message: string; code: string };
    expect(err.message).toBe("discussion recipient not found");
    expect(err.code).toBe("not_found");
  });

  test("session morte : le log et le coderavel sont épinglés", async () => {
    const logs: string[] = [];
    const reader = new PronoteClientReader({
      sessions: {
        requireClient: () => { throw new Error("session expirée"); },
      } as never,
      logger: (m) => logs.push(m),
    });
    const err = (await reader.getGrades(ACCOUNT).catch((e: unknown) => e)) as { code: string };
    expect(err.code).toBe("session_expired");
    expect(logs).toEqual(["grades -> error session_expired"]);
  });
});
