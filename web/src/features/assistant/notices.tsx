// Copie PARTAGÉE de l'assistant : coût et modèle. Bornée et constante pour que
// Réglages, l'aide devoirs et le professeur disent la même chose.

/** Une demande consomme le compte OpenRouter de l'utilisateur. */
export const AI_COST_REMINDER =
  "Chaque demande utilise tes crédits OpenRouter et peut être facturée.";

/** Variante courte, posée juste avant le bouton d'envoi. */
export const AI_COST_REMINDER_SHORT = "1 appel = des crédits OpenRouter facturés.";

/** Les deux modèles sont épinglés et payants : pas de repli gratuit. */
export const AI_MODEL_NOTE =
  "Modèles épinglés (texte et vision), facturés à l'usage sur ton compte OpenRouter : s'ils disparaissent du fournisseur, l'assistant s'arrête avec un message, sans basculer vers un modèle gratuit.";

/** Message affiché quand le fournisseur a retiré le modèle épinglé. */
export const MODEL_UNAVAILABLE_MESSAGE =
  "Modèle LLM indisponible : le fournisseur l'a retiré. Mets à jour l'application.";

/** Repli explicite du chemin photo : aucun autre modèle n'est appelé. */
export const VISION_MODEL_UNAVAILABLE_MESSAGE =
  "Modèle vision indisponible : aucun autre modèle n'a été appelé. Mets à jour l'application.";

/** Miroir du message natif d'un modèle hors allowlist. */
export const MODEL_REFUSED_MESSAGE = "Modèle LLM non autorisé : configuration refusée.";

/** Longueur maximale d'une copie d'erreur affichée. */
export const AI_NOTICE_MAX_CHARS = 160;

/** Aplatit et borne un message : ni retours à la ligne, ni texte démesuré. */
export function boundedNotice(text: string, max = AI_NOTICE_MAX_CHARS): string {
  return text.replace(/\s+/g, " ").trim().slice(0, Math.max(1, max));
}

export type AiFailureKind = "model" | "key" | "quota" | "network";

export interface AiFailureNotice {
  kind: AiFailureKind;
  message: string;
}

const MODEL_FAILURE = /modèle (?:llm|vision) (indisponible|introuvable|non autorisé)/i;

/**
 * Une cause d'échec assistant -> copie affichable. Un modèle retiré ou refusé
 * reste une ERREUR : jamais une réponse vide ni un autre modèle.
 */
export function aiFailureNotice(
  code: string | undefined,
  message: string | undefined,
): AiFailureNotice {
  const clean = boundedNotice(message ?? "");
  const lower = clean.toLowerCase();
  const stable = (code ?? "").trim().toLowerCase();
  if (stable === "model" || MODEL_FAILURE.test(clean)) {
    return { kind: "model", message: clean || MODEL_UNAVAILABLE_MESSAGE };
  }
  if (stable === "key" || lower.includes("clé llm")) {
    return { kind: "key", message: clean || "Clé LLM absente : renseigne-la dans Réglages." };
  }
  if (stable === "quota" || lower.includes("quota") || lower.includes("crédits")) {
    return { kind: "quota", message: clean || "Quota LLM dépassé : réessaie plus tard." };
  }
  return { kind: "network", message: clean || "Assistant indisponible : réessaie dans un instant." };
}

export function AiCostReminder({
  short = false,
  className = "",
}: {
  short?: boolean;
  className?: string;
}) {
  return (
    <span className={`tiny muted ai-cost-reminder ${className}`.trim()} role="note">
      {short ? AI_COST_REMINDER_SHORT : AI_COST_REMINDER}
    </span>
  );
}

/** Le modèle a disparu : une alerte nommée, pas un diagnostic réseau générique. */
export function ModelUnavailableNotice({
  message = MODEL_UNAVAILABLE_MESSAGE,
  className = "",
}: {
  message?: string;
  className?: string;
}) {
  return (
    <p className={`ai-notice ai-notice--model ${className}`.trim()}>
      {boundedNotice(message) || MODEL_UNAVAILABLE_MESSAGE}
    </p>
  );
}
