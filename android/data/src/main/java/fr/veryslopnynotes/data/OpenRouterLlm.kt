package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.Homework
import fr.veryslopnynotes.core.HomeworkAi
import fr.veryslopnynotes.core.HomeworkOutcome
import fr.veryslopnynotes.core.HomeworkSource
import fr.veryslopnynotes.core.LlmProvider
import fr.veryslopnynotes.core.SafePrompt
import fr.veryslopnynotes.core.SafePromptProvider
import fr.veryslopnynotes.core.Untrusted
import fr.veryslopnynotes.core.assertNoSecretsInPrompt
import fr.veryslopnynotes.core.buildSafePrompt
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
class LlmError(message: String, val status: Int? = null) : Exception(message)

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
) : SafePromptProvider {
    private val timeout = normalizeTimeoutMs(timeoutMs)
    private val http: OkHttpClient = client.newBuilder()
        .connectTimeout(timeout, TimeUnit.MILLISECONDS)
        .readTimeout(timeout, TimeUnit.MILLISECONDS)
        .callTimeout(timeout, TimeUnit.MILLISECONDS)
        .build()

    init {
        if (model.isBlank()) throw LlmError("llm config incomplète")
    }

    override fun generate(system: String, data: List<Untrusted<String>>, apiKey: String?): String {
        return generateSafe(buildSafePrompt(system, data), apiKey)
    }

    // Envoie le SafePrompt DEJA valide par la garde (nonce de l'appelant preserve
    // au lieu d'un nonce regenere ici). apiKey vient de l'APP : sans elle, aucun
    // appel — l'appareil ne possede aucun credential de repli.
    override fun generateSafe(safe: SafePrompt, apiKey: String?): String {
        val key = (apiKey ?: "").trim()
        if (key.length < MIN_API_KEY_CHARS) throw LlmError("clé LLM absente")
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
            .toString()
        val request = Request.Builder()
            .url(OPENROUTER_URL)
            .header("Authorization", "Bearer $key")
            .post(payload.toRequestBody(JSON))
            .build()
        // Seule interpolation de la cle de tout le fichier : l'en-tete Bearer.
        // Rien d'autre ne la touche : ni log, ni erreur, ni URL.
        val bodyText = try {
            http.newCall(request).execute().use { res ->
                if (!res.isSuccessful) throw LlmError("llm http " + res.code, res.code)
                res.body?.string().orEmpty()
            }
        } catch (e: LlmError) {
            throw e
        } catch (_: Exception) {
            throw LlmError("llm network error")
        }
        val choice = try {
            JSONObject(bodyText).optJSONArray("choices")?.optJSONObject(0)
        } catch (_: Exception) {
            throw LlmError("llm réponse JSON invalide")
        } ?: throw LlmError("llm réponse JSON invalide")
        // finish_reason "length" = budget tokens atteint => sortie INCOMPLETE : jamais
        // renvoyee comme une reponse complete (I5).
        if (choice.optString("finish_reason", "") == "length") {
            throw LlmError("llm sortie tronquée (finish_reason=length)")
        }
        val content = choice.optJSONObject("message")?.optString("content", "")
        if (content.isNullOrBlank()) throw LlmError("llm sortie vide")
        return content
    }

    companion object {
        // Modele par defaut : choix de code, PAS un credential (donc pas d'env).
        const val LLM_DEFAULT_MODEL = "stealth/space-bunny-alpha"

        // URL publique du fournisseur, pas une donnee perso/etablissement.
        const val OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
        const val DEFAULT_TIMEOUT_MS = 20_000L
        const val MAX_TIMEOUT_MS = 120_000L

        // Plafond aligne sur la garde I5 (MAX_OUTPUT_CHARS) : ~2 caracteres/token
        // borne basse pour du francais, donc la sortie ne peut pas depasser ce que
        // validateTextOutput accepte, et le cout par appel est fini.
        const val MAX_OUTPUT_TOKENS = 4000

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
            val outcome: HomeworkOutcome? = try {
                HomeworkAi.generateHomework(llm, question, sources, apiKey)
            } catch (_: Exception) {
                null
            }
            if (outcome == null) {
                onDone(HomeworkResult(null, "Échec de l'assistant."))
            } else {
                onDone(HomeworkResult(outcome, null))
            }
        }.start()
    }
}
