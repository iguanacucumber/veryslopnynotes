// Ports du domaine. Seules interfaces ici — aucune dépendance
// vers HTTP, SQLite ou Pronote. Adapters en server/infrastructure/
// et server/integrations/.
// Voir docs/architecture/INVARIANTS.md (I2, I3, I5, I6, I7).
import type { Assignment, CanteenMenu, Grade, NewsItem, Period, TimetableEntry } from "../../shared/contracts/models";

export type Untrusted<T = string> = { readonly __untrusted: true; readonly value: T };

export function untrusted<T>(value: T): Untrusted<T> {
  return { __untrusted: true, value };
}

export interface PronoteSession {
  readonly accountId: string;
}

export interface PronoteCredentials {
  readonly accountId: string;
  readonly username: string;
  readonly password: string;
  /** Type ENT/CAS injecté (ex. valeur fournie par humain, jamais en dur). */
  readonly entKind: string;
}

export type PronoteAuthErrorCode =
  | "invalid_credentials"
  | "ent_unavailable"
  | "network"
  | "timeout"
  | "session_expired";

export class PronoteAuthError extends Error {
  readonly code: PronoteAuthErrorCode;
  constructor(message: string, code: PronoteAuthErrorCode) {
    super(message);
    this.name = "PronoteAuthError";
    this.code = code;
  }
}

export interface PronoteProvider {
  authenticate(credentials: PronoteCredentials): Promise<PronoteSession>;
  // Lectures phase 2 (issue #8) : voir PronoteReader ci-dessous.
  // Session réutilisée par accountId. Re-auth : voir
  // server/integrations/pronote-auth.ts (invalidation + nouvel
  // authenticate après changement IP).
}

export type PronoteReadErrorCode = "session_expired" | "ent_unavailable" | "network" | "timeout";

export class PronoteReadError extends Error {
  readonly code: PronoteReadErrorCode;
  constructor(message: string, code: PronoteReadErrorCode) {
    super(message);
    this.name = "PronoteReadError";
    this.code = code;
  }
}

export interface PronotePageOptions {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface PronoteTimetableOptions extends PronotePageOptions {
  readonly from?: string;
  readonly to?: string;
}

export interface PronotePage<T> {
  /** Contenu externe brut : donnée, jamais instruction (I6). Passer par server/ai/untrusted.ts avant LLM. */
  readonly items: Untrusted<T[]>;
  readonly nextCursor: string | null;
}

export interface PronoteReader {
  getGrades(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Grade>>;
  getAssignments(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Assignment>>;
  getTimetable(accountId: string, options?: PronoteTimetableOptions): Promise<PronotePage<TimetableEntry>>;
  /** Périodes scolaires (#74) : regroupement des moyennes + onglets par trimestre. */
  getPeriods?(accountId: string): Promise<PronotePage<Period>>;
  /** Ressources pédagogiques : contenus cours + PJ devoirs (proxy serveur, #84). */
  getResources?(accountId: string, page?: PronotePageOptions): Promise<PronotePage<PedagogicResource>>;
  /**
   * Actualités établissement (#79, parité Papillon) : onglet Actualités/sondages.
   * ponytail: optionnel car l'onglet peut être absent de l'installation ; une
   * page vide est un résultat valide (jamais une erreur de lecture).
   * Upgrade: détection de capacité + pièces jointes (attachments).
   */
  getNews?(accountId: string, page?: PronotePageOptions): Promise<PronotePage<NewsItem>>;

  /**
   * Menus cantine (#81) : fenêtre ISO from/to (défaut semaine courante) +
   * pagination. Optionnel = module cantine non activé côté Pronote : dans ce
   * cas l'adaptateur renvoie une page VIDE, pas une erreur (onglet masqué).
   */
  getMenus?(accountId: string, options?: PronoteTimetableOptions): Promise<PronotePage<CanteenMenu>>;
}

/** Ressource pédagogique via session Pronote (contenu cours, fichier joint, manuel lié). */
export interface PedagogicResource {
  readonly id: string;
  readonly accountId: string;
  readonly subject: string;
  readonly title: string;
  /** Texte descriptif (contenu cours) ou nom fichier. */
  readonly excerpt: string;
  readonly origin: "lesson-content" | "homework-file";
  /** Référence opaque pour téléchargement via proxy serveur, jamais URL directe. */
  readonly ref: string;
}

export function isPedagogicResource(v: unknown): v is PedagogicResource {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["id"] === "string" &&
    (r["id"] as string).trim().length > 0 &&
    typeof r["accountId"] === "string" &&
    (r["accountId"] as string).trim().length > 0 &&
    typeof r["subject"] === "string" &&
    typeof r["title"] === "string" &&
    typeof r["excerpt"] === "string" &&
    (r["origin"] === "lesson-content" || r["origin"] === "homework-file") &&
    typeof r["ref"] === "string"
  );
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
