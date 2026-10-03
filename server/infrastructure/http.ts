// Point d'entrée HTTP du serveur (composition root, référencé par Dockerfile.server).
// Unique endroit où l'env, les sessions Pronote, le reader, le LLM et les ports
// d'écriture/action sont branchés sur le routeur. Aucun secret n'est journalisé :
// on ne logue que des compteurs et des codes d'erreur (I6, règle d'or dépôt).
// I2 : tout le réseau Pronote passe par PronoteHttpClient (via pronotets), rien ici.
// I7 : les écritures (devoirs, messagerie) sont des ports d'action branchés sur le
// reader, atteignables uniquement via une route (= action app confirmée).
import { createHash } from "node:crypto";
import type { ContractEvent } from "../../shared/contracts/events";
import { createHandler } from "../api/router";
import type { AssignmentActions, MediaActions } from "../api/assignments";
import type { DiscussionActions } from "../api/discussions";
import { PairingService } from "../api/pairing";
import { createSubjectPrefsMemoryStore } from "../api/subject-prefs";
import { createRevisionMemoryStore } from "../api/revision";
import type { PronoteReader } from "../domain/ports";
import { PronoteWriteError } from "../domain/ports";
import { PronoteClientReader } from "../integrations/pronote-client-reader";
import { PronoteSessionStore } from "../integrations/pronote-sessions";
import { createLlmProvider } from "./llm-openrouter";
import { mediaActions } from "./media-proxy";
import { createLiveSync } from "./live-sync";
import type { LiveSync } from "./live-sync";
import { SnapshotStore } from "./snapshot-store";

const DEFAULT_PORT = 3000;
/** Type ENT/CAS : ninegate par défaut (seul SSO implémenté, cf. ent-ninegate.ts). */
const DEFAULT_ENT_KIND = "ninegate";

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
 * accountId = empreinte du compte, jamais le compte en clair : il apparaît dans
 * les logs, les snapshots et les événements SSE.
 */
function accountIdFrom(username: string): string {
  return createHash("sha256").update(`pronote:${username}`).digest("hex").slice(0, 16);
}

export function createApp(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
  deps: AppDeps = {},
): App {
  const log = (message: string) => console.log(`[server] ${message}`);
  const store = new SnapshotStore();
  const llm = createLlmProvider(env);

  const pronoteUrl = envValue(env, "PRONOTE_URL");
  const username = envValue(env, "PRONOTE_USERNAME");
  const password = envValue(env, "PRONOTE_PASSWORD");
  const entKind = envValue(env, "PRONOTE_ENT_KIND") || DEFAULT_ENT_KIND;
  const accountId = username ? accountIdFrom(username) : "";

  // `null` explicite = aucun store (tests) : ne jamais construire une session
  // réelle depuis l'env quand le caller a dit non.
  let sessions: PronoteSessionStore | null = deps.sessions === undefined ? null : deps.sessions;
  if (deps.sessions === undefined && pronoteUrl) {
    sessions = new PronoteSessionStore({
      pronoteUrl,
      logger: (m) => log(`pronote ${m}`),
      // #87 : renewal de session. Les identifiants restent en mémoire fermée,
      // jamais journalisés ni persistés (le store ne les conserve pas).
      ...(username && password && accountId
        ? {
            renew: async (target: string) => {
              await sessions?.authenticate({ accountId: target, username, password, entKind });
            },
          }
        : {}),
    });
  }
  const reader: PronoteReader | null =
    deps.reader === undefined
      ? sessions
        ? new PronoteClientReader({ sessions, logger: (m) => log(`reader ${m}`) })
        : null
      : deps.reader;
  if (!sessions) log("PRONOTE_URL absent : lectures vides, ecritures indisponibles (501)");

  /** Mono-compte : le compte appairé par le serveur, et RIEN d'autre.
   *  L'`accountId` transporté par le client n'est qu'un indice borné : le
   *  prendre pour une identité ouvrait une session Pronote pour un compte
   *  jamais appairé, et cassait la résolution mono-compte
   *  (`currentAccountId()` = null dès qu'une 2e session existe). */
  const resolveAccountId = (_requested: string): string => sessions?.currentAccountId() ?? accountId;

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
   * Relecture UNIQUE et sérialisée : passe par `actions.refresh`, donc warmup et
   * l'appairage partagent le même garde-fou mono-relecture que
   * POST /v1/sync/refresh (appeler `liveSync.run` en direct doublait la passe sur
   * la session Pronote : rafale de `session_expired` + snapshot de diff écrit
   * deux fois).
   */
  const refreshSnapshot = (): Promise<ContractEvent[]> => liveSync.actions.refresh(accountId);

  /**
   * Journal honnête (I6) : « rempli » seulement si la relecture a réellement
   * alimenté le snapshot. Zéro note lue = rien n'a été rempli, on le dit.
   */
  const logSnapshotFilled = (subject: string): void => {
    const grades = store.grades().length;
    if (grades === 0) log(`${subject} relecture vide (aucune note lue), l'app retry`);
    else log(`${subject} snapshot rempli (${grades} note(s))`);
  };

  // Appairage réussi = on ouvre la session Pronote puis on warms le snapshot.
  // L'auth est déclenchée APRÈS la réponse (fire-and-forget) : la confirmation
  // d'appairage ne doit pas dépendre de la disponibilité de l'ENT.
  const pairing = new PairingService();
  const baseConfirm = pairing.confirm.bind(pairing);
  pairing.confirm = (sessionId: string, code: string) => {
    const result = baseConfirm(sessionId, code);
    if (result.ok && sessions && username && password) {
      void sessions
        .authenticate({ accountId, username, password, entKind })
        .then(() => {
          // Pas de reader = relecture impossible : ne jamais annoncer un
          // snapshot rafraichi qui n'a pas eu lieu (I6).
          if (!reader) return log("pairing -> session ouverte, relecture ignoree (aucun reader)");
          return refreshSnapshot().then(() => logSnapshotFilled("pairing -> session ouverte,"));
        })
        .catch((err: unknown) => {
          // Jamais le message brut (peut contenir une interne) : code seulement.
          const code2 = err instanceof Error ? err.name : "unknown";
          log(`pairing -> authentification impossible (${code2})`);
        });
    }
    return result;
  };

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
  );

  return {
    handler,
    store,
    liveSync,
    sessions,
    warmup: async () => {
      // Sans session, ou SANS identifiants (PRONOTE_URL seul) : aucune
      // authentification à tenter — une session ouverte avec un username vide
      // est pire que pas de session du tout.
      if (!sessions || !username || !password) return;
      try {
        await sessions.authenticate({ accountId, username, password, entKind });
        if (!reader) return log("warmup -> aucune lecture (aucun reader), le serveur demarre vide");
        await refreshSnapshot();
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
  const app = createApp(env);
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