// Ports du domaine. Seules interfaces ici — aucune dépendance
// vers HTTP, SQLite ou Pronote. Adapters en server/infrastructure/
// et server/integrations/.
// Voir docs/architecture/INVARIANTS.md (I2, I3, I5, I6, I7).
import type { AbsenceRecord, Assignment, CanteenMenu, Capabilities, Discussion, Grade, Message, NewsItem, Period, Punishment, Recipient, TimetableEntry, UserInfo } from "../../shared/contracts/models";
import { isOpaqueMediaRef } from "../../shared/contracts/models";

export type Untrusted<T = string> = { readonly __untrusted: true; readonly value: T };

export function untrusted<T>(value: T): Untrusted<T> {
  return { __untrusted: true, value };
}

export interface PronoteSession {
  readonly accountId: string;
}

/**
 * QR Pronote de l'établissement (#118) : c'est le code affiché par l'application
 * Pronote pour autoriser un nouvel appareil. `login` + `jeton` valent
 * preuve de détention du compte SANS mot de passe : ils ne sont donc jamais
 * persistés ni journalisés, seulement transmis au client Pronote.
 */
export interface PronoteQr {
  readonly login: string;
  readonly jeton: string;
  /** URL portée par le QR lui-même ; absente = URL de la session (setup). */
  readonly url?: string;
}

/**
 * Credentials d'une session. Le serveur n'en détient AUCUN de façon permanente
 * (0.7.0) : tout vient de l'app, à chaque appel. Ces valeurs vivent le temps
 * d'une session en mémoire, jamais sur disque ni en log.
 */
export interface PronoteCredentials {
  readonly accountId: string;
  /**
   * URL Pronote de CETTE session, envoyée par l'app au setup (sur l'API le champ
   * s'appelle `schoolUrl` : le vocabulaire de l'établissement ne doit pas
   * atteindre le client, I1).
   */
  readonly pronoteUrl: string;
  /**
   * Seul moyen de preuve de détention : le QR affiché par l'app Pronote
   * (pronotets `qrcodeLogin`). `pin` = code de validation associé au QR, clé de
   * déchiffrement de `login`/`jeton`.
   */
  readonly qr: PronoteQr;
  readonly pin: string;
}

export type PronoteAuthErrorCode =
  | "invalid_credentials"
  | "pronote_unavailable"
  | "network"
  | "timeout"
  | "session_expired"
  /** #118 : QR scanné refusé (jeton expiré, mauvais compte, Pin faux). */
  | "qr_rejected";

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
  // Session réutilisée par accountId. Re-auth après changement d'IP : c'est
  // `PronoteSessionStore` (pronote-sessions.ts) qui invalide le jeton et
  // rappelle `authenticate` avec le QR mémorisé — 0.7.0 n'a plus de
  // `pronote-auth.ts` : le QR EST la preuve de détention, il n'y a plus rien
  // à renvoyer à l'utilisateur.
}

export type PronoteReadErrorCode = "session_expired" | "pronote_unavailable" | "network" | "timeout";

export class PronoteReadError extends Error {
  readonly code: PronoteReadErrorCode;
  constructor(message: string, code: PronoteReadErrorCode) {
    super(message);
    this.name = "PronoteReadError";
    this.code = code;
  }
}

/**
 * Écriture Pronote (#75) : uniquement depuis une action APP confirmée (toggle
 * "fait"), jamais depuis une sortie libre LLM (I7). `unsupported` = l'adaptateur
 * n'expose pas d'écriture (pronotets sans setDone) -> erreur franche, jamais
 * un faux succès.
 */
export type PronoteWriteErrorCode =
  | "unsupported"
  | "not_found"
  | "session_expired"
  | "pronote_unavailable"
  | "network"
  | "timeout";

