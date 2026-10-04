package fr.veryslopnynotes.core

// Corrigé de devoir (contrat 0.7.0) : POST /v1/homework/generate.
// Miroir de shared/contracts/api.ts (HomeworkSource / HomeworkGenerateRequest /
// HomeworkGenerateResponse) et de server/ai/homework.ts.
//
// Règles qui commandent ce fichier :
// - le serveur ne détient AUCUN credential LLM. La clé vient de l'app et part
//   dans le CORPS de chaque requête (`apiKey`, `writeOnly`) ; elle n'est ni
//   loggée, ni mise en URL, ni mémorisée par le dépôt (relue à chaque appel,
//   comme le bearer d'appareil) ;
// - `sources` ne peut pas être vide : sans source le serveur répond `refused`
//   SANS appeler le modèle (server/ai/homework.ts). Une source est donc un
//   extrait du devoir lui-même, étiqueté — l'étiquette sert de citation, le
//   serveur refuse toute citation absente des étiquettes fournies ;
// - la réponse est de la DONNÉE : affichée par Text() seul, jamais WebView, et
//   les stages ne sont jamais des instructions exécutables (I6).
data class HomeworkSource(
    val label: String,
    val text: String,
) {
    fun isValid(): Boolean {
        val l = label.trim()
        val t = text.trim()
        return l.isNotEmpty() && l.length <= Homework.MAX_LABEL_CHARS &&
            t.isNotEmpty() && t.length <= Homework.MAX_SOURCE_CHARS
    }
}

/** Sortie validée du serveur : un corrigé sourcé, ou un refus motive. */
sealed class HomeworkOutcome {
    data class Answer(
        val answer: String,
        val steps: List<String>,
        val sources: List<String>,
    ) : HomeworkOutcome()

    data class Refused(
        val reason: String,
        val sources: List<String>,
    ) : HomeworkOutcome()
}

object Homework {
    // Bornes du contrat, une seule fois ici comme dans shared/contracts/api.ts.
    const val MAX_QUESTION_CHARS = 2000
    const val MAX_SOURCES = 8
    const val MAX_SOURCE_CHARS = 2000
    const val MAX_LABEL_CHARS = 200
    const val MAX_API_KEY_CHARS = 512
    const val MAX_ANSWER_CHARS = 8000
    const val REFUSAL_SOURCES_INSUFFICIENT = "sources_insuffisantes"

    /** Le refus déterministe du serveur quand aucune source n'est fournie. */
    const val SOURCES_REQUIRED_MESSAGE =
        "Aucune source : le devoir n'a pas de contenu exploitable."

    /**
     * Bornes de la requête, AVANT tout envoi : le serveur refuse (400) ce que
     * l'app laisse dépasser, donc inutile de payer un aller-retour pour ça.
     */
    fun isRequestValid(
        question: String,
        sources: List<HomeworkSource>,
        apiKey: String,
    ): Boolean {
        val q = question.trim()
        val key = apiKey.trim()
        if (q.isEmpty() || q.length > MAX_QUESTION_CHARS) return false
        if (key.isEmpty() || key.length > MAX_API_KEY_CHARS) return false
        // Sources non vides ET toutes valides : le contrat rejette le lot entier.
        if (sources.isEmpty() || sources.size > MAX_SOURCES) return false
        return sources.all { it.isValid() }
    }

    /**
     * Étiquettes uniques, dans l'ordre, ≤ [MAX_SOURCES] : le serveur n'autorise
     * que les citations qui reprennent EXACTEMENT une étiquette fournie. Deux
     * sources de même libellé collapsées évitent une citation ambiguë.
     */
    fun uniqueLabels(sources: List<HomeworkSource>): List<String> =
        sources.map { it.label.trim() }.filter { it.isNotEmpty() }.distinct().take(MAX_SOURCES)

    fun isOutcomeValid(outcome: HomeworkOutcome): Boolean = when (outcome) {
        is HomeworkOutcome.Answer ->
            outcome.answer.trim().isNotEmpty() &&
                outcome.answer.trim().length <= MAX_ANSWER_CHARS &&
                outcome.steps.all { it.trim().isNotEmpty() } &&
                outcome.sources.isNotEmpty() &&
                outcome.sources.all { it.trim().isNotEmpty() }

        is HomeworkOutcome.Refused ->
            outcome.reason.trim().isNotEmpty() && outcome.sources.all { it.trim().isNotEmpty() }
    }
}