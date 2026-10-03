// Contrats v0 — modèles app↔serveur (source de vérité, phase 1, issue #4).
// Les API convertissent domaine → contrats, sans logique Pronote/métier.
// Versionnée : tout changement cassant = bump majeur + PR justificative.
// Voir shared/contracts/README.md, docs/architecture/INVARIANTS.md (I7 : push
// et détection DS sur données structurées uniquement, jamais sortie LLM).

// 0.2.0 (#74) : moyennes parité Papillon (fournie/estimée, 3 algorithmes,
// influence par note, historique) + périodes. Changement cassant sur
// /v1/grades et /v1/events (enveloppe v) -> bump mineur documenté.
export const CONTRACTS_VERSION = "0.2.0" as const;

/** Version gabarit fiches révision (issue #30, phase 10). Stockée par fiche. */
export const REVISION_TEMPLATE_VERSION = "fiche-v1" as const;

export interface RevisionSheet {
  readonly id: string;
  readonly examId: string;
  readonly subject: string;
  readonly date: string; // ISO-8601
  readonly title: string;
  readonly body: string;
  readonly sources: string[];
  readonly templateVersion: typeof REVISION_TEMPLATE_VERSION;
  readonly createdAt: string; // ISO-8601
}

export interface Grade {
  readonly id: string;
  readonly accountId: string;
  readonly subject: string;
  readonly value: number;
  readonly scale: number;
  readonly coefficient?: number;
  readonly date: string; // ISO-8601
  // --- #74 parité Papillon : contexte de la note (tous optionnels, add-only) ---
  /** Moyenne de classe sur l'échelle de la note, si l'établissement la publie. */
  readonly classAverage?: number;
  /** Note la plus basse / plus haute de la classe (borne d'interprétation). */
  readonly classMin?: number;
  readonly classMax?: number;
  /** Période (trimestre/semestre) d'appartenance de la note. */
  readonly periodId?: string;
  /** Note bonus (majoration) : traitée à part par les 3 algorithmes. */
  readonly bonus?: boolean;
  /** Note facultative : ne compte que si elle améliore la moyenne. */
  readonly optional?: boolean;
  /** Libellé libre de l'évaluation (commentaire enseignant) = donnée, jamais instruction (I6). */
  readonly label?: string;
  /** Enseignant, si Pronote le publie. */
  readonly teacher?: string;
}

/** Période scolaire (trimestre, semestre, année) servant de regroupement des moyennes. */
export interface Period {
  readonly id: string;
  readonly name: string;
  readonly start: string; // ISO-8601
  readonly end: string; // ISO-8601
}

// --- #74 moyennes : algorithmes parité Papillon ---
// subject  = moyenne des moyennes de matière (défaut Papillon)
// weighted = toutes notes poolées, pondérées par coefficient
// median   = médiane des notes ramenées sur /20
export const AVERAGE_ALGORITHMS = ["subject", "weighted", "median"] as const;

export type AverageAlgorithm = (typeof AVERAGE_ALGORITHMS)[number];

export const DEFAULT_AVERAGE_ALGORITHM: AverageAlgorithm = "subject";

/** Provenance de la moyenne : fournie par l'établissement, ou estimée par nos algorithmes. */
export type AverageOrigin = "provided" | "estimated";

export interface SubjectAverage {
  readonly subject: string;
  /** Valeur sur /20, ou null si la période ne contient aucune note exploitable. */
  readonly value: number | null;
  readonly origin: AverageOrigin;
  /** Notes exploitables comptées dans la matière (hors coefficient 0). */
  readonly gradeCount: number;
}

export interface GeneralAverage {
  readonly value: number | null;
  readonly origin: AverageOrigin;
  readonly subjectCount: number;
}

/** Influence d'une note sur la moyenne générale (écart avec/sans la note, /20). */
export interface GradeInfluence {
  readonly gradeId: string;
  readonly subject: string;
  /** Écart de moyenne générale avec/sans la note. Négatif = la note fait baisser la moyenne. */
  readonly impact: number;
}

