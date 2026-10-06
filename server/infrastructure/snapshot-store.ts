// Store de lecture LIVE branché sur le reader Pronote.
// Le routeur lit un `ReadStore` SYNCHRONE : on garde donc un instantané des
// dernières lectures en mémoire, rafraîchi par le moteur de sync (#live-sync).
// L'app est offline-first et tire au refresh : un serveur qui redémarre repart
// d'un instantané vide et se remplit au premier pull-refresh (pas de 500).
// ponytail: instantané en mémoire seulement, PAS de persistance — l'app a sa
// propre cache disque. Upgrade: snapshot sérialisé via StorageProvider
// (sqlite-storage.ts) si un redémarrage serveur doit garder l'historique.
import type {
  AbsenceRecord,
  Assignment,
  CanteenBalance,
  CanteenMenu,
  Capabilities,
  Discussion,
  Grade,
  Message,
  NewsItem,
  Period,
  Punishment,
  Recipient,
  TimetableEntry,
  UserInfo,
} from "../../shared/contracts/models";
import type { SecurityAlertData } from "../../shared/contracts/events";
import type { ProvidedAveragesByPeriod } from "../domain/averages";
import type { ReadStore } from "../api/store";

/**
 * Patch d'instantané : seules les clés présentes remplacent l'état courant.
 * `undefined` = « pas de mise à jour » (lecture KO), `null` = « valeur absente »
 * (ex. solde de cantine non publié, capacités non déterminées).
 */
export interface SnapshotPatch {
  readonly grades?: Grade[];
  readonly assignments?: Assignment[];
  readonly entries?: TimetableEntry[];
  readonly periods?: Period[];
  readonly providedAverages?: ProvidedAveragesByPeriod;
  readonly news?: NewsItem[];
  readonly canteenMenus?: CanteenMenu[];
  readonly canteenBalance?: CanteenBalance | null;
  readonly absences?: AbsenceRecord[];
  readonly punishments?: Punishment[];
  readonly userInfo?: UserInfo | null;
  readonly capabilities?: Capabilities | null;
  readonly discussions?: Discussion[];
  /** Messages par fil : données personnelles, jamais journalisées. */
  readonly discussionMessages?: Record<string, Message[]>;
  readonly discussionRecipients?: Recipient[];
}

/** Compte porté par un patch, s'il est connu (données personnelles). */
function patchAccountId(patch: SnapshotPatch): string | null {
  return (
    patch.userInfo?.accountId ??
    patch.capabilities?.accountId ??
    patch.grades?.[0]?.accountId ??
    patch.assignments?.[0]?.accountId ??
    patch.entries?.[0]?.accountId ??
    patch.news?.[0]?.accountId ??
    patch.canteenMenus?.[0]?.accountId ??
    patch.absences?.[0]?.accountId ??
    patch.punishments?.[0]?.accountId ??
    null
  );
}

export class SnapshotStore implements ReadStore {
  private stateGrades: Grade[] = [];
  private stateAssignments: Assignment[] = [];
  private stateEntries: TimetableEntry[] = [];
  private statePeriods: Period[] = [];
  private provided: ProvidedAveragesByPeriod = {};
  private stateNews: NewsItem[] = [];
  private stateCanteenMenus: CanteenMenu[] = [];
  private stateCanteenBalance: CanteenBalance | null = null;
  private stateAbsences: AbsenceRecord[] = [];
  private statePunishments: Punishment[] = [];
  private stateUserInfo: UserInfo | null = null;
  private stateCapabilities: Capabilities | null = null;
  private stateDiscussions: Discussion[] = [];
  private stateMessages: Record<string, Message[]> = {};
  private stateRecipients: Recipient[] = [];
  /** Compte propriétaire de l'instantané courant (`null` = inconnu). */
  private stateAccountId: string | null = null;
  private readonly alerts: SecurityAlertData[];

  constructor(patch: SnapshotPatch = {}, alerts: SecurityAlertData[] = []) {
    // Clone à l'entrée : le tableau du caller ne doit jamais pouvoir
    // corrompre l'instantané (tous les autres champs passent par apply()).
    this.alerts = structuredClone(alerts);
    this.apply(patch);
  }

