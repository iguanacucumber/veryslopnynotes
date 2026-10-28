package fr.veryslopnynotes.core

/**
 * Déduplication d'événements de vie scolaire (#570, I31).
 *
 * L'identité d'un événement est le COUPLE (kind, id), JAMAIS l'identifiant
 * seul : les absences et les retards sont numérotés par DEUX TABLEES Pronote
 * indépendantes, donc une absence `12` et un retard `12` sont deux événements
 * distincts. La déduplication ne se fait jamais par contenu.
 *
 * Logique PURE (stdlib seule, ni `org.json` ni Android) : le harnais de parité
 * l'EXÉCUTE, au lieu de lire la forme de la source qui la consomme.
 */

/** Clé d'identité : le kind ET l'identifiant, jamais l'identifiant seul. */
fun eventKey(kind: String, id: String): String = "$kind:$id"

/**
 * Écarte les doublons en gardant le PREMIER événement de chaque clé.
 * [keyOf] produit la clé d'identité (voir [eventKey]).
 */
fun <T> dedupe(events: List<T>, keyOf: (T) -> String): List<T> {
    val seen = HashSet<String>()
    return events.filter { seen.add(keyOf(it)) }
}