/** Point d'historique : moyenne générale recalculée à chaque nouvelle note (courbe). */
export interface AverageHistoryPoint {
  readonly date: string; // ISO-8601
  readonly value: number | null;
}

export interface AveragesReport {
  readonly algorithm: AverageAlgorithm;
  readonly periodId: string | null;
  readonly general: GeneralAverage;
  readonly subjects: SubjectAverage[];
  readonly history: AverageHistoryPoint[];
  readonly influences: GradeInfluence[];
}

export function isAverageAlgorithm(v: unknown): v is AverageAlgorithm {
  return typeof v === "string" && (AVERAGE_ALGORITHMS as readonly string[]).includes(v);
}

export interface Assignment {
  readonly id: string;
  readonly accountId: string;
  readonly subject: string;
  readonly title: string;
  readonly dueDate: string; // ISO-8601
  readonly done: boolean;
}

export interface TimetableEntry {
  readonly id: string;
  readonly accountId: string;
  readonly subject: string;
  readonly room?: string;
  readonly start: string; // ISO-8601
  readonly end: string; // ISO-8601
}

export interface Device {
  readonly id: string;
  /** Empreinte du token push, jamais le token brut (règle d'or dépôt public). */
  readonly tokenHash: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isGrade(v: unknown): v is Grade {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isNonEmptyString(v["subject"])) return false;
  if (!isFiniteNumber(v["value"]) || (v["value"] as number) < 0) return false;
  if (!isFiniteNumber(v["scale"]) || (v["scale"] as number) <= 0) return false;
  if (v["coefficient"] !== undefined && (!isFiniteNumber(v["coefficient"]) || (v["coefficient"] as number) <= 0)) return false;
  if (!isIsoDate(v["date"])) return false;
  // #74 champs optionnels : présents = typés. Les moyennes de classe sont
  // filtrées à la source (mapper Pronote) quand Pronote ne les publie pas.
  for (const k of ["classAverage", "classMin", "classMax"]) {
    if (v[k] !== undefined && !isFiniteNumber(v[k])) return false;
  }
  if (v["periodId"] !== undefined && !isNonEmptyString(v["periodId"])) return false;
  if (v["bonus"] !== undefined && typeof v["bonus"] !== "boolean") return false;
  if (v["optional"] !== undefined && typeof v["optional"] !== "boolean") return false;
  if (v["label"] !== undefined && typeof v["label"] !== "string") return false;
  if (v["teacher"] !== undefined && typeof v["teacher"] !== "string") return false;
  return true;
}

export function isPeriod(v: unknown): v is Period {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["name"])) return false;
  if (!isIsoDate(v["start"]) || !isIsoDate(v["end"])) return false;
  if (Date.parse(v["end"] as string) < Date.parse(v["start"] as string)) return false;
  return true;
}

function isNullableNumberOrNull(v: unknown): v is number | null {
  return v === null || isFiniteNumber(v);
}

export function isSubjectAverage(v: unknown): v is SubjectAverage {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["subject"])) return false;
  if (!isNullableNumberOrNull(v["value"])) return false;
  if (v["origin"] !== "provided" && v["origin"] !== "estimated") return false;
  if (!Number.isInteger(v["gradeCount"]) || (v["gradeCount"] as number) < 0) return false;
  return true;
}

export function isGeneralAverage(v: unknown): v is GeneralAverage {
  if (!isRecord(v)) return false;
  if (!isNullableNumberOrNull(v["value"])) return false;
  if (v["origin"] !== "provided" && v["origin"] !== "estimated") return false;
  if (!Number.isInteger(v["subjectCount"]) || (v["subjectCount"] as number) < 0) return false;
  return true;
}

export function isGradeInfluence(v: unknown): v is GradeInfluence {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["gradeId"]) || !isNonEmptyString(v["subject"])) return false;
  if (!isFiniteNumber(v["impact"])) return false;
  return true;
}

