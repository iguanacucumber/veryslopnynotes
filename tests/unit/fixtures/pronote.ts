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
