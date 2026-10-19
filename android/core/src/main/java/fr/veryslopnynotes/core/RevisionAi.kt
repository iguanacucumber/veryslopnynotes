package fr.veryslopnynotes.core

// Fiches revision — pipeline phase 6/9.
// Port fidele de server/ai/revision.ts (supprimé en #210 : ce port est la
// source de vérité). Contenu externe = Untrusted + nonce,
// declare donnee (I6). Sans outils, sans reseau, sans secrets (I4/I5).
// Declenchement = structure cote jobs (I7) ; ici seul remplissage valide.
// Sortie modele = JSON {fiche} valide, sources citees cote jobs.
// Les appels provider sont BLOQUANTS : jamais sur le thread UI.

// Candidat examen : champs utilises par buildRevisionDocs cote TS
// (ExamCandidate d'ExamDetect.kt : source/confiance hors perimetre IA).
data class RevisionExam(
    val id: String,
    val subject: String,
    val date: String,
    val matched: String,
)

data class RevisionChunk(
    val text: String,
    val source: String,
)

private fun isNonEmpty(v: String): Boolean = v.trim().isNotEmpty()

fun isRevisionAnswer(v: JsonValue): Boolean {
    val fiche = jsonStrOf(v, "fiche") ?: return false
    return isNonEmpty(fiche) && fiche.length <= MAX_OUTPUT_CHARS
}

fun parseRevisionAnswer(v: JsonValue): String {
    if (!isRevisionAnswer(v)) throw AiError("fiche JSON invalide (I5)")
    val t = (jsonStrOf(v, "fiche") ?: throw AiError("fiche JSON invalide (I5)")).trim()
    if (t.isEmpty()) throw AiError("fiche vide (I5)")
    return t
}

// Cause d'un echec de generation, vue par l'UI. Jamais le message brut de
// l'exception : il peut nommer un compte, un hote ou une cle.
enum class RevisionFailure {
    FORMAT,   // sortie non conforme au schema {"fiche"} (I5)
    KEY,      // cle LLM absente, trop courte ou refusee
    QUOTA,    // quota fournisseur atteint
    PROVIDER, // le fournisseur n'a pas repondu (reseau, sortie vide, tronquee)
    UNKNOWN,  // autre cause
}

// Message utilisateur : francais, borne, sans secret. La cause, elle, reste
// explicite — « Fiche non generee » ne disait rien de l'echec (#367).
fun revisionFailureMessage(failure: RevisionFailure): String = when (failure) {
    RevisionFailure.FORMAT -> "Le modèle n'a pas renvoyé le format attendu (JSON {\"fiche\"})."
    RevisionFailure.KEY -> "Clé LLM absente ou refusée : renseigne-la dans Réglages."
    RevisionFailure.QUOTA -> "Quota LLM atteint : réessaie plus tard."
    RevisionFailure.PROVIDER -> "Le fournisseur LLM n'a pas répondu."
    RevisionFailure.UNKNOWN -> "Échec de la génération de la fiche."
}

object RevisionAi {
    // Docs brutes -> marquees Untrusted ici, nonce cote prompt.
    fun buildRevisionDocs(exam: RevisionExam, chunks: List<RevisionChunk>): List<String> {
        val head = "Matiere : " + exam.subject + "\nDate : " + exam.date +
            "\nMotif : " + exam.matched + "\nId examen : " + exam.id
        val bodies = chunks.map { it.source + "\n" + it.text }
        return listOf(head) + bodies
    }

    fun revisionPromptFor(exam: RevisionExam, chunks: List<RevisionChunk>, nonce: String? = null): SafePrompt {
        // ponytail: reutilise gabarit phase 6, jamais de consigne ad hoc.
        val docs = buildRevisionDocs(exam, chunks)
        return buildRevisionPrompt(docs, nonce)
    }

    // Remplissage seul : appel modele JSON valide. Choix push = jobs (structure).
    fun requestRevisionFiche(
        provider: LlmProvider,
        exam: RevisionExam,
        chunks: List<RevisionChunk>,
        nonce: String? = null,
    ): String {
        val docs = buildRevisionDocs(exam, chunks)
        val data: List<Untrusted<String>> = docs.map { markExternal(it) }
        val parsed = generateGuardedJson(provider, SYSTEM_REVISION_JSON, data, nonce)
        return parseRevisionAnswer(parsed)
    }
}
