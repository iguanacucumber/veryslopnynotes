package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.AiError
import fr.veryslopnynotes.core.Homework
import fr.veryslopnynotes.core.HomeworkAi
import fr.veryslopnynotes.core.HomeworkOutcome
import fr.veryslopnynotes.core.HomeworkSource
// Budget de tokens du fournisseur : IMPORTE du core (#411), jamais recopie
// ici. Il est DEDUIT du plafond de caracteres de la garde I5
// (MAX_OUTPUT_CHARS / CHARS_PER_TOKEN) : le fournisseur ne peut donc pas
// produire une sortie que la garde jetterait pour cause de longueur.
import fr.veryslopnynotes.core.MAX_OUTPUT_TOKENS
import fr.veryslopnynotes.core.OutputTooLongException
import fr.veryslopnynotes.core.SafePrompt
import fr.veryslopnynotes.core.SafePromptProvider
import fr.veryslopnynotes.core.SafeVisionPrompt
import fr.veryslopnynotes.core.SafeVisionPromptProvider
import fr.veryslopnynotes.core.SecretDetectedException
import fr.veryslopnynotes.core.assertNoSecretsInPrompt
import fr.veryslopnynotes.core.secretRefusalMessage
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

// LLM OpenRouter sur l'appareil — adaptateur LlmProvider.
// Porté de server/infrastructure/llm-openrouter.ts (supprimé en #210 : ce port
// est la REFERENCE du protocole — modele en constante, Bearer, budget tokens, rejets).
// La cle n'est JAMAIS un champ : elle arrive en parametre a chaque appel,
// vit le temps de l'appel et part dans l'en-tete Authorization. Ni env,
// ni disque, ni log. Le modele est une constante de code (pas un credential).
// Corps = SafePrompt nonce-bound (I6) ; garde entree/sortie = core (I4/I5).
// Aucun secret sur le fil sauf Authorization Bearer, jamais dans logs/erreurs.
// Appels BLOQUANTS (pas de coroutines sans dependance) : jamais sur le thread
// UI — OpenRouterHomework file l'aller-retour en tache de fond.
// ponytail: OkHttp deja dependance du module, aucune ajoutee. Upgrade: retry/backoff si quotas.

// Erreur LLM : le message est DEJA affichable (borné, français, sans clé ni
// URL). `status` = code HTTP du fournisseur quand la cause est HTTP
// (null = réseau ou garde locale).
class LlmError(message: String, val status: Int? = null) : Exception(message) {
    // Message pour l'UI : borné, jamais le corps de réponse brut du fournisseur.
    val userMessage: String = message.take(MAX_ERROR_CHARS)

    companion object {
        // Longueur max affichée : au-delà on tronque (jamais de vidage de corps).
        const val MAX_ERROR_CHARS = 120

        // Une CAUSE par message : 401 clé refusée, 402 crédits, 404 modèle absent
        // du catalogue, 429 quota, sinon HTTP générique. Jamais la clé, jamais
        // l'URL : le message part tel quel à l'UI.
        fun forStatus(status: Int): LlmError = LlmError(messageForStatus(status), status)

        fun messageForStatus(status: Int): String = when (status) {
            401 -> "Clé LLM refusée (401) : vérifie-la dans Réglages."
            402 -> "Crédits LLM insuffisants (402) : recharges ton compte."
            404 -> "Modèle LLM introuvable (404) : le catalogue du fournisseur a changé."
            429 -> "Quota LLM dépassé (429) : réessaie dans quelques minutes."
            else -> "Erreur du fournisseur LLM (HTTP $status) : réessaie dans un instant."
        }
    }
}

