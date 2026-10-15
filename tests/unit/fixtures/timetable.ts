// Fixtures 100 % synthétiques #76 (EDT semaine). Aucun secret, aucun hôte réel,
// aucune donnée d'établissement : salles/profs/horaires inventés, matières
// "-Fake". Les cours annulé/déplacé servent à tester l'affichage des statuts.
import type { TimetableEntry } from "../../../shared/contracts/models";

export const syntheticTimetableAccountId = "acc-fake-1";

/**
 * Cours d'une semaine type. 2026-10-05 = lundi. Les heures locales sont
 * 08:00 Paris = 06:00Z (UTC+2 été) : les bornes de semaine et l'heure
 * d'affichage sont donc testables sans dépendre de Date.now().
 */
export const syntheticTimetableEntries: TimetableEntry[] = [
  {
    id: "t-fake-1",
    accountId: syntheticTimetableAccountId,
    subject: "Maths-Fake",
    room: "Salle A12",
    start: "2026-10-05T06:00:00.000Z", // lundi 08:00 locale
    end: "2026-10-05T07:00:00.000Z",
    teacher: "Mme Faket-UNREAL",
    status: "normal",
  },
  {
    id: "t-fake-2",
    accountId: syntheticTimetableAccountId,
    subject: "Histoire-Fake",
    room: "Salle B204",
    start: "2026-10-05T12:00:00.000Z", // lundi 14:00 locale
    end: "2026-10-05T13:00:00.000Z",
    teacher: "M. Faket-UNREAL",
    status: "cancelled",
  },
  {
    id: "t-fake-3",
    accountId: syntheticTimetableAccountId,
    subject: "SVT-Fake",
    room: "Labo 3",
    start: "2026-10-06T08:00:00.000Z", // mardi 10:00 locale (déplacé)
    end: "2026-10-06T09:00:00.000Z",
    teacher: "Mme Faket-UNREAL",
    status: "moved",
    originalStart: "2026-10-06T06:00:00.000Z", // 08:00 locale
    originalEnd: "2026-10-06T07:00:00.000Z",
  },
  {
    // Payload 0.2.0 antérieur : ni prof, ni statut, ni salle. Doit rester valide.
    id: "t-fake-4",
    accountId: syntheticTimetableAccountId,
    subject: "EPS-Fake",
    start: "2026-10-07T07:00:00.000Z", // mercredi 09:00 locale
    end: "2026-10-07T08:00:00.000Z",
  },
];

/** Payload /v1/timetable conforme au contrat (avec et sans champs #76). */
export const syntheticTimetablePayload = { entries: syntheticTimetableEntries };
