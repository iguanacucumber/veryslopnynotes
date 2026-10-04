package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.Homework
import fr.veryslopnynotes.core.HomeworkOutcome
import fr.veryslopnynotes.core.HomeworkSource
import fr.veryslopnynotes.core.ServerConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

// Dépôt « aide devoirs » (contrat 0.7.0) : POST /v1/homework/generate.
// org.json = SDK Android (aucune dépendance ajoutée), comme les autres dépôts.
//
// POINT DE VIGILANCE (0.7.0) : la clé du fournisseur LLM n'existe QUE dans
// l'app. Elle est relue de [LlmKeyStore] à CHAQUE appel puis placée dans le
// corps JSON (`apiKey`), jamais en query, jamais journalisée, jamais gardée en
// champ. Sans clé on n'appelle pas : le serveur la refuserait (400), donc
// l'aller-retour serait perdu. La réponse est de la DONNÉE (I6) : le dépôt ne
// fait que la valider, l'affichage se fait en Text() côté UI.
data class HomeworkResult(val outcome: HomeworkOutcome?, val error: String?)

// ponytail: dépôt sans état (la clé vit dans le store), pas de ViewModel avant besoin.
class HomeworkRepository(
    private val api: ApiClient,
    private val keys: LlmKeyStore,
) {

    fun generate(
        baseUrl: String,
        question: String,
        sources: List<HomeworkSource>,
        onDone: (HomeworkResult) -> Unit,
    ) {
        if (baseUrl.isBlank()) {
            onDone(HomeworkResult(null, "Serveur non configuré."))
            return
        }
        // Relecture à chaque appel : la clé change quand l'utilisateur la réécrit.
        val apiKey = keys.apiKey()
        if (apiKey.isNullOrEmpty()) {
            onDone(HomeworkResult(null, NO_KEY_MESSAGE))
            return
        }
        if (sources.isEmpty()) {
            onDone(HomeworkResult(null, Homework.SOURCES_REQUIRED_MESSAGE))
            return
        }
        if (!Homework.isRequestValid(question, sources, apiKey)) {
            onDone(HomeworkResult(null, OUT_OF_BOUNDS_MESSAGE))
            return
        }
        val body = JSONObject()
            .put("question", question.trim())
            .put("apiKey", apiKey)
            .put(
                "sources",
                JSONArray().apply {
                    for (s in sources) {
                        put(JSONObject().put("source", s.label.trim()).put("text", s.text.trim()))
                    }
                },
            )
            .toString()
        val request = try {
            api.buildPost(ServerConfig.homeworkGeneratePath(), body.toRequestBody(JSON))
        } catch (_: IllegalArgumentException) {
            onDone(HomeworkResult(null, "URL hors allowlist serveur"))
            return
        }
        api.client().newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                onDone(HomeworkResult(null, "Hors-ligne, retour arrière."))
            }

            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                response.use {
                    if (!it.isSuccessful) {
                        onDone(HomeworkResult(null, messageFor(it.code)))
                        return
                    }
                    // Étiquettes fournies : le serveur ne cite que parmi elles, donc
                    // on re-vérifie côté app plutôt que d'afficher une citation inventée.
                    val outcome = parse(it.body?.string().orEmpty(), Homework.uniqueLabels(sources))
                    if (outcome == null) {
                        onDone(HomeworkResult(null, "Réponse illisible."))
                    } else {
                        onDone(HomeworkResult(outcome, null))
                    }
                }
            }
        })
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()

        const val NO_KEY_MESSAGE = "Clé LLM absente : renseigne-la dans Réglages."
        const val OUT_OF_BOUNDS_MESSAGE = "Requête hors limites (question ou source trop longue)."

        /** 400 = contrat violé, 401 = session (l'intercepteur ré-appaire), 5xx = serveur. */
        private fun messageFor(code: Int): String = when (code) {
            400 -> "Requête refusée par le serveur (HTTP 400)."
            401 -> "Session expirée."
            501 -> "Assistant non configuré sur le serveur (HTTP 501)."
            else -> "Échec de l'assistant (HTTP $code)."
        }

        private fun capped(raw: String, max: Int): String {
            val t = raw.trim()
            return if (t.length > max) t.take(max) else t
        }

        /**
         * Sources d'un devoir : ce que le serveur peut CITER, donc ce que
         * l'élève a réellement sous les yeux. Les pièces jointes n'en sont pas
         * (une `ref` n'a pas de texte : il faudrait aller le chercher côté
         * serveur, hors périmètre de l'assistant) — d'où le refus honnête quand
         * le devoir n'a ni consigne ni contenu de cours.
         */
        fun sourcesFor(a: Assignment): List<HomeworkSource> {
            val out = mutableListOf<HomeworkSource>()
            if (a.description.isNotBlank()) {
                out.add(HomeworkSource(label = "Consigne", text = capped(a.description, Homework.MAX_SOURCE_CHARS)))
            }
            val lc = a.lessonContent
            if (lc != null && lc.excerpt.isNotBlank()) {
                val label = capped("Cours : ${lc.title}", Homework.MAX_LABEL_CHARS).ifEmpty { "Cours" }
                out.add(HomeworkSource(label = label, text = capped(lc.excerpt, Homework.MAX_SOURCE_CHARS)))
            }
            return out.filter { it.isValid() }.take(Homework.MAX_SOURCES)
        }

        /** Question proposée : matière + intitulé + la consigne si elle existe. */
        fun questionFor(a: Assignment): String = capped(
            listOf(a.subject, a.title).filter { it.isNotBlank() }.joinToString(" — ") +
                (if (a.description.isBlank()) "" else "\n${a.description}"),
            Homework.MAX_QUESTION_CHARS,
        )

        // ponytail: parse manuel org.json (miroir de isHomeworkGenerateResponse).
        fun parse(body: String, allowedLabels: List<String>): HomeworkOutcome? = try {
            val root = JSONObject(body)
            when (root.optString("status")) {
                "ok" -> {
                    val answer = root.optString("answer").trim()
                    val steps = strings(root.optJSONArray("steps"))
                    val sources = strings(root.optJSONArray("sources"))
                    // Le contrat exige answer non vide, stages et sources non vides
                    // et des sources non vides ; on re-vérifie le subset des citations.
                    val outcome = HomeworkOutcome.Answer(answer, steps, sources)
                    if (Homework.isOutcomeValid(outcome) && outcome.sources.all { it in allowedLabels }) {
                        outcome
                    } else {
                        null
                    }
                }

                "refused" -> {
                    val outcome = HomeworkOutcome.Refused(root.optString("reason").trim(), strings(root.optJSONArray("sources")))
                    if (Homework.isOutcomeValid(outcome)) outcome else null
                }

                else -> null
            }
        } catch (_: Exception) {
            null
        }

        private fun strings(arr: JSONArray?): List<String> {
            val out = mutableListOf<String>()
            for (i in 0 until (arr?.length() ?: 0)) {
                val s = arr?.optString(i) ?: continue
                if (s.isNotBlank()) out.add(s)
            }
            return out
        }
    }
}