  /**
   * Remplace uniquement les ressources présentes (une lecture ratée ne purge
   * rien) — SAUF si le compte change : l'instantané appartient alors au compte
   * précédent et ne doit jamais fuiter dans la vue du nouveau compte.
   *
   * `accountId` = compte déjà résolu par le moteur de sync ; il permet
   * d'invalider même quand la lecture a échoué (aucune ligne à comparator).
   * Absent, le compte est déduit du patch. ponytail: le patch est mono-compte
   * par construction (le reader ne lit qu'un compte à la fois) — si un patch
   * mélangeait deux comptes, c'est un bug reader, pas un cas géré ici.
   */
  apply(patch: SnapshotPatch, accountId?: string): void {
    const incoming = accountId ?? patchAccountId(patch);
    if (incoming && this.stateAccountId && incoming !== this.stateAccountId) this.clearAccountState();
    if (incoming) this.stateAccountId = incoming;
    if (patch.grades) this.stateGrades = structuredClone(patch.grades);
    if (patch.assignments) this.stateAssignments = structuredClone(patch.assignments);
    if (patch.entries) this.stateEntries = structuredClone(patch.entries);
    if (patch.periods) this.statePeriods = structuredClone(patch.periods);
    if (patch.providedAverages !== undefined) this.provided = structuredClone(patch.providedAverages);
    if (patch.news) this.stateNews = structuredClone(patch.news);
    if (patch.canteenMenus) this.stateCanteenMenus = structuredClone(patch.canteenMenus);
    if (patch.canteenBalance !== undefined) this.stateCanteenBalance = structuredClone(patch.canteenBalance);
    if (patch.absences) this.stateAbsences = structuredClone(patch.absences);
    if (patch.punishments) this.statePunishments = structuredClone(patch.punishments);
    if (patch.userInfo !== undefined) this.stateUserInfo = structuredClone(patch.userInfo);
    if (patch.capabilities !== undefined) this.stateCapabilities = structuredClone(patch.capabilities);
    if (patch.discussions) this.stateDiscussions = structuredClone(patch.discussions);
    if (patch.discussionMessages) this.stateMessages = structuredClone(patch.discussionMessages);
    if (patch.discussionRecipients) this.stateRecipients = structuredClone(patch.discussionRecipients);
  }

  /** Purge l'instantané à un changement de compte : plus aucune ligne du précédent. */
  private clearAccountState(): void {
    this.stateGrades = [];
    this.stateAssignments = [];
    this.stateEntries = [];
    this.statePeriods = [];
    this.provided = {};
    this.stateNews = [];
    this.stateCanteenMenus = [];
    this.stateCanteenBalance = null;
    this.stateAbsences = [];
    this.statePunishments = [];
    this.stateUserInfo = null;
    this.stateCapabilities = null;
    this.stateDiscussions = [];
    this.stateMessages = Object.create(null) as Record<string, Message[]>;
    this.stateRecipients = [];
  }

  grades(): Grade[] {
    return structuredClone(this.stateGrades);
  }
  assignments(): Assignment[] {
    return structuredClone(this.stateAssignments);
  }
  entries(): TimetableEntry[] {
    return structuredClone(this.stateEntries);
  }
  /** Alertes sécurité : alimentées par le pipeline IA, pas par le reader. */
  securityAlerts(): SecurityAlertData[] {
    return structuredClone(this.alerts);
  }
  periods(): Period[] {
    return structuredClone(this.statePeriods);
  }
  providedAverages(): ProvidedAveragesByPeriod {
    return structuredClone(this.provided);
  }
  news(): NewsItem[] {
    return structuredClone(this.stateNews);
  }
  canteenMenus(): CanteenMenu[] {
    return structuredClone(this.stateCanteenMenus);
  }
  canteenBalance(): CanteenBalance | null {
    return this.stateCanteenBalance === null ? null : structuredClone(this.stateCanteenBalance);
  }
  absences(): AbsenceRecord[] {
    return structuredClone(this.stateAbsences);
  }
  punishments(): Punishment[] {
    return structuredClone(this.statePunishments);
  }
  userInfo(): UserInfo | null {
    return this.stateUserInfo === null ? null : structuredClone(this.stateUserInfo);
  }
  /** `null` = capacités non déterminées (l'app garde son affichage par défaut). */
  capabilities(): Capabilities | null {
    return this.stateCapabilities === null ? null : structuredClone(this.stateCapabilities);
  }
  discussions(): Discussion[] {
    return structuredClone(this.stateDiscussions);
  }
  discussionMessages(discussionId: string): Message[] {
    // `discussionId` vient de l'URL (borne 64 caractères, pas de filtre de
    // forme) : `__proto__`/`toString` ne doivent JAMAIS résoudre via
    // Object.prototype — un fil inconnu répond `[]`, jamais une exception.
    if (!Object.hasOwn(this.stateMessages, discussionId)) return [];
    return structuredClone(this.stateMessages[discussionId] ?? []);
  }
  discussionRecipients(): Recipient[] {
    return structuredClone(this.stateRecipients);
  }
}