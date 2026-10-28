package fr.veryslopnynotes.core

// Humanize devoirs : VALIDATE -> RENDER avec gabarit versionne.
// Port fidele de server/ai/humanize.ts (supprimé en #210 : ce port est la
// source de vérité). Contenu = donnee, jamais instruction
// (I6/I7) : RENDER pur, sans eval, sans execution du contenu, sans
// reseau/outils/secrets (I4/I5). Version gabarit stockee par corrige ->
// reproductibilite. Stdlib uniquement (serialisation via LlmGuard, pas d'org.json
// pour rester compilable avec kotlinc seul dans le harnais de parite).

// ponytail: version en constante, jamais depuis externe. Upgrade: registre v2 si gabarit evolue.
const val HUMANIZE_TEMPLATE_VERSION = "humanize-v1"
val HUMANIZE_TEMPLATE_HISTORY: List<String> = listOf(HUMANIZE_TEMPLATE_VERSION)

const val MAX_ANSWER_KEY_CHARS = 8000
private const val MAX_SOURCES = 20
private const val MAX_SOURCE_CHARS = 500

data class ValidatedAnswerKey(
    val answer: String,
    val sources: List<String>,
)

data class RenderedAnswerKey(
    val text: String,
    val templateVersion: String,
)

// Stockage cle-valeur des corriges rendus (le TS prend un StorageProvider du
// domaine : meme forme, octets UTF-8, cle bornee). Jeteurs synchrones : l'appelant
// file sur disque hors thread UI.
interface AnswerKeyStore {
    fun set(key: String, value: ByteArray)
    fun get(key: String): ByteArray?
}

private fun isNonEmptyString(v: String): Boolean = v.trim().isNotEmpty()

object Humanize {
    // VALIDATE : JSON deja parse -> corrige type. Rejette vide/trop long/sources invalides.
    // Refus propre : l'appelant refuse avant si sources insuffisantes ; ici sources
    // vides autorisees (rendu "aucune") pour rester pur et reproductible.
    fun validateAnswerKeyForRender(input: JsonValue): ValidatedAnswerKey {
        val obj = input as? JsonValue.Obj ?: throw AiError("corrigé invalide (VALIDATE)")
        val answer = jsonStrOf(obj, "answer")
            ?: throw AiError("corrigé invalide : answer vide (VALIDATE)")
        if (!isNonEmptyString(answer)) throw AiError("corrigé invalide : answer vide (VALIDATE)")
        if (answer.length > MAX_ANSWER_KEY_CHARS) throw AiError("corrigé trop long (VALIDATE)")
        val rawSources = obj.fields["sources"]
        val src: List<JsonValue> = when (rawSources) {
            // Champ ABSENT = corpus vide : autorisé (rendu "aucune").
            null -> emptyList()
            is JsonValue.Arr -> rawSources.items
            // Champ présent mais MAL FORMÉ (chaîne, nombre, objet, null) : on
            // REFUSE (#413). Avant, ce cas devenait une liste vide — la source
            // invalide était confondue avec « aucune source », et le texte
            // était présenté comme un corrigé validé, sans sources.
            else -> throw AiError("corrigé invalide : sources (VALIDATE)")
        }
        if (src.size > MAX_SOURCES) throw AiError("corrigé invalide : trop de sources (VALIDATE)")
        val clean = ArrayList<String>(src.size)
        for (s in src) {
            val str = (s as? JsonValue.Str)?.value
                ?: throw AiError("corrigé invalide : source vide (VALIDATE)")
            if (!isNonEmptyString(str)) throw AiError("corrigé invalide : source vide (VALIDATE)")
            if (str.length > MAX_SOURCE_CHARS) throw AiError("corrigé invalide : source trop longue (VALIDATE)")
            clean.add(str.trim())
        }
        return ValidatedAnswerKey(answer = answer.trim(), sources = clean)
    }

    // I6 : corrige valide re-marque donnee avant tout usage IA/affichage.
    // Utilise buildSafePrompt cote appelant ; ici marquage seul (Untrusted).
    fun markAnswerKeyForHumanize(answerKey: ValidatedAnswerKey): List<Untrusted<String>> {
        return listOf(markExternal(answerKey.answer)) + answerKey.sources.map { markExternal(it) }
    }

