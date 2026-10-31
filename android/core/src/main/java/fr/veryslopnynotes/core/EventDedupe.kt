package fr.veryslopnynotes.core

/**
 * Déduplication d'événements de vie scolaire (I31).
 *
 * L'identité est le COUPLE (kind, id), JAMAIS l'identifiant seul : absences et
 * retards sont numérotés par DEUX TABLES Pronote indépendantes. La déduplication
 * ne se fait jamais par contenu.
 *
 * Logique PURE (stdlib seule) : le harnais de parité l'EXÉCUTE.
 */

/** Clé d'identité : le kind ET l'identifiant, jamais l'identifiant seul. */
fun eventKey(kind: String, id: String): String = "$kind:$id"

/** Garde le PREMIER événement de chaque clé produite par [keyOf]. */
fun <T> dedupe(events: List<T>, keyOf: (T) -> String): List<T> {
    val seen = HashSet<String>()
    return events.filter { seen.add(keyOf(it)) }
}
