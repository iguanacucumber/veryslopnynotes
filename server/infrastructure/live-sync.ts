// Moteur de relecture LIVE branché sur le reader Pronote (#87, POST /v1/sync/refresh).
// Deux passes, toutes deux SÉQUENTIELLES :
//   1. cœur (notes, devoirs, EDT) via `runSync` : diff STRUCTURÉ sur empreintes,
//      premier sync = zéro événement (pas de faux positif), I7 respecté (aucun LLM).
//   2. ressources secondaires (périodes, compétences, actus, cantine, vie scolaire,
//      profil, capacités, messagerie) : une par une, en DÉFAVEUR — un onglet absent
//      ou en erreur laisse l'instantané précédent intact et n'annule pas le reste.
// Chaque ressource n'est lue qu'UNE fois par refresh, puis appliquée à l'instantané.
// Pagination suivie jusqu'à `nextCursor: null` : une page seule tronquerait l'EDT
// et les notes EN SILENCE (le curseur est relu tant qu'il avance).
// ÉTAT PAR COMPTE : garde de vol ET snapshot de diff sont indexés par compte résolu
// — deux comptes ne doivent jamais observer les événements (donc les notes) de
// l'autre. Voir `snapshots` et `inflight`.
// Aucun journal de contenu : compteurs et codes seulement (I6, PII).
//
// SÉQUENCEUX = contrainte mesurée, pas préférence : le client pronotets n'est pas
// sûr en concurrence (mesure locale : 10 lectures en parallèle sur une session
// neuve → `session_expired` en rafale). Le snapshot est appliqué AU FUR ET À
// MESURE, donc un GET concurrent voit déjà le cœur à jour pendant que les
// secondaires se chargent. ponytail: une seule session sérialisée par compte ;
// upgrade: sessions parallèles par compte si le client devient sûr.
import type { CacheableResource } from "../../shared/contracts/cache";
import { CONTRACTS_VERSION, isAssignment, isGrade, isTimetableEntry } from "../../shared/contracts/models";
import type {
  AbsenceRecord,
  Assignment,
  CanteenMenu,
  Capabilities,
  Discussion,
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
import { PronoteAuthError, PronoteReadError } from "../domain/ports";
import { runSync } from "../jobs/sync";
import type { SyncSnapshot } from "../jobs/sync";
import type { SnapshotPatch, SnapshotStore } from "./snapshot-store";

/** Page Pronote : `items` est wrappé `Untrusted` par le reader réel. */
type Page<T> = { items: { value: T[] }; nextCursor?: string | null };

/** Options de page : curseur opaque, renvoyé tel quel par le reader. */
type PageRequest = { cursor?: string };

/**
 * Sous-ensemble du reader utilisé par la relecture. Toutes les méthodes sont
 * optionnelles : une lib qui n'expose pas un onglet = ressource absente = état
 * vide côté app, jamais une erreur serveur.
 */
export interface LiveReader {
  getGrades?(accountId: string, page?: PageRequest): Promise<Page<Grade>>;
  getAssignments?(accountId: string, page?: PageRequest): Promise<Page<Assignment>>;
  getTimetable?(accountId: string, page?: PageRequest): Promise<Page<TimetableEntry>>;
  getPeriods?(accountId: string, page?: PageRequest): Promise<Page<Period>>;
  getNews?(accountId: string, page?: PageRequest): Promise<Page<NewsItem>>;
  getMenus?(accountId: string, page?: PageRequest): Promise<Page<CanteenMenu>>;
  getAttendance?(accountId: string, page?: PageRequest): Promise<Page<AbsenceRecord>>;
  getPunishments?(accountId: string, page?: PageRequest): Promise<Page<Punishment>>;
  getUserInfo?(accountId: string, page?: PageRequest): Promise<Page<UserInfo>>;
  /** Objet unique (pas une page) ; `null` = capacités non déterminées. */
  getCapabilities?(accountId: string): Promise<Capabilities | null>;
  getDiscussions?(accountId: string, page?: PageRequest): Promise<Page<Discussion>>;
  getDiscussionRecipients?(accountId: string, page?: PageRequest): Promise<Page<Recipient>>;
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

/**
 * Plafond de pages par ressource. Le budget de temps arrête déjà un onglet lent ;
 * ce plafond arrête un reader qui renverrait un curseur en boucle (et on le dit,
 * jamais de troncature muette).
 */
const MAX_PAGES_PER_RESOURCE = 50;

/** Patch d'instantané ↔ ressource cachable (invalidations SSE, un 1:1 explicite). */
const CACHEABLE_BY_PATCH: { key: keyof SnapshotPatch; resource: CacheableResource }[] = [
  { key: "grades", resource: "grades" },
  { key: "assignments", resource: "assignments" },
  { key: "entries", resource: "timetable" },
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

/** Session morte = l'app DOIT se ré-appairer : l'échec remonte, il n'est pas avalé. */
function isSessionExpired(err: unknown): boolean {
  if (err instanceof PronoteReadError || err instanceof PronoteAuthError) return err.code === "session_expired";
  return false;
}

export function createLiveSync(options: LiveSyncOptions): LiveSync {
  const { reader, store } = options;
  const logger = options.logger ?? (() => {});
  const timeoutMs = options.timeoutMs ?? DEFAULT_RESOURCE_TIMEOUT_MS;
  // Snapshots de sync PAR COMPTE (empreintes entre deux refresh successifs) :
  // un diff relatif au compte A ne doit jamais servir de baseline au compte B.
  const snapshots = new Map<string, SyncSnapshot>();
  // Un seul vol PAR COMPTE : deux relectures concurrentes du même compte
  // partageraient la session Pronote (rafale de `session_expired`), et deux
  // comptes distincts ne doivent jamais observer les événements de l'autre.
  const inflight = new Map<string, Promise<ContractEvent[]>>();

  /** Patch d'une ressource liste, `null` si la lecture n'a rien donné. */
  const patchOf = <K extends keyof SnapshotPatch>(key: K, value: SnapshotPatch[K] | null): SnapshotPatch | null =>
    value === null ? null : ({ [key]: value } as SnapshotPatch);
  /** Capacités : objet unique (pas une page), `null` = non déterminées. */
  const readCaps = async (account: string): Promise<Capabilities | null> => {
    if (!reader?.getCapabilities) return null;
    // Minuteur de budget annulé en FINALE, comme `read` : sinon chaque refresh
    // laisse un minuteur armé (le processus ne rend pas la main).
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        reader.getCapabilities(account),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        }),
      ]);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  /**
   * Toutes les pages d'une ressource liste, `null` si la lecture a échoué ou
   * dépassé le budget (instantané précédent conservé). Pagination suivie jusqu'à
   * `nextCursor: null` : s'arrêter à la 1re page tronquerait l'EDT et les notes
   * sans aucun signal. Une session morte RELANCE l'échec : l'app se ré-appaire
   * au lieu de lire un « zéro note » (I6).
   */
  const read = async <T>(
    account: string,
    fn: ((accountId: string, page?: PageRequest) => Promise<Page<T>>) | undefined,
  ): Promise<T[] | null> => {
    if (!fn) return null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const items: T[] = [];
    let cursor: string | undefined;
    try {
      // Un seul budget pour la ressource entière (toutes pages confondues).
      const budget: Promise<never> = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      });
      for (let page = 0; page < MAX_PAGES_PER_RESOURCE; page++) {
        const lue: Page<T> = await Promise.race([fn(account, { cursor }), budget]);
        items.push(...lue.items.value);
        const next = lue.nextCursor;
        // Curseur absent, vide ou identique au précédent = fin (reader sans
        // pagination, ou curseur qui boucle).
        if (typeof next !== "string" || next === "" || next === cursor) {
          if (typeof next === "string" && next === cursor) logger("sync -> pagination : curseur fige, lecture arretee");
          return items;
        }
        cursor = next;
      }
      logger(`sync -> pagination tronquee (${MAX_PAGES_PER_RESOURCE} pages max)`);
      return items;
    } catch (err) {
      // Un onglet mort = « session expirée » : l'échec remonte au client au lieu
      // d'être avalé en `null` (sinon 200 + SyncCompleted « ok », jamais de
      // ré-appairage).
      if (isSessionExpired(err)) throw new PronoteAuthError("session expirée", "session_expired");
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const runOnce = async (accountId: string): Promise<ContractEvent[]> => {
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
    // Filtrage AVANT écriture : l'instantané sert les GET, donc il ne contient que
    // des enregistrements contractuels (un hors contrat = 500 sur tout l'onglet).
    const grades = (await read(account, reader.getGrades?.bind(reader)))?.filter(isGrade) ?? null;
    store.apply({ grades: grades ?? undefined });
    const assignments = (await read(account, reader.getAssignments?.bind(reader)))?.filter(isAssignment) ?? null;
    store.apply({ assignments: assignments ?? undefined });
    const entries = (await read(account, reader.getTimetable?.bind(reader)))?.filter(isTimetableEntry) ?? null;
    store.apply({ entries: entries ?? undefined });

    const previous = snapshots.get(account) ?? null;
    const sink = {
      loadSnapshot: async () => previous,
      saveSnapshot: async (s: SyncSnapshot) => {
        snapshots.set(account, s);
      },
    };
    const core = await runSync(
      {
        grades: async () => grades ?? [],
        assignments: async () => assignments ?? [],
        entries: async () => entries ?? [],
      },
      sink,
      at,
    );
    // Un cœur en échec ne réécrit PAS sa baseline de diff : sinon, au retour du
    // réseau, tout l'historique repart en GradeCreated (faux positifs en rafale).
    // L'instantané conserve la donnée légèrement périmée, jamais « zéro note ».
    const baseline: SyncSnapshot =
      grades === null || assignments === null || entries === null
        ? {
            ...core.snapshot,
            gradeIds: grades === null ? (previous?.gradeIds ?? []) : core.snapshot.gradeIds,
            gradePrints: grades === null ? (previous?.gradePrints ?? {}) : core.snapshot.gradePrints,
            assignmentIds: assignments === null ? (previous?.assignmentIds ?? []) : core.snapshot.assignmentIds,
            entryIds: entries === null ? (previous?.entryIds ?? []) : core.snapshot.entryIds,
            entryPrints: entries === null ? (previous?.entryPrints ?? {}) : core.snapshot.entryPrints,
          }
        : core.snapshot;
    if (baseline !== core.snapshot) await sink.saveSnapshot(baseline);

    // Passe 2 : secondaires, séquentielles (voir entête) et appliquées au fil de
    // l'eau pour que le snapshot reste lisible pendant le chargement.
    const secondary: (() => Promise<SnapshotPatch | null>)[] = [
      async () => patchOf("periods", await read(account, reader.getPeriods?.bind(reader))),
      async () => {
        const caps = await readCaps(account);
        return caps ? { capabilities: caps } : null;
      },
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
          // Compteurs de l'instantané EFFECTIF (baseline conservée si lecture KO).
          grades: baseline.gradeIds.length,
          assignments: baseline.assignmentIds.length,
        },
      },
    ];
    const echecs = [grades, assignments, entries].filter((v) => v === null).length;
    if (echecs > 0) logger(`sync -> partiel ${events.length} evenement(s), ${echecs} coeur(s) en echec`);
    else logger(`sync -> ok ${events.length} evenement(s)`);
    return events;
  };

  /**
   * Vol par compte : `run()` ET `actions.refresh()` passent par ici, donc warmup
   * et pull-refresh ne doublent jamais la passe Pronote. La libération a lieu
   * après une microtâche (les continuations des appelants d'abord) : deux
   * demandes émises dans la même boucle partagent une seule passe au lieu de se
   * percuter sur la session.
   */
  const refresh = (accountId: string): Promise<ContractEvent[]> => {
    const account = options.resolveAccountId(accountId);
    const current = inflight.get(account);
    if (current) return current;
    const p = runOnce(accountId);
    inflight.set(account, p);
    const release = (): void => {
      if (inflight.get(account) === p) inflight.delete(account);
    };
    // Un tour de microtâche AVANT la libération : le retour d'un vol doit
    // d'abord remonter à ses appelants. Sans cela, la demande suivante émise dans
    // cette continuation (warmup puis pull-refresh, même boucle) repartirait sur
    // Pronote alors que la passe vient d'aboutir.
    p.then(() => {}).then(release, release);
    return p;
  };

  return {
    actions: { refresh },
    // Même garde que la route : `run()` seul était un deuxième chemin de lecture.
    run: refresh,
  };
}
