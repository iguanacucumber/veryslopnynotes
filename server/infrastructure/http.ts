// Point d'entrée HTTP du serveur (composition root, référencé par Dockerfile.server).
// 0.7.0 : ZÉRO credential lu dans l'environnement. Les seules variables lues
// sont `PORT`/`HOST` (écoute, pas un secret) ; tout ce qui s'authentifie vient de
// l'app — le QR au setup, la clé LLM sur chaque appel. Les credentials de session
// (QR + pin) ne vivent qu'en mémoire, le temps de la session, jamais sur disque.
// Unique endroit où les sessions Pronote, le reader, le LLM et les ports
// d'écriture/action sont branchés sur le routeur. Aucun secret n'est journalisé :
// on ne logue que des compteurs et des codes d'erreur (I6, règle d'or dépôt).
// I2 : tout le réseau Pronote passe par PronoteHttpClient (via pronotets), rien ici.
// I7 : les écritures (devoirs, messagerie) sont des ports d'action branchés sur le
// reader, atteignables uniquement via une route (= action app confirmée).
import type { ContractEvent } from "../../shared/contracts/events";
import { createHandler } from "../api/router";
import type { AssignmentActions, MediaActions } from "../api/assignments";
import type { DiscussionActions } from "../api/discussions";
import { PairingService } from "../api/pairing";
import { accountIdFrom, SetupService } from "../api/setup";
import { createSubjectPrefsMemoryStore } from "../api/subject-prefs";
import { createRevisionMemoryStore } from "../api/revision";
import type { PronoteCredentials, PronoteReader } from "../domain/ports";
import { PronoteAuthError, PronoteWriteError } from "../domain/ports";
import { PronoteClientReader } from "../integrations/pronote-client-reader";
import { PronoteSessionStore } from "../integrations/pronote-sessions";
import { createLlmProvider } from "./llm-openrouter";
import { mediaActions } from "./media-proxy";
import { createLiveSync } from "./live-sync";
import type { LiveSync } from "./live-sync";
import { SnapshotStore } from "./snapshot-store";

const DEFAULT_PORT = 3000;

export interface AppDeps {
  /**
   * Reader injecté. `null` explicite = AUCUN reader (tests : jamais de réseau) ;
   * clé absente = construit sur la session issue de l'env.
   */
  readonly reader?: PronoteReader | null;
  /** Session store injecté, même sémantique que `reader` (`null` = aucun). */
  readonly sessions?: PronoteSessionStore | null;
}

export interface App {
  readonly handler: (req: Request) => Promise<Response>;
  readonly store: SnapshotStore;
  readonly liveSync: LiveSync;
  readonly sessions: PronoteSessionStore | null;
  /** Relecture initiale best-effort (jamais bloquante) : le serveur démarre vide. */
  warmup(): Promise<void>;
}

function envValue(env: Record<string, string | undefined>, key: string): string {
  return (env[key] ?? "").trim();
}

/**
 * Composition root. 0.7.0 : plusaucun paramètre d'environnement — le serveur ne
 * lit que `PORT`/`HOST`, et uniquement dans `start()` (écoute, pas un secret).
 */