export class PronoteWriteError extends Error {
  readonly code: PronoteWriteErrorCode;
  constructor(message: string, code: PronoteWriteErrorCode) {
    super(message);
    this.name = "PronoteWriteError";
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

  /**
   * Bascule "fait" sur un devoir (#75). C'est une ÉCRITURE vers Pronote : elle
   * n'est appelée que par la route POST /v1/assignments/toggle, donc par une
   * action APP confirmée — jamais depuis une sortie libre LLM (I7).
   * ponytail: optionnelle = adaptateur sans écriture supportée ; l'appelant
   * transforme l'absence en erreur typée `unsupported` (jamais un faux succès).
   */
  setAssignmentDone?(accountId: string, assignmentId: string, done: boolean): Promise<Assignment>;

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

  /**
   * Vie scolaire (#77) : absences ET retards unifiés (`kind`), avec la période
   * d'appartenance. Onglet absent de l'établissement (non configuré) = page
   * VIDE, pas une erreur (capacités dynamiques, l'app masque l'onglet).
   * ponytail: motifs = données bornées (I6), jamais réinterprétés.
   */
  getAttendance?(accountId: string, page?: PronotePageOptions): Promise<PronotePage<AbsenceRecord>>;

  /** Sanctions vie scolaire (#77) : même contrat défensif (page vide si absent). */
  getPunishments?(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Punishment>>;


  /**
   * Infos du compte appairé (#82, parité Papillon Profil) : nom, classe,
   * période courante, photo (réf opaque, résolue par le proxy média) et
   * enfants d'un compte parent. Optionnel + page VIDE quand l'établissement ne
   * publie rien : jamais de nom ni de photo inventés (voir isUserInfo).
   */
  getUserInfo?(accountId: string): Promise<PronotePage<UserInfo>>;

  /**
   * Onglets Pronote actifs de l'établissement (#87, parité Papillon). Sert à
   * masquer une entrée d'onglet quand l'onglet n'existe pas : c'est une
   * information de structure, donc listée, jamais une erreur de lecture (un
   * adaptateur qui ne sait pas détecter renvoie la liste vide = rien d'affirmé,
   * l'app garde alors son affichage par défaut).
   */
  getCapabilities?(accountId: string): Promise<Capabilities>;


  /**
   * Fils de discussion (#80, parité Papillon onglet Discussions). Onglet
   * Discussions absent de l'établissement (ou droits non accordés) = page VIDE,
   * jamais une erreur (capacités dynamiques, comme #77/#79/#81).
   * ponytail: ce port de LECTURE n'expose AUCUNE écriture. Répondre / créer /
   * lu-non-lu / supprimer passent par des ports d'action séparés côté API
   * (server/api/discussions.ts), donc uniquement par une action APP confirmée
   * (I7) — jamais depuis une sortie LLM.
   */
  getDiscussions?(accountId: string, page?: PronotePageOptions): Promise<PronotePage<Discussion>>;
  /** Messages d'UN fil ; fil illisible ou absent = page vide (pas une erreur). */
  getDiscussionMessages?(accountId: string, discussionId: string): Promise<PronotePage<Message>>;
  /** Destinataires proposables pour une nouvelle discussion (lecture). */
  getDiscussionRecipients?(accountId: string): Promise<PronotePage<Recipient>>;
}

/** Longueur max d'une `ref` de ressource pédagogique (même borne que les PJ). */
export const PEDAGOGIC_REF_MAX_CHARS = 200;

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
    // Même contrainte que les PJ de devoir : une `ref` est une référence opaque
    // résolue par le proxy serveur, jamais une URL (`://`, `//`, `data:`,
    // UNC). Sans ce contrôle, une adresse Pronote sortait du contrat.
    isOpaqueMediaRef(r["ref"], PEDAGOGIC_REF_MAX_CHARS)
  );
}

export interface LLMProvider {
  /**
   * Génère texte/JSON depuis données déjà marquées. Sans outils, sans réseau.
   * `apiKey` = credential de l'APP, fournie à chaque appel : le serveur n'en
   * détient aucune (0.7.0). Absente = l'adaptateur refuse (jamais d'appel nu).
   */
  generate(prompt: { system: string; data: Untrusted<string>[] }, apiKey?: string): Promise<string>;
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