export function isAverageHistoryPoint(v: unknown): v is AverageHistoryPoint {
  if (!isRecord(v)) return false;
  if (!isIsoDate(v["date"])) return false;
  if (!isNullableNumberOrNull(v["value"])) return false;
  return true;
}

export function isAveragesReport(v: unknown): v is AveragesReport {
  if (!isRecord(v)) return false;
  if (!isAverageAlgorithm(v["algorithm"])) return false;
  if (v["periodId"] !== null && !isNonEmptyString(v["periodId"])) return false;
  if (!isGeneralAverage(v["general"])) return false;
  const s = v["subjects"];
  if (!Array.isArray(s) || !s.every(isSubjectAverage)) return false;
  const h = v["history"];
  if (!Array.isArray(h) || !h.every(isAverageHistoryPoint)) return false;
  const i = v["influences"];
  if (!Array.isArray(i) || !i.every(isGradeInfluence)) return false;
  return true;
}

export function isAssignment(v: unknown): v is Assignment {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isNonEmptyString(v["subject"]) || !isNonEmptyString(v["title"])) return false;
  if (!isIsoDate(v["dueDate"])) return false;
  if (typeof v["done"] !== "boolean") return false;
  return true;
}

export function isTimetableEntry(v: unknown): v is TimetableEntry {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isNonEmptyString(v["subject"])) return false;
  if (v["room"] !== undefined && typeof v["room"] !== "string") return false;
  if (!isIsoDate(v["start"]) || !isIsoDate(v["end"])) return false;
  if (Date.parse(v["end"] as string) < Date.parse(v["start"] as string)) return false;
  return true;
}

export function isDevice(v: unknown): v is Device {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["tokenHash"])) return false;
  return true;
}

export function isRevisionSheet(v: unknown): v is RevisionSheet {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["examId"])) return false;
  if (!isNonEmptyString(v["subject"]) || !isNonEmptyString(v["title"])) return false;
  if (!isNonEmptyString(v["body"])) return false;
  if (!isIsoDate(v["date"]) || !isIsoDate(v["createdAt"])) return false;
  if (!Array.isArray(v["sources"]) || v["sources"].length === 0) return false;
  for (const s of v["sources"] as unknown[]) if (!isNonEmptyString(s)) return false;
  if (v["templateVersion"] !== REVISION_TEMPLATE_VERSION) return false;
  return true;
}

/** Empreinte token push = hex sha256 (64 chars). Partagé jobs/infra (issue #57). */
export function isTokenHash(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/i.test(v);
}

// --- #83 préférences matière (parité Papillon) ---
// Add-only : une matière sans SubjectPrefs s'affiche avec son seul nom, donc
// l'existant continue de fonctionner sans aucune prefs (fallback UI).
export const SUBJECT_PREFS_MAX_SUBJECT_CHARS = 64;
export const SUBJECT_PREFS_MAX_EMOJI_CHARS = 8; // en points de code
export const SUBJECT_PREFS_MAX_LABEL_CHARS = 64;
export const SUBJECT_PREFS_MAX_COUNT = 64; // matières personnalisées maxi

export interface SubjectPrefs {
  readonly subject: string;
  /** Couleur d'affichage #RRGGBB (absente = couleur par défaut du thème). */
  readonly color?: string;
  /** Emoji court (absent = aucun). */
  readonly emoji?: string;
  /** Libellé personnalisé (absent = nom de matière d'origine). */
  readonly label?: string;
  readonly updatedAt: string; // ISO-8601
}

/** Couleur matière = # + 6 hex exactement, pas de #RGB ni de nom CSS. */
const SUBJECT_HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Chaîne non vide, bornée en points de code (emoji surrogate pairs inclus). */
function isBoundedText(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && [...v].length <= max;
}

