// Moteur de relecture LIVE branché sur le reader Pronote (#87, POST /v1/sync/refresh).
// Deux passes, toutes deux SÉQUENTIELLES :
//   1. cœur (notes, devoirs, EDT) via `runSync` : diff STRUCTURÉ sur empreintes,
//      premier sync = zéro événement (pas de faux positif), I7 respecté (aucun LLM).
//   2. ressources secondaires (périodes, compétences, actus, cantine, vie scolaire,
//      profil, capacités, messagerie) : une par une, en DÉFAVEUR — un onglet absent
//      ou en erreur laisse l'instantané précédent intact et n'annule pas le reste.
// Chaque ressource n'est lue qu'UNE fois par refresh, puis appliquée à l'instantané.
// Aucun journal de contenu : compteurs et codes seulement (I6, PII).
//
// SÉQUENCEUX = contrainte mesurée, pas préférence : le client pronotets n'est pas
// sûr en concurrence (mesure locale : 10 lectures en parallèle sur une session
// neuve → `session_expired` en rafale). Le snapshot est appliqué AU FUR ET À
// MESURE, donc un GET concurrent voit déjà le cœur à jour pendant que les
// secondaires se chargent. ponytail: une seule session sérialisée par compte ;
// upgrade: sessions parallèles par compte si le client devient sûr.
import type { CacheableResource } from "../../shared/contracts/cache";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import type {
  AbsenceRecord,
  Assignment,
  CanteenMenu,
  Capabilities,
  Discussion,
  Evaluation,
  Grade,
  NewsItem,
  Period,
  Punishment,
  Recipient,
  TimetableEntry,
  UserInfo,
} from "../../shared/contracts/models";
import type { ContractEvent } from "../../shared/contracts/events";
import type { SyncRefreshActions } from "../api/sync-refresh";
import { runSync } from "../jobs/sync";
import type { SyncSnapshot } from "../jobs/sync";
import type { SnapshotPatch, SnapshotStore } from "./snapshot-store";

type Page<T> = { items: { value: T[] } };

/**
 * Sous-ensemble du reader utilisé par la relecture. Toutes les méthodes sont
 * optionnelles : une lib qui n'expose pas un onglet = ressource absente = état
 * vide côté app, jamais une erreur serveur.
 */
export interface LiveReader {
  getGrades?(accountId: string): Promise<Page<Grade>>;
  getAssignments?(accountId: string): Promise<Page<Assignment>>;
  getTimetable?(accountId: string): Promise<Page<TimetableEntry>>;
  getPeriods?(accountId: string): Promise<Page<Period>>;
  getEvaluations?(accountId: string): Promise<Page<Evaluation>>;
  getNews?(accountId: string): Promise<Page<NewsItem>>;
  getMenus?(accountId: string): Promise<Page<CanteenMenu>>;
  getAttendance?(accountId: string): Promise<Page<AbsenceRecord>>;
  getPunishments?(accountId: string): Promise<Page<Punishment>>;
  getUserInfo?(accountId: string): Promise<Page<UserInfo>>;
  /** Objet unique (pas une page) ; `null` = capacités non déterminées. */
  getCapabilities?(accountId: string): Promise<Capabilities | null>;
  getDiscussions?(accountId: string): Promise<Page<Discussion>>;
  getDiscussionRecipients?(accountId: string): Promise<Page<Recipient>>;
}

export interface LiveSyncOptions {
  readonly reader: LiveReader | null;
  readonly store: SnapshotStore;
  /** Résout le compte à relire : "" = serveur mono-compte (session appairée unique). */
  readonly resolveAccountId: (accountId: string) => string;
  /**
   * Prépare la session AVANT la passe parallèle (renewal #87). Indispensable :
   * le reader valide la session avant CHAQUE lecture, donc des lectures
   * parallèles déclencheraient plusieurs renewals — le nouveau client remplacerait
   * l'ancien en cours de route et les lectures déjà lancées meurent en
   * `session_expired`. Un seul renewal par refresh, puis lecture.
   */
  readonly prepare?: (accountId: string) => Promise<void>;
  /** Budget par ressource : un onglet lent ne bloque pas le refresh (défaut 10 s). */
  readonly timeoutMs?: number;
  readonly logger?: (message: string) => void;
}

/** Timeout par ressource : évite qu'un onglet lent gèle le pull-refresh. */
const DEFAULT_RESOURCE_TIMEOUT_MS = 10_000;

/** Patch d'instantané ↔ ressource cachable (invalidations SSE, un 1:1 explicite). */
const CACHEABLE_BY_PATCH: { key: keyof SnapshotPatch; resource: CacheableResource }[] = [
  { key: "grades", resource: "grades" },
  { key: "assignments", resource: "assignments" },
  { key: "entries", resource: "timetable" },
  { key: "evaluations", resource: "evaluations" },
  { key: "news", resource: "news" },
  { key: "canteenMenus", resource: "menus" },
  { key: "absences", resource: "attendance" },
  { key: "punishments", resource: "punishments" },
  { key: "capabilities", resource: "capabilities" },
  { key: "discussions", resource: "discussions" },
];

export interface LiveSync {
  /** Port injecté dans le routeur (POST /v1/sync/refresh). */
  readonly actions: SyncRefreshActions;
  /** Relecture bornée d'un compte : événements de sync (aucun effet de bord). */
  run(accountId: string): Promise<ContractEvent[]>;
}

