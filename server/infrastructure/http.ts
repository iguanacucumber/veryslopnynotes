// Point d'entrée HTTP du serveur (composition root, référencé par Dockerfile.server).
// Unique endroit où l'env, les sessions Pronote, le reader, le LLM et les ports
// d'écriture/action sont branchés sur le routeur. Aucun secret n'est journalisé :
// on ne logue que des compteurs et des codes d'erreur (I6, règle d'or dépôt).
// I2 : tout le réseau Pronote passe par PronoteHttpClient (via pronotets), rien ici.
// I7 : les écritures (devoirs, messagerie) sont des ports d'action branchés sur le
// reader, atteignables uniquement via une route (= action app confirmée).
import { createHash } from "node:crypto";
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

  /** Mono-compte : la session appairée unique, sinon compte demandé. */
  const resolveAccountId = (requested: string): string => {
    const trimmed = requested.trim();
    if (trimmed) return trimmed;
    return sessions?.currentAccountId() ?? accountId;
  };

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
        .then(() => liveSync.run(accountId))
        .then(() => log("pairing -> session ouverte, snapshot rafraichi"))
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
    liveSync.actions,
    discussionActions,
  );

  return {
    handler,
    store,
    liveSync,
    sessions,
    warmup: async () => {
      if (!sessions) return;
      try {
        await sessions.authenticate({ accountId, username, password, entKind });
        await liveSync.run(accountId);
        log("warmup -> snapshot initial rempli");
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

/** Démarre le serveur (CLI). `HOST` explicite requis pour exposer hors loopback. */
/** Type de retour : `ReturnType<typeof Bun.serve>` (le type Bun global n'expose pas `serve`). */
export function start(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): ReturnType<typeof Bun.serve> {
  const app = createApp(env);
  const port = Number.parseInt(envValue(env, "PORT"), 10) || DEFAULT_PORT;
  const hostname = envValue(env, "HOST") || "127.0.0.1";
  const server = Bun.serve({ port, hostname, fetch: app.handler });
  console.log(`[server] écoute sur ${hostname}:${server.port}`);
  // Relecture initiale sans bloquer l'écoute : l'app peut tire tout de suite.
  void app.warmup();
  return server;
}

if (import.meta.main) start();