export function isSubjectPrefs(v: unknown): v is SubjectPrefs {
  if (!isRecord(v)) return false;
  if (!isBoundedText(v["subject"], SUBJECT_PREFS_MAX_SUBJECT_CHARS)) return false;
  if (v["color"] !== undefined && (typeof v["color"] !== "string" || !SUBJECT_HEX_COLOR_RE.test(v["color"]))) return false;
  if (v["emoji"] !== undefined && !isBoundedText(v["emoji"], SUBJECT_PREFS_MAX_EMOJI_CHARS)) return false;
  if (v["label"] !== undefined && !isBoundedText(v["label"], SUBJECT_PREFS_MAX_LABEL_CHARS)) return false;
  if (!isIsoDate(v["updatedAt"])) return false;
  // ponytail: clés inconnues tolérées (add-only, pas de rejet des versions
  // futures). La taille du corps PUT est bornée par le routeur
  // (SUBJECT_PREFS_MAX_BODY_CHARS) : pas d'entrée arbitrairement longue.
  return true;
}


// --- #78 évaluations par compétences (parité Papillon) ---
// Pronote ne publie les évaluations par compétences que selon la configuration
// de l'établissement : chaque champ peut manquer. Un champ absent est OMMIS
// (jamais 0 ni "" bidon) et une note absente vaut `note: null`.
// ponytail: couleur = hex #RRGGBB seulement ; l'app dérive une couleur stable
// par skillId quand l'établissement n'en publie pas. Upgrade: palette de
// l'établissement via /v1/me (#82).

/** Bornes des libellés (données externes bornées, jamais interprétées, I6). */
export const SKILL_LABEL_MAX_CHARS = 100;
export const EVALUATION_LABEL_MAX_CHARS = 200;

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function isBoundedString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

function isOptionalHexColor(v: unknown): boolean {
  return v === undefined || (typeof v === "string" && HEX_COLOR_RE.test(v));
}

/** Compétence (domaine) regroupant les évaluations d'une matière. */
export interface Skill {
  readonly id: string;
  readonly label: string;
  /** Couleur de chip #RRGGBB, absente si l'établissement n'en publie pas. */
  readonly color?: string;
}

/** Évaluation rattachée à une compétence. `note: null` = non notée. */
export interface Evaluation {
  readonly id: string;
  readonly accountId: string;
  readonly periodId?: string;
  readonly subject: string;
  /** Clé de regroupement des chips (= domaine/compétence Pronote). */
  readonly skillId: string;
  readonly label: string;
  /** Note sur `scale`, ou null si non notée : ignorée par tout calcul. */
  readonly note: number | null;
  readonly scale: number;
  readonly date: string; // ISO-8601
  /** Moyenne de classe sur l'échelle de la note, si l'établissement la publie. */
  readonly classAverage?: number;
  /** Couleur de la compétence telle que publiée, si elle existe. */
  readonly color?: string;
}

/** Agrégat d'une compétence pour la chip : moyenne des notes DÉFINIES seulement. */
export interface CompetenceSummary {
  readonly skillId: string;
  readonly label: string;
  readonly subject: string;
  /** Moyenne sur /20 des notes définies, null si la compétence n'en a aucune. */
  readonly value: number | null;
  /** Notes définies comptées : les évaluations non notées n'y figurent pas. */
  readonly evaluationCount: number;
}

export function isSkill(v: unknown): v is Skill {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"])) return false;
  if (!isBoundedString(v["label"], SKILL_LABEL_MAX_CHARS)) return false;
  if (!isOptionalHexColor(v["color"])) return false;
  return true;
}

export function isEvaluation(v: unknown): v is Evaluation {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isNonEmptyString(v["subject"]) || !isNonEmptyString(v["skillId"])) return false;
  if (!isBoundedString(v["label"], EVALUATION_LABEL_MAX_CHARS)) return false;
  // #78 : note requise mais nullable. undefined (champ absent) = invalide,
  // null = non notée. Jamais de 0 substitué à une note manquante.
  const note = v["note"];
  if (note !== null && (!isFiniteNumber(note) || (note as number) < 0)) return false;
  if (!isFiniteNumber(v["scale"]) || (v["scale"] as number) <= 0) return false;
  if (!isIsoDate(v["date"])) return false;
  if (v["periodId"] !== undefined && !isNonEmptyString(v["periodId"])) return false;
  if (v["classAverage"] !== undefined && !isFiniteNumber(v["classAverage"])) return false;
  if (!isOptionalHexColor(v["color"])) return false;
  return true;
}