export function createApp(deps: AppDeps = {}): App {
  const log = (message: string) => console.log(`[server] ${message}`);
  const store = new SnapshotStore();
  const llm = createLlmProvider();

  /**
   * #118 : dernier QR EN MÉMOIRE, par compte. Le store de session ne conserve
   * JAMAIS le credential (cf. #87) : sans ce coffre, un setup fait depuis l'app
   * n'aurait aucun moyen de renouveler sa session 5 min plus tard. Jamais
   * persisté, jamais journalisé. Il survit volontairement à une invalidation de
   * session : c'est lui qui permet de rouvrir la session quand elle meurt, donc
   * le vider à cet instant-là la rendrait irrécupérable.
   */
  const vault = new Map<string, PronoteCredentials>();

  // `null` explicite = aucun store (tests) : ne jamais construire une session
  // réelle quand le caller a dit non. 0.7.0 : le store existe TOUJOURS, même
  // sans la moindre variable d'environnement — l'URL, le QR et le pin arrivent
  // par POST /v1/setup.
  let sessions: PronoteSessionStore | null = deps.sessions === undefined ? null : deps.sessions;
  if (deps.sessions === undefined) {
    sessions = new PronoteSessionStore({
      logger: (m) => log(`pronote ${m}`),
      // #87 : renewal de session. Le credential (QR + pin) reste dans le coffre
      // en mémoire, jamais journalisé ni persisté ; sans lui, la session meurt
      // et l'app doit refaire un setup.
      renew: async (target: string) => {
        const known = vault.get(target.trim());
        if (!known) {
          log(`renewal -> impossible (aucun QR memorise pour ce compte)`);
          throw new PronoteAuthError("renewal impossible", "pronote_unavailable");
        }
        await sessions?.authenticate(known);
      },
    });
  }

  const reader: PronoteReader | null =
    deps.reader === undefined
      ? sessions
        ? new PronoteClientReader({ sessions, logger: (m) => log(`reader ${m}`) })
        : null
      : deps.reader;
  // `sessions` n'est nul que sur injonction explicite des tests. Au boot il n'y
  // a AUCUN compte : le serveur démarre vide, le compte arrive par POST /v1/setup.
  if (!sessions) log("aucun store de session : lectures vides, ecritures indisponibles (501)");
  else log("aucun compte au boot : le compte s'ouvrira via POST /v1/setup (QR)");

  /** Mono-compte : le compte appairé par le serveur, et RIEN d'autre.
   *  L'`accountId` transporté par le client n'est qu'un indice borné : le
   *  prendre pour une identité ouvrait une session Pronote pour un compte
   *  jamais appairé, et cassait la résolution mono-compte
   *  (`currentAccountId()` = null dès qu'une 2e session existe). */
  const resolveAccountId = (_requested: string): string => sessions?.currentAccountId() ?? "";

  const liveSync = createLiveSync({
    reader: reader as never,
    store,
    resolveAccountId,
    // Un seul renewal de session par refresh, avant la passe parallèle
    // (sinon les lectures parallèles se tuent entre elles, cf. LiveSyncOptions).
    ...(typeof sessions?.refreshSession === "function"
      ? { prepare: (account: string) => sessions!.refreshSession(account) }
      : {}),
    logger: log,
  });

  /**
   * Relecture UNIQUE et sérialisée : passe par `actions.refresh`, donc le setup
   * et POST /v1/sync/refresh partagent le même garde-fou mono-relecture (appeler
   * `liveSync.run` en direct doublait la passe sur la session Pronote : rafale de
   * `session_expired` + snapshot de diff écrit deux fois).
   */
  const refreshSnapshot = (target: string): Promise<ContractEvent[]> => liveSync.actions.refresh(target);

  /**
   * Journal honnête (I6) : « rempli » seulement si la relecture a réellement
   * alimenté le snapshot. Zéro note lue = rien n'a été rempli, on le dit.
   */
  const logSnapshotFilled = (subject: string): void => {
    const grades = store.grades().length;
    if (grades === 0) log(`${subject} relecture vide (aucune note lue), l'app retry`);
    else log(`${subject} snapshot rempli (${grades} note(s))`);
  };

  // Appairage = simple émission de jeton. Le compte de l'établissement, lui, ne
  // s'ouvre que par le setup (QR) : l'appairage n'a plus de credential à jouer.
  const pairing = new PairingService();

  /**
   * #118 : setup = authentifie le compte école (QR envoyé par l'app) PUIS émet le
   * jeton. Le snapshot est warmed APRÈS la réponse : le jeton ne dépend pas
   * d'une relecture complète, et l'app tire son premier rafraîchissement.
   */
  const setup = new SetupService({
    sessions,
    issue: () => pairing.issue(),
    // Session déjà ouverte (setup rejoué) : on ne rejoue pas une connexion,
    // sinon `currentAccountId()` verrait deux sessions et tout le mono-compte
    // s'effondrerait (#75).
    existingAccountId: () => sessions?.currentAccountId() ?? null,
    onOpened: (opened, credentials) => {
      // Coffre mémoire : sans lui, la session ouverte par le setup ne pourra
      // pas être renouvelée 5 min plus tard (cf. `credentialsToRenew`).
      vault.set(opened, credentials);
      // Pas de reader = relecture impossible : ne jamais annoncer un snapshot
      // rafraîchi qui n'a pas eu lieu (I6).
      if (!reader) return log("setup -> session ouverte, relecture ignoree (aucun reader)");
      void refreshSnapshot(opened)
        .then(() => logSnapshotFilled("setup -> session ouverte,"))
        .catch(() => log("setup -> relecture echouee, l'app retry"));
    },
    logger: log,
  });

  // Ports d'écriture (I7) : le reader est l'unique source, l'app doit confirmer.
  // Mono-compte : l'app n'envoie pas d'accountId avant /v1/me, une requête à
  // accountId vide doit donc viser la session appairée unique, pas échouer.
  const target = (requested: string): string => resolveAccountId(requested);
  const assignmentActions: AssignmentActions | null = reader
    ? {
        setAssignmentDone: (a, assignmentId, done) =>
          write(reader, "setAssignmentDone", target(a), assignmentId, done),
      }
    : null;
  const discussionActions: DiscussionActions | null = reader
    ? {
        createDiscussion: (a, subject, body, recipientIds) =>
          write(reader, "createDiscussion", target(a), subject, body, recipientIds),
        replyToDiscussion: (a, discussionId, body) =>
          write(reader, "replyToDiscussion", target(a), discussionId, body),
        setDiscussionRead: (a, discussionId, read) =>
          write(reader, "setDiscussionRead", target(a), discussionId, read),
        deleteDiscussion: (a, discussionId) => write(reader, "deleteDiscussion", target(a), discussionId),
      }
    : null;
  const media: MediaActions | null = sessions ? mediaActions(sessions) : null;

  const handler = createHandler(
    store,
    pairing,
    llm,
    createRevisionMemoryStore(),
    createSubjectPrefsMemoryStore(),
    assignmentActions,
    media,
    // Relecture non branchée (aucun reader) = port absent = 501 honnête
    // « relecture non branchée », jamais un `200 {events: []}` qui mentirait sur
    // un refresh impossible (même règle que les ports d'écriture/media).
    reader ? liveSync.actions : null,
    discussionActions,
    setup,
  );

  return {
    handler,
    store,
    liveSync,
    sessions,
    warmup: async () => {
      // 0.7.0 : plus aucun credential au boot (ni env, ni disque) — donc aucune
      // session à ouvrir ici. La relecture part du setup, seul moment où un
      // compte existe. Gardé pour le contrat `App` et parce qu'un serveur peut
      // être relancé en cours de session dans les tests.
      const account = sessions?.currentAccountId();
      if (!reader || !sessions || !account) return;
      try {
        await refreshSnapshot(account);
        logSnapshotFilled("warmup ->");
      } catch {
        log("warmup -> echec, le serveur demarre vide (l'app retry)");
      }
    },
  };
}

