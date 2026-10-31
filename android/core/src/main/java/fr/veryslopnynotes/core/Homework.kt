package fr.veryslopnynotes.core

// Corrigé de devoir : génération sur l'appareil. Miroir de shared/contracts/api.ts
// (HomeworkGenerateResponse).
//
// Règles qui commandent ce fichier :
// - le dépôt ne détient AUCUN credential LLM. La clé vient du store chiffré et
//   part dans le CORPS de chaque requête ; elle n'est ni loggée, ni mise en URL,
//   ni mémorisée (relue à chaque appel) ;
// - `sources` ne peut pas être vide : sans source la génération répond `refused`
//   SANS appeler le modèle. Une source est un extrait du devoir lui-même,
//   étiqueté ; toute citation absente des étiquettes fournies est refusée ;
// - la réponse est de la DONNÉE, affichée par Text() seul (I6).
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

    /**
     * Budget de l'enveloppe JSON autour du corrigé (clés, échappements, étapes,
     * sources) : le corrigé ne peut pas occuper TOUTE la sortie.
     */
    const val JSON_ENVELOPE_RESERVE_CHARS = 4000

    /**
     * Le corrigé : le plafond I5 [MAX_OUTPUT_CHARS] moins l'enveloppe JSON.
     * Dérivé, jamais recopié.
     */
    const val MAX_ANSWER_CHARS = MAX_OUTPUT_CHARS - JSON_ENVELOPE_RESERVE_CHARS

    /**
     * Affichage d'un corrigé : miroir de `HOMEWORK_MAX_STEPS` /
     * `HOMEWORK_MAX_STEP_CHARS`. Bornes de RENDU : le pont tronque pour l'UI,
     * il ne jette pas un corrigé valide.
     */
    const val MAX_STEPS = 12
    const val MAX_STEP_CHARS = 400
    const val REFUSAL_SOURCES_INSUFFICIENT = "sources_insuffisantes"

    const val SOURCES_REQUIRED_MESSAGE =
        "Aucune source : le devoir n'a pas de contenu exploitable."

    /**
     * Bornes de la requête, AVANT tout envoi : le serveur refuse (400) ce que
     * l'app laisse dépasser.
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
     * Étiquettes uniques, dans l'ordre, ≤ [MAX_SOURCES] : seules les citations
     * reprenant EXACTEMENT une étiquette fournie sont autorisées.
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