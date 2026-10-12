// Empreinte de compte (#210) : tout ce qui reste de `server/api/` après le
// débranchement.
//
// Le serveur applicatif est mort (routes, sessions d'appareil, Bearer : tous
// portés sur le téléphone, ADR-003) ; le seul process restant est le scraper
// manuels (`server/infrastructure/http.ts`). Cette fonction survit parce que
// l'outil de capture du corpus Pronote (#199, encore ouvert :
// `agents/runtime/capture-pronote.ts`) l'importe pour cléer ses sessions :
// `accountId = empreinte de l'identité fournie, jamais l'identité` (même règle
// que le setup applicatif supprimé). Elle meurt avec #199.
import { createHash } from "node:crypto";

/**
 * accountId = empreinte de l'identité fournie, jamais l'identité : il apparaît
 * dans les logs, les snapshots et les fixtures (règle d'or dépôt).
 */
export function accountIdFrom(identity: string): string {
  return createHash("sha256").update(`pronote:${identity.trim()}`).digest("hex").slice(0, 16);
}
