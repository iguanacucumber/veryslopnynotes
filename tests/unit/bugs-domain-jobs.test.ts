// Revue adversariale : bugs réels du domaine (moyennes/compétences/capacités/
// ports) et des jobs (PDF fiche, moteur de sync, notif, diff de notes).
// Chaque test cible UN bug et doit être ROUGE tant que le bug existe.
// Fixtures 100 % synthétiques : aucun réseau, aucun secret, aucune URL réelle,
// aucune horloge réelle (instants ISO explicites, aucun `sleep` de production).
import { describe, expect, test } from "bun:test";
import { MAX_AVERAGE_POINTS, computeAverages, medianAlgorithmAverage } from "../../server/domain/averages";
import type { Grade } from "../../shared/contracts/models";
import { isPedagogicResource } from "../../server/domain/ports";
import { disabledTabs } from "../../server/domain/capabilities";
import { diffGrades } from "../../server/jobs/grades";
import { formatAbsencePush } from "../../server/jobs/notify";
import { startSyncLoop } from "../../server/jobs/sync";
import type { SyncSink, SyncSource } from "../../server/jobs/sync";
import {
  assembleRevisionSheet,
  listRevisionSheets,
  renderRevisionPdf,
  revisionIdForExam,
  saveRevisionSheet,
} from "../../server/jobs/revision";
import type { RevisionKv } from "../../server/jobs/revision";
import type { ExamCandidate } from "../../server/jobs/exams";
import { syntheticAccountId } from "./fixtures/pronote";

// --- helpers synthétiques ---------------------------------------------------

const AT = "2026-10-02T07:00:00.000Z";

/** Note synthétique : barème /20 par défaut, coefficient absent = poids 1. */
const grade = (over: Partial<Grade> & Pick<Grade, "id" | "subject" | "value">): Grade => ({
  accountId: syntheticAccountId,
  scale: 20,
  date: "2026-09-20T10:00:00.000Z",
  ...over,
});

const exam = (over: Partial<ExamCandidate> & Pick<ExamCandidate, "id">): ExamCandidate => ({
  source: "assignment",
  subject: "Maths-Fake",
  date: "2026-10-06T08:00:00.000Z",
  confidence: "high",
  matched: "ds",
  ...over,
});

function memoryKv(): RevisionKv {
  const map = new Map<string, Uint8Array>();
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => {
      map.set(k, v);
    },
  };
}

const emptySink: SyncSink = {
  loadSnapshot: async () => null,
  saveSnapshot: async () => {},
};

