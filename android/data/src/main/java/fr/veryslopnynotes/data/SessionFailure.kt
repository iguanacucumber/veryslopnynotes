package fr.veryslopnynotes.data

/**
 * Échec de session : l'app doit se ré-appairer, pas afficher un état vide.
 *
 * Déplacé de `PronotePayloads.kt` (#403) : la décision du job de fond s'en
 * sert, et elle est COMPILED ET EXÉCUTÉE par le harnais de parité — un
 * fichier pur, donc compilable hors Gradle (le reste de `data` ne l'est pas :
 * il lit `org.json`).
 */
internal fun isSessionFailure(e: Throwable): Boolean {
    val raw = (e.message ?: "")
    // ponytail: G=25 rate-limit contient "authorization" mais n'est pas un logout.
    if (raw.contains("Exceeded max authorization", ignoreCase = true)) return false
    val msg = (raw + " " + e.javaClass.simpleName)
    return Regex("session|expir|login|auth|credential|unauthorized|\\b401\\b|mfa|\\.pin|jeton|confirmation", RegexOption.IGNORE_CASE)
        .containsMatchIn(msg)
}