    // RENDER pur (I7) : gabarit fixe, contenu insere litteralement.
    // Aucune interpolation du contenu comme gabarit : answer/sources ne sont
    // jamais evalues. Consommateur doit afficher text comme texte brut,
    // jamais comme HTML/code.
    private fun renderV1(answerKey: ValidatedAnswerKey): String {
        val head = "Corrigé (gabarit humanize-v1)"
        val srcBlock = if (answerKey.sources.isEmpty()) {
            "Sources : aucune (corpus vide)."
        } else {
            "Sources :\n" + answerKey.sources.joinToString("\n") { "- " + it }
        }
        return head + "\n\n" + answerKey.answer + "\n\n" + srcBlock
    }

    fun listTemplateVersions(): List<String> = HUMANIZE_TEMPLATE_HISTORY.toList()

    // templateVersion omis = courant. Version inconnue = rejet (reproductibilite stricte).
    // Meme entree + meme version = meme sortie (deterministe, sans aleatoire/date).
    fun renderAnswerKey(
        answerKey: ValidatedAnswerKey,
        templateVersion: String = HUMANIZE_TEMPLATE_VERSION,
    ): RenderedAnswerKey {
        if (templateVersion != HUMANIZE_TEMPLATE_VERSION) {
            throw AiError("gabarit inconnu : " + templateVersion)
        }
        return RenderedAnswerKey(text = renderV1(answerKey), templateVersion = templateVersion)
    }

    // VALIDATE -> RENDER en un appel (entree = JSON parse, ex. sortie GENERATE).
    fun humanizeAnswerKey(input: JsonValue, templateVersion: String = HUMANIZE_TEMPLATE_VERSION): RenderedAnswerKey {
        return renderAnswerKey(validateAnswerKeyForRender(input), templateVersion)
    }

    // Version stockee par corrige : JSON {text, templateVersion}, octets UTF-8.
    fun saveRenderedAnswerKey(store: AnswerKeyStore, id: String, rendered: RenderedAnswerKey): String {
        if (!isNonEmptyString(rendered.text)) throw AiError("rendu vide")
        if (rendered.templateVersion != HUMANIZE_TEMPLATE_VERSION) {
            throw AiError("gabarit inconnu : " + rendered.templateVersion)
        }
        val fields = LinkedHashMap<String, JsonValue>()
        fields["text"] = JsonValue.Str(rendered.text)
        fields["templateVersion"] = JsonValue.Str(rendered.templateVersion)
        val key = answerKeyStorageKey(id)
        store.set(key, stringifyJson(JsonValue.Obj(fields)).toByteArray(Charsets.UTF_8))
        return key
    }

    fun loadRenderedAnswerKey(store: AnswerKeyStore, id: String): RenderedAnswerKey? {
        val raw = store.get(answerKeyStorageKey(id)) ?: store.get(legacyAnswerKeyStorageKey(id)) ?: return null
        try {
            val v = parseJsonValue(raw.toString(Charsets.UTF_8))
            if (v !is JsonValue.Obj) return null
            val text = jsonStrOf(v, "text")
            val version = jsonStrOf(v, "templateVersion")
            if (text == null || !isNonEmptyString(text)) return null
            if (version == null) return null
            if (version != HUMANIZE_TEMPLATE_VERSION) return null
            return RenderedAnswerKey(text = text, templateVersion = version)
        } catch (e: AiError) {
            return null
        }
    }

    private fun answerKeyStorageKey(id: String): String = checkedAnswerKeyId(id).let { "homework:answer-key:" + it }

    /** Pre-rename key: still read, never written again. */
    private fun legacyAnswerKeyStorageKey(id: String): String = "homework:corrige:" + checkedAnswerKeyId(id)

    private fun checkedAnswerKeyId(id: String): String {
        if (!isNonEmptyString(id) || id.length > 200 || id.any { it.isWhitespace() }) {
            throw AiError("id corrigé invalide")
        }
        return id.trim()
    }
}