describe("bugs adversoriaux — domaine + jobs", () => {
  test("BUG: renderRevisionPdf calcule les offsets xref en caractères et non en octets — 100 % des fiches révision (accents + tiret cadratin) sortent en PDF structurellement invalide", () => {
    // Le titre contient déjà « révision » et le corps du PDF un tiret cadratin :
    // chaque caractère multi-octets décale la table xref, donc `startxref`
    // ne pointe plus sur `xref` et aucun lecteur n'ouvre le fichier.
    const sheet = assembleRevisionSheet(exam({ id: "a-pdf" }), "Résumé : 1/2 + 1/4 = 3/4.", ["src-fake"], AT);
    const bytes = renderRevisionPdf(sheet);
    const raw = Buffer.from(bytes).toString("latin1");
    const declared = Number(raw.match(/startxref\s+(\d+)/)?.[1]);
    const reel = raw.indexOf("xref\n0 6");
    expect(declared).toBe(reel);
  });

  test("BUG: startSyncLoop n'a pas de verrou d'exclusion — deux ticks se chevauchent, relisent le même snapshot et émettent deux fois le même GradeCreated", async () => {
    let enCours = 0;
    let maxEnCours = 0;
    let relacher: () => void = () => {};
    const source: SyncSource = {
      grades: async () => {
        enCours += 1;
        maxEnCours = Math.max(maxEnCours, enCours);
        await new Promise<void>((r) => {
          relacher = r;
        });
        enCours -= 1;
        return [];
      },
      assignments: async () => [],
      entries: async () => [],
    };
    // Intervalle court + relecture bloquée : le 2e tick part avant la fin du 1er.
    const stop = startSyncLoop(source, emptySink, 1, () => {});
    try {
      await new Promise((r) => setTimeout(r, 25));
      // La doc du module promet « le tick ne se chevauche pas ».
      expect(maxEnCours).toBe(1);
    } finally {
      stop();
      relacher();
    }
  });

  test("BUG: le rattrapage d'erreur de startSyncLoop rappelle onResult hors du try — la rejection non gérée échappe et tue le process serveur", async () => {
    const source: SyncSource = {
      grades: async () => {
        throw new Error("pronote indisponible");
      },
      assignments: async () => [],
      entries: async () => [],
    };
    const captures: string[] = [];
    const surRejection = (e: unknown) => {
      captures.push(String(e));
    };
    process.on("unhandledRejection", surRejection);
    // maxRuns 1 = un seul tour, intervalle long : aucun tick parasite.
    const stop = startSyncLoop(
      source,
      emptySink,
      60_000,
      () => {
        throw new Error("dispatcher de push KO");
      },
      1,
    );
    try {
      await new Promise((r) => setTimeout(r, 0));
      stop();
      expect(captures).toEqual([]);
    } finally {
      stop();
      process.off("unhandledRejection", surRejection);
    }
  });

  test("BUG: l'historique de computeAverages est fenêtré sur les N dernières notes — le dernier point de la courbe contredit la moyenne générale affichée", () => {
    const notes: Grade[] = [];
    for (let i = 0; i < MAX_AVERAGE_POINTS + 40; i++) {
      notes.push(
        grade({
          id: `x${i}`,
          subject: "Maths-Fake",
          value: i < 40 ? 20 : 4,
          date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
        }),
      );
    }
    const report = computeAverages(notes, { algorithm: "subject" });
    const dernier = report.history[report.history.length - 1];
    // La courbe doit finir sur la moyenne générale : ici 6.67, pas 4.
    expect(report.general.value).toBeCloseTo(6.666666, 5);
    expect(dernier.value).toBeCloseTo(report.general.value as number, 9);
  });

  test("BUG: medianAlgorithmAverage compte les notes bonus comme des notes /20 ordinaires — une majoration gonfle la médiane de la matière", () => {
    const ordinaire = [
      grade({ id: "m1", subject: "Arts-Fake", value: 10 }),
      grade({ id: "m2", subject: "Arts-Fake", value: 12 }),
      grade({ id: "m3", subject: "Arts-Fake", value: 14 }),
    ];
    const avecBonus = [...ordinaire, grade({ id: "b1", subject: "Arts-Fake", value: 20, bonus: true })];
    expect(medianAlgorithmAverage(ordinaire)).toBeCloseTo(12, 9);
    // Le contrat du module dit « bonus ignorés » (les 2 autres algorithmes les
    // traitent à part) : la médiane ne doit pas bouger.
    expect(medianAlgorithmAverage(avecBonus)).toBeCloseTo(12, 9);
  });

  test("BUG: isUsable laisse passer un coefficient négatif — il annule le dénominateur et la moyenne de la matière disparaît (division par zéro)", () => {
    const notes = [
      grade({ id: "n1", subject: "Maths-Fake", value: 10 }),
      grade({ id: "n2", subject: "Maths-Fake", value: 18, coefficient: -1 }),
    ];
    const report = computeAverages(notes);
    // La note au coefficient négatif est inexploitable : elle est écartée, la
    // moyenne de la matière reste celle de la seule note valide (10/20).
    expect(report.subjects.map((s) => ({ subject: s.subject, value: s.value }))).toEqual([
      { subject: "Maths-Fake", value: 10 },
    ]);
  });

  test("BUG: revisionIdForExam assainit l'id sans suffixe unique — deux examens distincts partagent une fiche, l'un écrase l'autre", () => {
    // « a/b » et « a?b » sont deux devoirs Pronote distincts, même id de fiche.
    const premier = assembleRevisionSheet(exam({ id: "a/b" }), "Fiche de l'examen A.", ["src-fake"], AT);
    const second = assembleRevisionSheet(exam({ id: "a?b" }), "Fiche de l'examen B.", ["src-fake"], AT);
    expect(second.id).not.toBe(premier.id);
    expect(revisionIdForExam("a/b")).not.toBe(revisionIdForExam("a?b"));
  });

  test("BUG: saveRevisionSheet réécrit l'index à [nouvel id] quand l'index est illisible — toutes les fiches déjà enregistrées deviennent inatteignables", async () => {
    const kv = memoryKv();
    await saveRevisionSheet(kv, assembleRevisionSheet(exam({ id: "s1" }), "Fiche 1.", ["src-fake"], AT));
    await saveRevisionSheet(kv, assembleRevisionSheet(exam({ id: "s2" }), "Fiche 2.", ["src-fake"], AT));
    expect((await listRevisionSheets(kv)).length).toBe(2);
    // Index corrompu (écriture tronquée / écriture concurrente perdue).
    await kv.set("revision:index", new TextEncoder().encode("{corrompu"));
    await saveRevisionSheet(kv, assembleRevisionSheet(exam({ id: "s3" }), "Fiche 3.", ["src-fake"], AT));
    const restantes = await listRevisionSheets(kv);
    expect(restantes.map((s) => s.id).sort()).toEqual([
      revisionIdForExam("s1"),
      revisionIdForExam("s2"),
      revisionIdForExam("s3"),
    ]);
  });

  test("BUG: isPedagogicResource ne contrôle pas la ref — une URL directe Pronote passe le validateur alors que la règle d'or l'interdit", () => {
    const urlDirecte: unknown = {
      id: "r-lesson-0",
      accountId: syntheticAccountId,
      subject: "Maths-Fake",
      title: "Devoir n°1",
      excerpt: "fiche d'exercices",
      origin: "homework-file",
      // Hôte synthétique, jamais réel : c'est la FORME qui est interdite.
      ref: "https://example.test/school-api/fichier.pdf",
    };
    expect(isPedagogicResource(urlDirecte)).toBe(false);
  });

  test("BUG: formatAbsencePush annonce le jour UTC de l'instant — l'app localisant en zone système, la notification affiche la mauvaise date", () => {
    // 22:30 UTC = 00:30 le lendemain à Paris (CEST) : le jour civil français
    // est le 07, pas le 06.
    const absence = {
      id: "ab-1",
      accountId: syntheticAccountId,
      kind: "absence" as const,
      date: "2026-10-06T22:30:00.000Z",
      subject: "Maths-Fake",
      motif: "Rendez-vous medical",
    };
    const jourLocal = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(absence.date));
    expect(jourLocal).toBe("2026-10-07");
    expect(formatAbsencePush(absence).body).toContain(jourLocal);
  });

  test("BUG: fingerprint ignore le libellé enseignant — une correction de libellé de note n'est jamais notifiée, l'app garde l'ancien libellé en cache", () => {
    const avant = grade({ id: "g1", subject: "Maths-Fake", value: 14, label: "Devoir surveille n°1" });
    const apres = grade({ id: "g1", subject: "Maths-Fake", value: 14, label: "Devoir surveille n°2 (corrige)" });
    const diff = diffGrades([avant], [apres]);
    expect(diff.changed.map((g) => g.id)).toEqual(["g1"]);
  });

  test("BUG: disabledTabs(null) déclare les 10 onglets désactivés — des capacités non déterminées ne doivent jamais déduire un masquage", () => {
    expect(disabledTabs(null)).toEqual([]);
  });
});
