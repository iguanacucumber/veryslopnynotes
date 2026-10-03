// API préférences matière v0 (issue #83, parité Papillon) : couleur, emoji,
// libellé personnalisé, upserté par matière. Magasin mémoire = seed/tests.
// Interface d'écriture SÉPARÉE de ReadStore (lecture Pronote only) : le routeur
// ne lit donc plus rien, et ni SQLite ni domaine (I3) ne sont touchés ici.
// ponytail: persistance serveur via le kv existant (StorageProvider) quand un
// déploiement multi-compte le demandera. Upgrade: migrations + upsert par compte.

import { SUBJECT_PREFS_MAX_COUNT, isSubjectPrefs } from "../../shared/contracts/models";
import type { SubjectPrefs } from "../../shared/contracts/models";

export interface SubjectPrefsStore {
  list(): SubjectPrefs[];
  upsert(prefs: SubjectPrefs): void;
}

// Seeds synthétiques : aucun secret, aucun hôte, aucun nom réel d'élève.
const SEED_PREFS: SubjectPrefs[] = [
  { subject: "Maths", color: "#1565C0", emoji: "🧮", label: "Matros", updatedAt: "2026-09-20T10:00:00.000Z" },
  { subject: "Français", emoji: "📚", updatedAt: "2026-09-20T10:00:00.000Z" },
];

export function createSubjectPrefsMemoryStore(seed: SubjectPrefs[] = SEED_PREFS): SubjectPrefsStore {
  const map = new Map<string, SubjectPrefs>();
  for (const p of seed) if (isSubjectPrefs(p)) map.set(p.subject, structuredClone(p));
  return {
    list: () => [...map.values()].map((p) => structuredClone(p)),
    upsert: (prefs: SubjectPrefs) => {
      if (!isSubjectPrefs(prefs)) throw new Error("prefs matière invalides (contrat)");
      // Borne du nombre de matières : pas de store infini via PUT répétés.
      if (!map.has(prefs.subject) && map.size >= SUBJECT_PREFS_MAX_COUNT) {
        throw new Error("trop de matières personnalisées");
      }
      map.set(prefs.subject, structuredClone(prefs));
    },
  };
}