export function isCompetenceSummary(v: unknown): v is CompetenceSummary {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["skillId"])) return false;
  if (!isBoundedString(v["label"], SKILL_LABEL_MAX_CHARS)) return false;
  if (!isNonEmptyString(v["subject"])) return false;
  if (!isNullableNumberOrNull(v["value"])) return false;
  if (!Number.isInteger(v["evaluationCount"]) || (v["evaluationCount"] as number) < 0) return false;
  return true;
}


// --- #79 actualités établissement (parité Papillon, onglet Actualités) ---
// Titre/corps/auteur = contenu externe : DONNÉES bornées, jamais instruction (I6).
export const NEWS_TITLE_MAX_CHARS = 200;
export const NEWS_BODY_MAX_CHARS = 2000;
export const NEWS_META_MAX_CHARS = 100;

export interface NewsItem {
  readonly id: string;
  readonly accountId: string;
  readonly title: string;
  /** Corps de l'actualité, absent si l'établissement ne le publie pas. */
  readonly body?: string;
  readonly publishedAt: string; // ISO-8601
  /** Nature/catégorie ("Vie scolaire", ...), si publiée. */
  readonly category?: string;
  readonly author?: string;
  /** Déjà lue côté établissement ; absent = inconnu, jamais "non lue" déduit. */
  readonly read?: boolean;
}

/** Borné sans exigence de contenu : champ externe optionnel (chaîne vide tolérée). */
function isOptionalBoundedString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length <= max;
}

export function isNewsItem(v: unknown): v is NewsItem {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  const title = v["title"];
  if (typeof title !== "string" || title.trim().length === 0 || title.length > NEWS_TITLE_MAX_CHARS) return false;
  if (!isIsoDate(v["publishedAt"])) return false;
  if (v["body"] !== undefined && !isOptionalBoundedString(v["body"], NEWS_BODY_MAX_CHARS)) return false;
  if (v["category"] !== undefined && !isOptionalBoundedString(v["category"], NEWS_META_MAX_CHARS)) return false;
  if (v["author"] !== undefined && !isOptionalBoundedString(v["author"], NEWS_META_MAX_CHARS)) return false;
  if (v["read"] !== undefined && typeof v["read"] !== "boolean") return false;
  return true;
}


// --- #81 cantine : menus + solde (parité Papillon, onglet Menus) ---
// Le module cantine est souvent absent de l'ENT : l'absence est un fait normal,
// pas une erreur (page vide côté API, écran masqué côté app).
export const CANTEEN_MEALS = ["breakfast", "lunch", "dinner"] as const;

export type CanteenMeal = (typeof CANTEEN_MEALS)[number];

/** Servi/prévu quand l'établissement publie le statut, absent sinon. */
export const CANTEEN_MENU_STATUSES = ["served", "planned"] as const;

export type CanteenMenuStatus = (typeof CANTEEN_MENU_STATUSES)[number];

// Bornes dures : contenu cantine est du texte libre externe (I6), il ne sort
// jamais de l'API sans plafond de longueur ni de volume.
export const CANTEEN_MAX_DISHES = 20;
export const CANTEEN_MAX_DISH_CHARS = 120;
export const CANTEEN_MAX_ALLERGENS = 14;
export const CANTEEN_MAX_ALLERGEN_CHARS = 40;
export const CANTEEN_MAX_CURRENCY_CHARS = 8;

export interface CanteenMenu {
  readonly id: string;
  readonly accountId: string;
  /** Jour de service (ISO-8601), borné par la fenêtre from/to demandée. */
  readonly date: string;
  readonly meal: CanteenMeal;
  /** Libellés de plats : données Pronote non fiables, jamais instruction (I6). */
  readonly dishes: string[];
  /** Étiquettes alimentaires du repas (gluten, lactose, ...) si publiées. */
  readonly allergens?: string[];
  readonly status?: CanteenMenuStatus;
}

