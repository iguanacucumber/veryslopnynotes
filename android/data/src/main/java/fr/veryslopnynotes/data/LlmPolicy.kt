package fr.veryslopnynotes.data

// Politique du client LLM : modèles ÉPINGLÉS, messages BORNÉS, clé INVISIBLE.
// Fichier `java.*` SEUL (ni OkHttp, ni `org.json`) : la parité le compile et
// l'EXÉCUTE hors Gradle, donc ces règles sont prouvées sur du code réel.
// Le protocole (URL, Bearer, statuts, reprise) reste dans `OpenRouterLlm.kt`.

/**
 * Modèles AUTORISÉS par le client, épinglés dans le code (pas un credential,
 * donc pas d'env).
 *
 * Un identifiant hors de cette liste est REFUSÉ à la construction : jamais un
 * repli silencieux vers le défaut, qui dépenserait la clé de l'utilisateur
 * sur un modèle qu'il n'a pas choisi. `google/gemini-2.5-flash` est retenu pour
 * la fiabilité du calcul (les modèles gratuits rendaient un résultat faux une
 * fois sur deux sur le même DM) ; le vision est DISTINCT car le modèle texte
 * n'est pas garanti multimodal (`dots-studio` répond, contrairement à l'ancien
 * `google/gemma-4-31b-it:free`, en 429 amont).
 */
const val PINNED_TEXT_MODEL = "google/gemini-2.5-flash"
const val PINNED_VISION_MODEL = "dots-studio/dots-3-note-preview:free"

val LLM_ALLOWED_MODELS: Set<String> = setOf(PINNED_TEXT_MODEL, PINNED_VISION_MODEL)

/** Égalité STRICTE (casse comprise) : aucune normalisation implicite. */
fun isAllowedModel(model: String): Boolean = model in LLM_ALLOWED_MODELS

/** Refus d'un modèle hors allowlist : configuration refusée, aucun repli. */
const val MODEL_REFUSED_MESSAGE = "Modèle LLM non autorisé : configuration refusée."

/** Annulation explicite par l'appelant : aucun envoi, aucune reprise. */
const val CANCELLED_MESSAGE = "Appel LLM annulé."

/** Longueur maximale d'un message affichable ou journalisable. */
const val MAX_ERROR_CHARS = 120

/** Longueur minimale d'une clé plausible : en deçà, aucun appel. */
const val LLM_MIN_API_KEY_CHARS = 8

/** Texte de remplacement d'une clé retirée : stable, jamais la valeur. */
const val REDACTED_KEY = "[clé]"

/**
 * Message borné : retours à la ligne et tabulations écrasés (une erreur ne
 * fabrique pas de fausses lignes de journal), longueur plafonnée.
 */
fun boundedMessage(text: String, max: Int = MAX_ERROR_CHARS): String {
    require(max > 0) { "max doit etre positif" }
    val single = text.replace(Regex("[\\r\\n\\t]+"), " ").trim()
    return single.take(max)
}

/**
 * Retire [key] de [text]. Défense en profondeur : une exception, un en-tête ou
 * un corps recopié par erreur ne doit jamais rendre la clé dans un message, un
 * journal ou un rapport de crash. Une clé trop courte pour être réelle n'est
 * pas cherchée (elle remplacerait des fragments de phrase).
 */
fun redactKey(text: String, key: String): String {
    if (key.length < LLM_MIN_API_KEY_CHARS) return text
    return text.replace(key, REDACTED_KEY)
}
