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

/**
 * Clé d'une prefs matière : casse et espaces internes indifférents. Sans ça,
 * « Maths » et « maths » deviennent DEUX entrées (le PUT ne remplace plus,
 * deux chips pour une matière) et le garde-fou SUBJECT_PREFS_MAX_COUNT est
 * contournable de la même façon. La valeur stockée reste celle du dernier PUT
 * (le libellé affiché est celui de l'app).
 */
function prefsKey(subject: string): string {
  return subject.trim().replace(/\s+/g, " ").toLowerCase();
}

export function createSubjectPrefsMemoryStore(seed: SubjectPrefs[] = SEED_PREFS): SubjectPrefsStore {
  const map = new Map<string, SubjectPrefs>();
  for (const p of seed) if (isSubjectPrefs(p)) map.set(prefsKey(p.subject), structuredClone(p));
  return {
    list: () => [...map.values()].map((p) => structuredClone(p)),
    upsert: (prefs: SubjectPrefs) => {
      if (!isSubjectPrefs(prefs)) throw new Error("prefs matière invalides (contrat)");
      const key = prefsKey(prefs.subject);
      // Borne du nombre de matières : pas de store infini via PUT répétés.
      if (!map.has(key) && map.size >= SUBJECT_PREFS_MAX_COUNT) {
        throw new Error("trop de matières personnalisées");
      }
      map.set(key, structuredClone(prefs));
    },
  };
}
