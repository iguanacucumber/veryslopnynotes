package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.ExpiredObject

/**
 * Échec de session : l'app doit se ré-appairer, pas afficher un état vide.
 *
 * Déplacé de `PronotePayloads.kt` (#403) : la décision du job de fond s'en
 * sert, et elle est COMPILED ET EXÉCUTÉE par le harnais de parité — un
 * fichier pur, donc compilable hors Gradle (le reste de `data` ne l'est pas :
 * il lit `org.json`).
 */
internal fun isSessionFailure(e: Throwable): Boolean {
    // G=22 (« l'objet vient d'une session précédente ») n'est PAS une session
    // morte : c'est un objet PÉRIMÉ (une période, un devoir d'avant). Le
    // message de l'établissement contient le mot « session », donc le motif
    // ci-dessous le classait « session morte » → logout + purge du cache
    // hors ligne pour un simple objet d'une session antérieure.
    // La référence TS (`pronotets`) fait l'inverse : `ExpiredObject` remonte
    // tel quel, jamais traité comme une session morte. On tranche par TYPE,
    // pas par motif : le message n'est pas la source de vérité.
    if (e is ExpiredObject) return false
    val raw = (e.message ?: "")
    // ponytail: G=25 rate-limit contient "authorization" mais n'est pas un logout.
    if (raw.contains("Exceeded max authorization", ignoreCase = true)) return false
    val msg = (raw + " " + e.javaClass.simpleName)
    return Regex("session|expir|login|auth|credential|unauthorized|\\b401\\b|mfa|\\.pin|jeton|confirmation", RegexOption.IGNORE_CASE)
        .containsMatchIn(msg)
}