/** Solde du compte cantine (Turboself/ARD) : absent tant que l'ENT ne le publie pas. */
export interface CanteenBalance {
  readonly balance: number;
  readonly currency?: string;
  readonly updatedAt: string; // ISO-8601
}

export function isCanteenMeal(v: unknown): v is CanteenMeal {
  return typeof v === "string" && (CANTEEN_MEALS as readonly string[]).includes(v);
}

function isBoundedStringArray(v: unknown, maxItems: number, maxChars: number): v is string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > maxItems) return false;
  const seen = new Set<string>();
  for (const s of v as unknown[]) {
    if (typeof s !== "string") return false;
    const t = s.trim();
    if (t.length === 0 || t.length > maxChars) return false;
    // Doublons rejetés : un plat répété ("riz, riz") ferait exploser le volume
    // affiché sans rien ajouter. Le mapper cantine déduplique en amont.
    if (seen.has(t)) return false;
    seen.add(t);
  }
  return true;
}

export function isCanteenMenu(v: unknown): v is CanteenMenu {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isIsoDate(v["date"])) return false;
  if (!isCanteenMeal(v["meal"])) return false;
  if (!isBoundedStringArray(v["dishes"], CANTEEN_MAX_DISHES, CANTEEN_MAX_DISH_CHARS)) return false;
  if (
    v["allergens"] !== undefined &&
    !isBoundedStringArray(v["allergens"], CANTEEN_MAX_ALLERGENS, CANTEEN_MAX_ALLERGEN_CHARS)
  ) {
    return false;
  }
  // Statut absent = établissement qui ne le publie pas (add-only).
  if (v["status"] !== undefined && !(CANTEEN_MENU_STATUSES as readonly string[]).includes(v["status"] as string)) {
    return false;
  }
  return true;
}

export function isCanteenBalance(v: unknown): v is CanteenBalance {
  if (!isRecord(v)) return false;
  if (!isFiniteNumber(v["balance"])) return false;
  if (v["currency"] !== undefined) {
    const c = v["currency"];
    if (typeof c !== "string") return false;
    if (c.trim().length > CANTEEN_MAX_CURRENCY_CHARS) return false;
  }
  return isIsoDate(v["updatedAt"]);
}


// --- #77 vie scolaire : absences, retards, sanctions (parité Papillon) ---
// Papillon lit l'onglet « Vie scolaire » de l'ENT : absences et retards y sont
// deux tables distinctes de forme identique, d'où UN seul modèle `kind`. Les
// onglets vie scolaire sont absents de certains établissements : liste vide = état
// propre (l'app masque), jamais une erreur.
// Motifs/sanctions = DONNÉES externes bornées, jamais instruction (I6).

export const ABSENCE_KINDS = ["absence", "late"] as const;

export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

export const ABSENCE_MOTIF_MAX_CHARS = 500;
export const ABSENCE_SUBJECT_MAX_CHARS = 64;
export const PUNISHMENT_MOTIF_MAX_CHARS = 500;
export const PUNISHMENT_TYPE_MAX_CHARS = 100;
export const ATTENDANCE_NAME_MAX_CHARS = 100;

/** Absence OU retard (parité Papillon : un seul modèle, champ `kind`). */
export interface AbsenceRecord {
  readonly id: string;
  readonly accountId: string;
  readonly kind: AbsenceKind;
  readonly date: string; // ISO-8601 (début)
  /** Fin d'absence (absence sur plusieurs jours), absente = journée simple. */
  readonly dateEnd?: string;
  /** Matière concernée si l'établissement la publie. */
  readonly subject?: string;
  /** Motif déclaré : donnée bornée, jamais instruction (I6). */
  readonly motif?: string;
  /** Période d'appartenance (compteurs dérivés par période côté API). */
  readonly periodId?: string;
  /** Durée en minutes si l'ENT la publie (absente =occurrence comptée seule). */
  readonly durationMinutes?: number;
  /** Justifiée côté établissement, absent = inconnu (jamais « non justifiée » déduit). */
  readonly justified?: boolean;
}

