// Copie PARTAGÉE du consentement IA (PRV-04). Une seule liste décrit ce qui
// quitte l'appareil : l'écran et les tests lisent les mêmes mots. Aucune
// promesse de suppression chez le fournisseur : le code ne peut pas la tenir.
import type { AiConsentDecision } from "../../bridge/types";

/**
 * Miroir testé de `AI_CONSENT_VERSION` (`android/core/.../AiConsent.kt`), seule
 * source côté web. À incrémenter dans les DEUX fichiers pour un changement
 * MATÉRIEL : catégorie de données ajoutée ou retirée, destinataire ou règle de
 * conservation modifiée, usage élargi, attestation ajoutée ou modifiée. Une
 * reformulation seule ne compte pas.
 */
export const AI_CONSENT_VERSION = 3;

export const AI_CONSENT_REQUIRED_MESSAGE =
  "Consentement IA requis : lis l’aperçu, atteste l’âge ou l’autorisation parentale et accepte dans Réglages > Assistant.";

export const AI_AGE_ATTESTATION_REQUIRED =
  "Coche l’attestation d’âge ou d’autorisation parentale avant d’activer l’assistant.";

export const AI_AGE_ATTESTATION =
  "Je certifie avoir 18 ans ou plus, ou, si je suis mineur, disposer de l’autorisation de mon représentant légal et d’un compte OpenRouter géré par un adulte.";

export const AI_AGE_ATTESTATION_DETAIL =
  "L’assistant passe par OpenRouter, qui exige d’avoir au moins 18 ans. Si tu es mineur, ton représentant légal doit autoriser cet usage et gérer le compte OpenRouter : l’app ne vérifie pas ton âge et ne remplace ni cette autorisation ni les conditions d’OpenRouter. Ce texte n’a pas encore fait l’objet d’une validation juridique.";

export interface AiConsentItem {
  key: string;
  label: string;
  detail: string;
}

/** Ce qui part vers le fournisseur, catégorie par catégorie. */
export const AI_CONSENT_ITEMS: readonly AiConsentItem[] = [
  {
    key: "prompt",
    label: "Le prompt et la consigne",
    detail: "Ta question, la consigne du devoir et les instructions envoyées au modèle.",
  },
  {
    key: "notes",
    label: "Tes cours et tes notes",
    detail: "Le texte de ton cahier de cours pour la matière concernée.",
  },
  {
    key: "attachments",
    label: "Les pièces jointes",
    detail: "Le texte extrait de chaque pièce jointe ; une image jointe part comme image.",
  },
  {
    key: "photos",
    label: "Les photos que tu envoies",
    detail: "Les photos choisies sont ré-encodées en JPEG (max. 1600 px et 2 Mo) avant l’envoi.",
  },
  {
    key: "manual",
    label: "Le manuel et les pages web",
    detail: "Les extraits du manuel et des pages web que tu as ajoutés comme sources.",
  },
  {
    key: "chat",
    label: "Le fil du professeur IA",
    detail: "L’historique de tes échanges avec le professeur : questions, réponses et sources.",
  },
  {
    key: "key",
    label: "Ta clé OpenRouter",
    detail:
      "La clé part dans l’en-tête Authorization de chaque appel et paie ton compte OpenRouter ; elle n’est jamais envoyée au serveur de l’établissement.",
  },
  {
    key: "provider",
    label: "Le fournisseur",
    detail: "Les demandes vont en HTTPS à OpenRouter, qui les route vers les fournisseurs de modèles.",
  },
] as const;

export const AI_VISION_RETENTION_NOTE =
  "Photos : l’app impose à OpenRouter un endpoint ZDR sans collecte de données. Hors contenu signalé pour le contrôle CSAM ou obligation légale, le fournisseur ne les conserve pas après traitement et ne les utilise pas pour l’entraînement.";

export const AI_CONSENT_RETENTION_NOTE =
  "Les demandes texte suivent la politique d’OpenRouter et des fournisseurs qu’il route : ils peuvent conserver les demandes et les utiliser pour l’entraînement. Les photos passent par un endpoint ZDR sans collecte : hors contrôle CSAM ou obligation légale, elles ne sont pas conservées après traitement et ne servent pas à l’entraînement. L’app ne peut pas garantir la suppression chez le fournisseur.";

export const AI_CONSENT_COST_NOTE =
  "Chaque demande, photo comprise, utilise tes crédits OpenRouter et peut être facturée.";

/** Un accord n'est valide que pour la version affichée ET l'attestation recueillie. */
export function aiConsentGranted(
  decision: AiConsentDecision,
  version: number,
  ageAttested: boolean,
): boolean {
  return decision === "granted" && version === AI_CONSENT_VERSION && ageAttested;
}

/** Un accord d'une autre version ou sans attestation redemande l'accord. */
export function aiConsentNeedsReconsent(
  decision: AiConsentDecision,
  version: number,
  ageAttested: boolean,
): boolean {
  return decision === "granted" && (version !== AI_CONSENT_VERSION || !ageAttested);
}
