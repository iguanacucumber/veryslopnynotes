/**
 * Inventaire affiché AVANT la suppression totale. Les `id` sont ceux de
 * `AccountDataStore` (Kotlin) : la confirmation liste chaque artefact que la
 * purge orchestrée emporte, et les échecs reviennent avec ces mêmes ids.
 */
export interface DeleteAllArtifact {
  id: string;
  label: string;
  detail: string;
}

export const DELETE_ALL_ARTIFACTS: readonly DeleteAllArtifact[] = [
  {
    id: "session",
    label: "Session de l’établissement",
    detail: "Identifiants, jeton et client de session",
  },
  {
    id: "accounts",
    label: "Comptes appairés",
    detail: "Liste des comptes et compte courant",
  },
  {
    id: "cache",
    label: "Cache hors-ligne",
    detail: "Notes, devoirs, emploi du temps, messages, actualités",
  },
  {
    id: "course_notes",
    label: "Cahier de cours",
    detail: "Notes de cours enregistrées",
  },
  {
    id: "teacher_chat",
    label: "Conversations professeur",
    detail: "Fil local avec l’assistant",
  },
  {
    id: "subject_prefs",
    label: "Préférences de matières",
    detail: "Couleurs, emojis et libellés personnalisés",
  },
  {
    id: "manual",
    label: "Manuel",
    detail: "Adresse choisie, classe devinée et extraits",
  },
  {
    id: "attachments",
    label: "Pièces jointes téléchargées",
    detail: "Fichiers ouverts depuis les devoirs",
  },
  {
    id: "exports",
    label: "Exports PDF",
    detail: "Fiches de révision exportées",
  },
  {
    id: "photos",
    label: "Photos",
    detail: "Captures conservées pour les cours",
  },
  {
    id: "read_state",
    label: "État de lecture",
    detail: "Actualités marquées comme lues",
  },
  {
    id: "webview",
    label: "Données WebView",
    detail: "Cache, formulaires et historique de la coquille",
  },
  {
    id: "llm_key",
    label: "Clé de l’assistant",
    detail: "Clé OpenRouter chiffrée sur l’appareil",
  },
  {
    id: "server_url",
    label: "Serveur de manuels",
    detail: "Adresse du scraper auto-hébergé",
  },
];

/** Libellés des stores que la purge n'a pas pu effacer ; id inconnu = id brut. */
export function failedArtifactLabels(failed: readonly string[]): string[] {
  const byId = new Map(DELETE_ALL_ARTIFACTS.map((artifact) => [artifact.id, artifact.label]));
  return failed.map((id) => byId.get(id) ?? id);
}
