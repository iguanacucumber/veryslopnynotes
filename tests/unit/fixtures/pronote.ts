// QR et données de session 100 % synthétiques pour la capture locale.
// Ne jamais y mettre de secret ni d'URL d'établissement.
// Credentials Pronote synthétiques (#7). 0.7.0 : la preuve de détention est le
// QR de l'app + son pin — aucun identifiant saisi, aucun secret serveur.
// Blocs fictifs (forme base64), jamais un QR réel, jamais un pin réel.
export const syntheticAccountId = "acc-fake-1";
export const syntheticQr = { login: "bG9naW4tZmFrZS1VTlJFQUw=", jeton: "amV0b24tZmFrZS1VTlJFQUw=" };
export const syntheticPin = "0000-UNREAL";
/** Credentials de session complètes (QR-only), prêtes pour `authenticate`. */
export const syntheticSessionCredentials = {
  accountId: syntheticAccountId,
  pronoteUrl: "https://example.test/school-api",
  qr: syntheticQr,
  pin: syntheticPin,
};
