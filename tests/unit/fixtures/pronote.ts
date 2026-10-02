// Fixtures 100 % synthétiques pour PronoteHttpClient.
// Aucune URL réelle, aucune credential réelle : hôte example.test, UUID constant,
// notes/matières inventées. Ne jamais y mettre de secret ou d'URL d'établissement.
export const syntheticBaseUrl = "https://example.test/school-api";
export const syntheticDeviceUuid = "123e4567-e89b-42d3-a456-426614174000";
export const syntheticGradesPath = "/grades";
export const syntheticSampleGrades = {
  grades: [
    { subject: "Maths-Fake", value: 14, scale: 20 },
    { subject: "Histoire-Fake", value: 11, scale: 20 },
  ],
};
// Auth ENT/CAS synthétique (#7). Identifiants faux, jamais réels.
export const syntheticAccountId = "acc-fake-1";
export const syntheticUsername = "fake-user-UNREAL";
export const syntheticPassword = "fake-pw-9x8y7z-UNREAL";
export const syntheticEntKind = "cas-fake";
export const syntheticAuthToken = "fake-token-abc123-UNREAL";
export const syntheticAuthSuccess = { token: syntheticAuthToken };
// Lectures synthétiques (#8). Contrats Grade/Assignment/TimetableEntry, valeurs inventées.
export const syntheticGrade = {
  id: "g-fake-1",
  accountId: syntheticAccountId,
  subject: "Maths-Fake",
  value: 14,
  scale: 20,
  date: "2026-09-20T10:00:00.000Z",
};
export const syntheticAssignment = {
  id: "a-fake-1",
  accountId: syntheticAccountId,
  subject: "Francais-Fake",
  title: "Redaction-UNREAL",
  dueDate: "2026-10-05T08:00:00.000Z",
  done: false,
};
export const syntheticTimetableEntry = {
  id: "t-fake-1",
  accountId: syntheticAccountId,
  subject: "Histoire-Fake",
  room: "Salle-UNREAL-12",
  start: "2026-10-03T08:00:00.000Z",
  end: "2026-10-03T09:00:00.000Z",
};
export const syntheticGradesOk = { grades: [syntheticGrade], nextCursor: "cur-fake-2" };
export const syntheticAssignmentsOk = { assignments: [syntheticAssignment], nextCursor: null };
export const syntheticTimetableOk = { entries: [syntheticTimetableEntry], nextCursor: null };
