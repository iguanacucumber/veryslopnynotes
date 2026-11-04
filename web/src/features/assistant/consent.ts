// Copie PARTAGÉE du consentement IA (PRV-04). Une seule liste décrit ce qui
// quitte l'appareil : l'écran et les tests lisent les mêmes mots. Aucune
// promesse de suppression chez le fournisseur : le code ne peut pas la tenir.
import type { AiConsentDecision } from "../../bridge/types";

/** Miroir de `AI_CONSENT_VERSION` (`android/core/.../AiConsent.kt`). */
export const AI_CONSENT_VERSION = 1;

export const AI_CONSENT_REQUIRED_MESSAGE =
  "Consentement IA requis : lis l’aperçu des données et accepte dans Réglages > Assistant.";

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

export const AI_CONSENT_RETENTION_NOTE =
  "OpenRouter et les fournisseurs de modèles qu’il route peuvent conserver les demandes selon leurs propres politiques. L’app ne peut garantir ni leur suppression, ni l’absence d’entraînement : consulte leurs conditions avant d’accepter.";

export const AI_CONSENT_COST_NOTE =
  "Chaque demande utilise tes crédits OpenRouter et peut être facturée.";

/** Un accord n'est valide que pour la version de texte affichée. */
export function aiConsentGranted(decision: AiConsentDecision, version: number): boolean {
  return decision === "granted" && version === AI_CONSENT_VERSION;
}