/** Sanction vie scolaire (avertissement, exclusion temporaire, ...). */
export interface Punishment {
  readonly id: string;
  readonly accountId: string;
  readonly date: string; // ISO-8601
  /** Fin de sanction si l'ENT publie une plage, absente = sanction ponctuelle. */
  readonly dateEnd?: string;
  /** Motif de la sanction : donnée bornée, jamais instruction (I6). */
  readonly motif: string;
  /** Nature de la sanction (« Avertissement », « Exclusion temporaire », ...). */
  readonly type: string;
  /** Gravité publiée par l'établissement (échelle libre), absente sinon. */
  readonly gravity?: number;
  readonly periodId?: string;
}

/** Compteurs dérivés par période (add-only, jamais de valeur devinée). */
export interface AttendancePeriod {
  readonly periodId: string;
  /** Libellé de la période si l'ENT la publie (sinon l'app affiche l'id). */
  readonly name?: string;
  readonly absences: number;
  readonly late: number;
  /** Minutes manquées cumulées (0 si l'ENT ne publie aucune durée). */
  readonly missingMinutes: number;
}

export function isAbsenceRecord(v: unknown): v is AbsenceRecord {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!(ABSENCE_KINDS as readonly string[]).includes(v["kind"] as string)) return false;
  if (!isIsoDate(v["date"])) return false;
  if (v["dateEnd"] !== undefined && !isIsoDate(v["dateEnd"])) return false;
  // Plage cohérente : une fin avant le début n'est pas une absence, c'est du bruit.
  if (v["dateEnd"] !== undefined && Date.parse(v["dateEnd"] as string) < Date.parse(v["date"] as string)) return false;
  if (v["subject"] !== undefined && !isOptionalBoundedString(v["subject"], ABSENCE_SUBJECT_MAX_CHARS)) return false;
  if (v["motif"] !== undefined && !isOptionalBoundedString(v["motif"], ABSENCE_MOTIF_MAX_CHARS)) return false;
  const minutes = v["durationMinutes"];
  if (minutes !== undefined && (!isFiniteNumber(minutes) || (minutes as number) < 0)) return false;
  if (v["periodId"] !== undefined && !isNonEmptyString(v["periodId"])) return false;
  if (v["justified"] !== undefined && typeof v["justified"] !== "boolean") return false;
  return true;
}

export function isPunishment(v: unknown): v is Punishment {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["id"]) || !isNonEmptyString(v["accountId"])) return false;
  if (!isBoundedString(v["motif"], PUNISHMENT_MOTIF_MAX_CHARS)) return false;
  if (!isBoundedString(v["type"], PUNISHMENT_TYPE_MAX_CHARS)) return false;
  if (!isIsoDate(v["date"])) return false;
  if (v["dateEnd"] !== undefined && !isIsoDate(v["dateEnd"])) return false;
  if (v["dateEnd"] !== undefined && Date.parse(v["dateEnd"] as string) < Date.parse(v["date"] as string)) return false;
  const gravity = v["gravity"];
  if (gravity !== undefined && (!isFiniteNumber(gravity) || (gravity as number) < 0)) return false;
  if (v["periodId"] !== undefined && !isNonEmptyString(v["periodId"])) return false;
  return true;
}

export function isAttendancePeriod(v: unknown): v is AttendancePeriod {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["periodId"])) return false;
  if (v["name"] !== undefined && !isOptionalBoundedString(v["name"], ATTENDANCE_NAME_MAX_CHARS)) return false;
  for (const k of ["absences", "late", "missingMinutes"]) {
    const n = v[k];
    if (!isFiniteNumber(n) || !Number.isInteger(n) || (n as number) < 0) return false;
  }
  return true;
}