/**
 * Écriture confirmée : le reader ne porte QUE l'écriture réellement supportée par
 * la lib. Méthode absente = `unsupported` typé -> la route répond 501 « non
 * supporté », jamais un faux succès (I7 + honnêteté du refus).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function write<T = unknown>(reader: PronoteReader, method: string, ...args: unknown[]): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (reader as any)[method];
  if (typeof fn !== "function") throw new PronoteWriteError("write unsupported", "unsupported");
  return (await fn.apply(reader, args)) as T;
}

/** `PORT` : absent -> défaut ; `0` conservé (port éphémère) ; hors plage -> refus explicite. */
function parsePort(raw: string | null): number {
  if (raw === null) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT invalide: ${JSON.stringify(raw)} (entier attendu dans 0..65535)`);
  }
  return port;
}

/** Corps HTTP maximal : toutes les routes JSON sont bornées à quelques ko. */
const MAX_REQUEST_BODY_BYTES = 1_048_576;

/**
 * Démarre le serveur (CLI). `HOST` explicite requis pour exposer hors loopback.
 * Type de retour : `ReturnType<typeof Bun.serve>` (le type Bun global n'expose pas `serve`).
 */
export function start(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): ReturnType<typeof Bun.serve> {
  const app = createApp();
  const port = parsePort(envValue(env, "PORT"));
  const hostname = envValue(env, "HOST") || "127.0.0.1";
  const server = Bun.serve({
    port,
    hostname,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    fetch: app.handler,
    // Une exception échappée au handler ne doit JAMAIS sortir en page HTML
    // Bun avec l'exception brute : JSON 500 au format contrat, sans message
    // interne (I6).
    error: () => Response.json({ error: { code: "internal", message: "internal error" } }, { status: 500 }),
  });
  console.log(`[server] écoute sur ${hostname}:${server.port}`);
  // Relecture initiale sans bloquer l'écoute : l'app peut tirer tout de suite.
  void app.warmup();
  // Arrêt propre : les sockets en cours (SSE) sont fermés, le process se termine.
  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} -> arret`);
    server.stop();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  return server;
}

if (import.meta.main) start();