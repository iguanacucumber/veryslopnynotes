// Ports du domaine. Seules interfaces ici — aucune dépendance
// vers HTTP, SQLite ou Pronote. Adapters en server/infrastructure/
// et server/integrations/.
// Voir docs/architecture/INVARIANTS.md (I2, I3, I5, I6, I7).

export type Untrusted<T = string> = { readonly __untrusted: true; readonly value: T };

export function untrusted<T>(value: T): Untrusted<T> {
  return { __untrusted: true, value };
}

export interface PronoteSession {
  readonly accountId: string;
}

export interface PronoteProvider {
  authenticate(session: PronoteSession): Promise<void>;
  // ... lectures Grades, Assignments, etc. (phase 2+)
}

export interface LLMProvider {
  /** Génère texte/JSON depuis données déjà marquées. Sans outils, sans réseau. */
  generate(prompt: { system: string; data: Untrusted<string>[] }): Promise<string>;
}

export interface ManualProvider {
  readonly platform: string;
}

export interface PushProvider {
  send(deviceTokenHash: string, payload: { title: string; body: string }): Promise<void>;
}

export interface StorageProvider {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
}