export function createLiveSync(options: LiveSyncOptions): LiveSync {
  const { reader, store } = options;
  const logger = options.logger ?? (() => {});
  // Snapshot de sync en mémoire (empreintes entre deux refresh successifs).
  let snapshot: SyncSnapshot | null = null;
  const sink = {
    loadSnapshot: async () => snapshot,
    saveSnapshot: async (s: SyncSnapshot) => {
      snapshot = s;
    },
  };
  // Un seul refresh à la fois : deux relectures concurrentes partageraient le
  // snapshot et l'app verrait des événements croisés.
  let inflight: Promise<ContractEvent[]> | null = null;

  const timeoutMs = options.timeoutMs ?? DEFAULT_RESOURCE_TIMEOUT_MS;
  /** Patch d'une ressource liste, `null` si la lecture n'a rien donné. */
  const patchOf = <K extends keyof SnapshotPatch>(key: K, value: SnapshotPatch[K] | null): SnapshotPatch | null =>
    value === null ? null : ({ [key]: value } as SnapshotPatch);
  /** Capacités : objet unique (pas une page), `null` = non déterminées. */
  const readCaps = async (account: string): Promise<Capabilities | null> => {
    if (!reader?.getCapabilities) return null;
    try {
      return await Promise.race([
        reader.getCapabilities(account),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);
    } catch {
      return null;
    }
  };
  /** Une lecture KO ou trop lente = `null` (instantané précédent conservé). */
  const read = async <T>(
    account: string,
    fn: ((accountId: string) => Promise<Page<T>>) | undefined,
  ): Promise<T[] | null> => {
    if (!fn) return null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const page = await Promise.race([
        fn(account),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        }),
      ]);
      return page.items.value;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const run = async (accountId: string): Promise<ContractEvent[]> => {
    const account = options.resolveAccountId(accountId);
    if (!reader) {
      // Pas de session configurée : rien à relire, aucun mensonge au client.
      logger("sync -> skip (aucune session Pronote)");
      return [];
    }
    if (!account) {
      logger("sync -> skip (aucun compte appairé)");
      return [];
    }
    const at = new Date().toISOString();
    // Renewal UNIQUE avant les lectures parallèles (voir LiveSyncOptions.prepare).
    try {
      await options.prepare?.(account);
    } catch {
      // Préparation ratée : on tente quand même la lecture, le reader la remontera
      // en session_expired si la session est morte (l'app se ré-appaire).
    }

    // Passe 1 : cœur. Une seule lecture par ressource, réutilisée par le diff
    // ET par l'instantané (sinon deux requêtes Pronote pour la même donnée).
    const grades = await read(account, reader.getGrades?.bind(reader));
    store.apply({ grades: grades ?? undefined });
    const assignments = await read(account, reader.getAssignments?.bind(reader));
    store.apply({ assignments: assignments ?? undefined });
    const entries = await read(account, reader.getTimetable?.bind(reader));
    store.apply({ entries: entries ?? undefined });
    const core = await runSync(
      {
        grades: async () => grades ?? [],
        assignments: async () => assignments ?? [],
        entries: async () => entries ?? [],
      },
      sink,
      at,
    );
    store.apply({
      // Une lecture en échec n'efface pas l'instantané précédent (choix : afficher
      // une donnée légèrement périmée plutôt qu'un onglet vide).
      grades: grades ?? undefined,
      assignments: assignments ?? undefined,
      entries: entries ?? undefined,
    });

    // Passe 2 : secondaires, séquentielles (voir entête) et appliquées au fil de
    // l'eau pour que le snapshot reste lisible pendant le chargement.
    const secondary: (() => Promise<SnapshotPatch | null>)[] = [
      async () => patchOf("periods", await read(account, reader.getPeriods?.bind(reader))),
      async () => {
        const caps = await readCaps(account);
        return caps ? { capabilities: caps } : null;
      },
      async () => patchOf("evaluations", await read(account, reader.getEvaluations?.bind(reader))),
      async () => patchOf("news", await read(account, reader.getNews?.bind(reader))),
      async () => patchOf("canteenMenus", await read(account, reader.getMenus?.bind(reader))),
      async () => patchOf("absences", await read(account, reader.getAttendance?.bind(reader))),
      async () => patchOf("punishments", await read(account, reader.getPunishments?.bind(reader))),
      async () => {
        const users = await read(account, reader.getUserInfo?.bind(reader));
        return users ? { userInfo: users[0] ?? null } : null;
      },
      async () => patchOf("discussions", await read(account, reader.getDiscussions?.bind(reader))),
      async () =>
        patchOf("discussionRecipients", await read(account, reader.getDiscussionRecipients?.bind(reader))),
    ];
    const patch: SnapshotPatch = {};
    for (const load of secondary) {
      const part = await load();
      // Ressource absente ou en erreur = pas de mise à jour (instantané conservé).
      if (!part) continue;
      Object.assign(patch, part);
      store.apply(part);
    }

    const events: ContractEvent[] = [
      ...core.events,
      ...CACHEABLE_BY_PATCH.filter((c) => patch[c.key] !== undefined).map<ContractEvent>((c) => ({
        v: CONTRACTS_VERSION,
        type: "CacheInvalidated",
        at,
        data: { resource: c.resource, reason: "sync" },
      })),
      {
        v: CONTRACTS_VERSION,
        type: "SyncCompleted",
        at,
        data: {
          accountId: account,
          grades: core.snapshot.gradeIds.length,
          assignments: core.snapshot.assignmentIds.length,
        },
      },
    ];
    logger(`sync -> ok ${events.length} evenement(s)`);
    return events;
  };

  return {
    actions: {
      refresh: async (accountId: string) => {
        // Un seul refresh à la fois : le suivant réutilise le résultat en cours.
        if (inflight) return inflight;
        inflight = run(accountId).finally(() => {
          inflight = null;
        });
        return inflight;
      },
    },
    run,
  };
}