class OpenRouterLlm(
    private val model: String = LLM_DEFAULT_MODEL,
    timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    // Client NU impose par l'appelant (jamais api.client() : son intercepteur
    // 401 confondrait « cle LLM refusee » avec « session d'appareil perdue »
    // et renverrait l'utilisateur a l'appairage pour une simple cle fausse —
    // un 401 OpenRouter n'invalide JAMAIS l'appareil). newBuilder() partage
    // pool et dispatcher sans reprendre les intercepteurs. Défaut = client
    // vierge (l'UI n'a pas à construire d'OkHttpClient elle-même).
    client: OkHttpClient = OkHttpClient(),
    // Modèle VISION distinct : le modèle texte par défaut (Nemotron
    // Lightning) n'accepte pas les images. `google/gemma-4-31b-it:free` est
    // multimodal et gratuit ; il ne sert QU'aux photos.
    private val visionModel: String = LLM_VISION_MODEL,
) : SafePromptProvider, SafeVisionPromptProvider {
    private val timeout = normalizeTimeoutMs(timeoutMs)
    private val http: OkHttpClient = client.newBuilder()
        .connectTimeout(timeout, TimeUnit.MILLISECONDS)
        .readTimeout(timeout, TimeUnit.MILLISECONDS)
        .callTimeout(timeout, TimeUnit.MILLISECONDS)
        .build()

    init {
        if (model.isBlank() || visionModel.isBlank()) throw LlmError("Configuration LLM incomplète.")
    }

    // Envoie le SafePrompt DEJA valide par la garde (nonce de l'appelant preserve
    // au lieu d'un nonce regenere ici). apiKey vient de l'APP : sans elle, aucun
    // appel — l'appareil ne possede aucun credential de repli.
    override fun generateSafe(safe: SafePrompt, apiKey: String?): String {
        val key = (apiKey ?: "").trim()
        if (key.length < MIN_API_KEY_CHARS) throw LlmError("Clé LLM absente ou trop courte : renseigne-la dans Réglages.")
        assertNoSecretsInPrompt(safe)
        val payload = JSONObject()
            .put("model", model)
            .put(
                "messages",
                JSONArray().apply {
                    put(JSONObject().put("role", "system").put("content", safe.system))
                    put(JSONObject().put("role", "user").put("content", safe.body))
                },
            )
            .put("max_tokens", MAX_OUTPUT_TOKENS)
            // Le raisonnement est COUPE (#604) : mesure live sur le modele par
            // defaut, `max_tokens=3000` entierement consomme en reasoning
            // (10 214 caracteres de reflexion), `content=null` et
            // `finish_reason=length` => « Reponse LLM tronquee ». Le budget de
            // sortie doit aller a la reponse, et l'attente du pont (45 s)
            // couvrait mal 23-42 s de raisonnement. Coupe : 1,2 s.
            .put("reasoning", JSONObject().put("enabled", false))
        return parseCompletion(send(payload, key))
    }

    /**
     * Prompt vision : le texte est le MÊME corps nonce-bound (déjà validé),
     * l'image est un data URL JPEG ré-encodé. Aucune image n'est journalisée,
     * et le message d'erreur ne la recopie jamais.
     */
    override fun generateVisionSafe(prompt: SafeVisionPrompt, apiKey: String?): String {
        val key = (apiKey ?: "").trim()
        if (key.length < MIN_API_KEY_CHARS) throw LlmError("Clé LLM absente ou trop courte : renseigne-la dans Réglages.")
        assertNoSecretsInPrompt(prompt.prompt)
        val images = prompt.images
        if (images.isEmpty() || images.size > 1) throw LlmError("Image invalide : une seule photo par demande.")
        val image = images[0]
        if (!image.isValid()) throw LlmError("Image invalide ou trop volumineuse.")
        val content = JSONArray()
            .put(JSONObject().put("type", "text").put("text", prompt.prompt.body))
            .put(
                JSONObject()
                    .put("type", "image_url")
                    .put(
                        "image_url",
                        JSONObject().put("url", "data:" + image.mime + ";base64," + image.base64),
                    ),
            )
        val payload = JSONObject()
            .put("model", visionModel)
            .put(
                "messages",
                JSONArray().apply {
                    put(JSONObject().put("role", "system").put("content", prompt.prompt.system))
                    put(JSONObject().put("role", "user").put("content", content))
                },
            )
            .put("max_tokens", MAX_OUTPUT_TOKENS)
            // Meme raison que le chemin texte (#604) : un modele multimodal qui
            // raisonne mangerait le budget avant d'ecrire le JSON.
            .put("reasoning", JSONObject().put("enabled", false))
        return parseCompletion(send(payload, key))
    }

    /** Envoi HTTPS + cause d'erreur bornée. Seule la clé est interpolée (Bearer). */
    private fun send(payload: JSONObject, key: String): String {
        // Le build de la requête est DANS le try (#595) : OkHttp refuse un
        // caractère d'en-tête hors ASCII imprimable AVANT tout réseau — la
        // cause est alors la CLÉ, et le message la nomme (jamais sa valeur).
        return try {
            val request = Request.Builder()
                .url(OPENROUTER_URL)
                .header("Authorization", "Bearer $key")
                .post(payload.toString().toRequestBody(JSON))
                .build()
            http.newCall(request).execute().use { res ->
                if (!res.isSuccessful) throw LlmError.forStatus(res.code)
                res.body?.string().orEmpty()
            }
        } catch (e: LlmError) {
            throw e
        } catch (_: IllegalArgumentException) {
            throw LlmError("Clé LLM invalide : corrige-la dans Réglages.")
        } catch (_: Exception) {
            throw LlmError("Erreur réseau LLM : réessaie dans un instant.")
        }
    }

    private fun parseCompletion(bodyText: String): String {
        val choice = try {
            JSONObject(bodyText).optJSONArray("choices")?.optJSONObject(0)
        } catch (_: Exception) {
            throw LlmError("Réponse LLM illisible (JSON invalide).")
        } ?: throw LlmError("Réponse LLM illisible (JSON invalide).")
        // finish_reason "length" = budget tokens atteint => sortie INCOMPLETE : jamais
        // renvoyee comme une reponse complete (I5).
        if (choice.optString("finish_reason", "") == "length") {
            throw LlmError("Réponse LLM tronquée (limite de longueur atteinte).")
        }
        val content = choice.optJSONObject("message")?.optString("content", "")
        if (content.isNullOrBlank()) throw LlmError("Réponse LLM vide.")
        return content
    }

    companion object {
        // Modele texte par defaut : choix de code, PAS un credential (donc pas
        // d'env). `nvidia/nemotron-3.5-lightning:free` est au catalogue
        // public, gratuit, francais correct et rapide. Il est TEXTE seul :
        // les photos passent par `LLM_VISION_MODEL` (voir #587).
        const val LLM_DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning:free"

        // Modèle VISION : le modèle texte par défaut n'accepte PAS les
        // images. `dots-studio/dots-3-note-preview:free` est multimodal
        // (text+image), gratuit, au catalogue public — et il RÉPOND :
        // `google/gemma-4-31b-it:free`, livré avant #604, renvoyait un 429
        // « temporarily rate-limited upstream » sur 8 tentatives espacées,
        // donc le chemin photo était mort. Un modèle séparé évite de
        // dégrader le texte pour les photos.
        const val LLM_VISION_MODEL = "dots-studio/dots-3-note-preview:free"

        // URL publique du fournisseur, pas une donnee perso/etablissement.
        const val OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
        const val DEFAULT_TIMEOUT_MS = 20_000L
        const val MAX_TIMEOUT_MS = 120_000L

        // Longueur plausible d'une cle de fournisseur : borne l'appel comme le reste.
        const val MIN_API_KEY_CHARS = 8

        private val JSON = "application/json; charset=utf-8".toMediaType()

        // Env hors bornes = delai recale sur le defaut : jamais d'exception brute.
        fun normalizeTimeoutMs(value: Long): Long =
            if (value <= 0 || value > MAX_TIMEOUT_MS) DEFAULT_TIMEOUT_MS else value
    }
}

