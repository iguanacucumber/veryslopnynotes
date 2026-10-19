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

const val MAX_CORRIGE_CHARS = 8000
private const val MAX_SOURCES = 20
private const val MAX_SOURCE_CHARS = 500

data class ValidatedCorrige(
    val answer: String,
    val sources: List<String>,
)

data class RenderedCorrige(
    val text: String,
    val templateVersion: String,
)

// Stockage cle-valeur des corriges rendus (le TS prend un StorageProvider du
// domaine : meme forme, octets UTF-8, cle bornee). Jeteurs synchrones : l'appelant
// file sur disque hors thread UI.
interface CorrigeStore {
    fun set(key: String, value: ByteArray)
    fun get(key: String): ByteArray?
}

private fun isNonEmptyString(v: String): Boolean = v.trim().isNotEmpty()

object Humanize {
    // VALIDATE : JSON deja parse -> corrige type. Rejette vide/trop long/sources invalides.
    // Refus propre : l'appelant refuse avant si sources insuffisantes ; ici sources
    // vides autorisees (rendu "aucune") pour rester pur et reproductible.
    fun validateCorrigeForRender(input: JsonValue): ValidatedCorrige {
        val obj = input as? JsonValue.Obj ?: throw AiError("corrigé invalide (VALIDATE)")
        val answer = jsonStrOf(obj, "answer")
            ?: throw AiError("corrigé invalide : answer vide (VALIDATE)")
        if (!isNonEmptyString(answer)) throw AiError("corrigé invalide : answer vide (VALIDATE)")
        if (answer.length > MAX_CORRIGE_CHARS) throw AiError("corrigé trop long (VALIDATE)")
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
        return ValidatedCorrige(answer = answer.trim(), sources = clean)
    }

    // I6 : corrige valide re-marque donnee avant tout usage IA/affichage.
    // Utilise buildSafePrompt cote appelant ; ici marquage seul (Untrusted).
    fun markCorrigeForHumanize(corrige: ValidatedCorrige): List<Untrusted<String>> {
        return listOf(markExternal(corrige.answer)) + corrige.sources.map { markExternal(it) }
    }

    // RENDER pur (I7) : gabarit fixe, contenu insere litteralement.
    // Aucune interpolation du contenu comme gabarit : answer/sources ne sont
    // jamais evalues. Consommateur doit afficher text comme texte brut,
    // jamais comme HTML/code.
    private fun renderV1(corrige: ValidatedCorrige): String {
        val head = "Corrigé (gabarit humanize-v1)"
        val srcBlock = if (corrige.sources.isEmpty()) {
            "Sources : aucune (corpus vide)."
        } else {
            "Sources :\n" + corrige.sources.joinToString("\n") { "- " + it }
        }
        return head + "\n\n" + corrige.answer + "\n\n" + srcBlock
    }

    fun listTemplateVersions(): List<String> = HUMANIZE_TEMPLATE_HISTORY.toList()

    // templateVersion omis = courant. Version inconnue = rejet (reproductibilite stricte).
    // Meme entree + meme version = meme sortie (deterministe, sans aleatoire/date).
    fun renderCorrige(
        corrige: ValidatedCorrige,
        templateVersion: String = HUMANIZE_TEMPLATE_VERSION,
    ): RenderedCorrige {
        if (templateVersion != HUMANIZE_TEMPLATE_VERSION) {
            throw AiError("gabarit inconnu : " + templateVersion)
        }
        return RenderedCorrige(text = renderV1(corrige), templateVersion = templateVersion)
    }

    // VALIDATE -> RENDER en un appel (entree = JSON parse, ex. sortie GENERATE).
    fun humanizeCorrige(input: JsonValue, templateVersion: String = HUMANIZE_TEMPLATE_VERSION): RenderedCorrige {
        return renderCorrige(validateCorrigeForRender(input), templateVersion)
    }

    // Version stockee par corrige : JSON {text, templateVersion}, octets UTF-8.
    fun saveRenderedCorrige(store: CorrigeStore, id: String, rendered: RenderedCorrige) {
        if (!isNonEmptyString(rendered.text)) throw AiError("rendu vide")
        if (rendered.templateVersion != HUMANIZE_TEMPLATE_VERSION) {
            throw AiError("gabarit inconnu : " + rendered.templateVersion)
        }
        val fields = LinkedHashMap<String, JsonValue>()
        fields["text"] = JsonValue.Str(rendered.text)
        fields["templateVersion"] = JsonValue.Str(rendered.templateVersion)
        store.set(corrigeKey(id), stringifyJson(JsonValue.Obj(fields)).toByteArray(Charsets.UTF_8))
    }

    fun loadRenderedCorrige(store: CorrigeStore, id: String): RenderedCorrige? {
        val raw = store.get(corrigeKey(id)) ?: return null
        try {
            val v = parseJsonValue(raw.toString(Charsets.UTF_8))
            if (v !is JsonValue.Obj) return null
            val text = jsonStrOf(v, "text")
            val version = jsonStrOf(v, "templateVersion")
            if (text == null || !isNonEmptyString(text)) return null
            if (version == null) return null
            if (version != HUMANIZE_TEMPLATE_VERSION) return null
            return RenderedCorrige(text = text, templateVersion = version)
        } catch (e: AiError) {
            return null
        }
    }

    private fun corrigeKey(id: String): String {
        if (!isNonEmptyString(id) || id.length > 200 || id.any { it.isWhitespace() }) {
            throw AiError("id corrigé invalide")
        }
        return "homework:corrige:" + id.trim()
    }
}
