// Unique point de sortie réseau vers Pronote.
// Hiérarchie obligatoire : Domain → PronoteProvider → adapter → PronoteHttpClient → HTTP.
// UUID appareil persisté, UA constant, requêtes sérialisées (phase 2+).
export class PronoteHttpClient {
  // ponytail: squelette bootstrap. Upgrade phase 2 : queue, rate-limit, backoff, persistance UUID.
  async request(_path: string, _init?: { method?: string; body?: unknown }): Promise<unknown> {
    throw new Error("not implemented (phase 2)");
  }
}