// Generation devoirs sur l'appareil : prompt core (I6) + OpenRouter direct +
// validation core (I4/I5), cle relue du store a CHAQUE appel.
// Meme discipline que l'ancien HomeworkRepository serveur : corps seul, jamais en
// query, jamais journalisee, jamais gardee en champ. Sans cle on n'appelle pas.
// Reponse = DONNEE validee (citations parmi les etiquettes fournies).
class OpenRouterHomework(
    private val llm: OpenRouterLlm,
    private val keys: LlmKeyStore,
) {
    fun generate(
        question: String,
        sources: List<HomeworkSource>,
        onDone: (HomeworkResult) -> Unit,
    ) {
        // Relecture a chaque appel : la cle change quand l'utilisateur la reecrit.
        val apiKey = keys.apiKey()
        if (apiKey.isNullOrEmpty()) {
            onDone(HomeworkResult(null, HomeworkRepository.NO_KEY_MESSAGE))
            return
        }
        if (sources.isEmpty()) {
            onDone(HomeworkResult(null, Homework.SOURCES_REQUIRED_MESSAGE))
            return
        }
        if (!Homework.isRequestValid(question, sources, apiKey)) {
            onDone(HomeworkResult(null, HomeworkRepository.OUT_OF_BOUNDS_MESSAGE))
            return
        }
        // Fond : OkHttp reste bloquant, donc hors thread UI. Le provider direct
        // implemente SafePromptProvider : le SafePrompt valide ici est celui envoye.
        Thread {
            // #359 : plus de `catch (_: Exception) { null }` — l'erreur REMONTE,
            // avec sa cause (clé, crédits, modèle, quota, réseau). Avant, tout
            // devenait « Échec de l'assistant. », impossible à diagnostiquer.
            val result: HomeworkResult = try {
                val outcome: HomeworkOutcome = HomeworkAi.generateHomework(llm, question, sources, apiKey)
                HomeworkResult(outcome, null)
            } catch (e: LlmError) {
                HomeworkResult(null, e.userMessage)
            } catch (e: SecretDetectedException) {
                // #409 : un SECRET a ete detecte dans le contenu envoye au
                // modele. On dit POURQUOI (le type du secret), jamais le
                // secret : l'eleve doit pouvoir corriger son devoir. Avant,
                // l'AiError avalait la cause et l'UI n'affichait que
                // « Echec de l'assistant. ».
                HomeworkResult(null, secretRefusalMessage(e.kind))
            } catch (e: OutputTooLongException) {
                // #411 : la sortie depasse la garde I5. « Hors format » serait
                // un diagnostic FAUX (la reponse est bien formee, juste trop
                // longue) : on nomme la LIMITE REELLE.
                HomeworkResult(null, e.userMessage)
            } catch (_: AiError) {
                // Le modèle A RÉPONDU, mais hors format (JSON invalide, citation
                // inventée) : cause distincte de l'appel qui n'a pas abouti.
                HomeworkResult(null, INVALID_ANSWER_MESSAGE)
            } catch (_: Exception) {
                HomeworkResult(null, GENERIC_ERROR_MESSAGE)
            }
            onDone(result)
        }.start()
    }

    companion object {
        // Repli quand la cause n'est pas identifiée.
        const val GENERIC_ERROR_MESSAGE = "Échec de l'assistant."
        // Le modèle a répondu, mais sa réponse n'est pas exploitable.
        const val INVALID_ANSWER_MESSAGE = "Réponse de l'assistant hors format : réessaie."
    }
}
