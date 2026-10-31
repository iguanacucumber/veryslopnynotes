package fr.veryslopnynotes.core

// Transcription d'une photo de cours en texte.
//
// Consigne FIXE : le modèle transcrit, ne complète pas, répond en JSON. Une
// réponse mal formée est refusée (I5), jamais réinterprétée en texte vide (I14).

const val SYSTEM_LESSON_TRANSCRIBE =
    "Tu transcris le cours photographié. Utilise uniquement l'image fournie. " +
        "Ne complète pas, n'invente pas, ne reformule pas la méthode du professeur. " +
        "Si une partie est illisible, indique-le dans le texte au lieu de la deviner. " +
        "Reponds UNIQUEMENT en JSON valide, sans texte autour : " +
        "{\"title\":string,\"text\":string}. " +
        "Le titre est court (chapitre, thème). Le texte garde les formules, les notations et les exemples."

data class LessonDraft(
    val title: String,
    val text: String,
)

fun parseLessonDraft(raw: JsonValue): LessonDraft {
    val obj = raw as? JsonValue.Obj ?: throw AiError("réponse de transcription invalide (schéma)")
    val text = jsonStrOf(obj, "text")?.trim().orEmpty()
    if (text.isEmpty()) throw AiError("réponse de transcription invalide (schéma)")
    if (text.length > LessonNote.MAX_TEXT_CHARS) throw OutputTooLongException(LessonNote.MAX_TEXT_CHARS)
    val title = jsonStrOf(obj, "title")?.trim().orEmpty()
        .ifEmpty { "Cours photographié" }
        .take(LessonNote.MAX_TITLE_CHARS)
    return LessonDraft(title = title, text = text)
}

/** Transcrit une photo de cours. Aucun effet métier : le pont décide de l'enregistrement. */
fun transcribeLesson(
    provider: SafeVisionPromptProvider,
    image: VisionImage,
    apiKey: String?,
    nonce: String? = null,
): LessonDraft {
    val data = listOf(markExternal("Photo de cours ci-jointe : transcris-la fidèlement."))
    val raw = generateGuardedVisionJson(
        provider = provider,
        system = SYSTEM_LESSON_TRANSCRIBE,
        data = data,
        image = image,
        nonce = nonce,
        apiKey = apiKey,
    )
    return parseLessonDraft(raw)
}
